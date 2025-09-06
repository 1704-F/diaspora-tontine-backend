// routes/auth.js
const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { User, AssociationMember, Section, Association } = require('../../../models');
const { authService, authenticate } = require('../middleware/auth');
const { twilioService } = require('../../twilio/twilio');
const redisConfig = require('../../redis/redis');

const router = express.Router();

// Rate limiting spécifique auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Max 10 tentatives par IP
  message: {
    error: 'Trop de tentatives d\'authentification, réessayez dans 15 minutes',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const otpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 3, // Max 3 OTP par IP
  message: {
    error: 'Trop de demandes d\'OTP, réessayez dans 5 minutes',
    code: 'OTP_RATE_LIMIT'
  }
});

// Stocker OTP temporaires (Redis ou mémoire)
const otpStore = new Map(); // Fallback si pas Redis

// Utilitaire: Stocker OTP
async function storeOTP(phoneNumber, otp, expiresIn = 10 * 60 * 1000) { // 10 min
  const key = `otp:${phoneNumber}`;
  const data = {
    otp,
    expiresAt: Date.now() + expiresIn,
    attempts: 0
  };

  if (redisConfig.isAvailable()) {
    const redis = redisConfig.getClient();
    await redis.setex(key, Math.floor(expiresIn / 1000), JSON.stringify(data));
  } else {
    otpStore.set(key, data);
    // Nettoyer après expiration
    setTimeout(() => otpStore.delete(key), expiresIn);
  }
}

// Utilitaire: Récupérer OTP
async function getOTP(phoneNumber) {
  const key = `otp:${phoneNumber}`;

  if (redisConfig.isAvailable()) {
    const redis = redisConfig.getClient();
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } else {
    const data = otpStore.get(key);
    if (data && Date.now() > data.expiresAt) {
      otpStore.delete(key);
      return null;
    }
    return data;
  }
}

// Utilitaire: Supprimer OTP
async function deleteOTP(phoneNumber) {
  const key = `otp:${phoneNumber}`;

  if (redisConfig.isAvailable()) {
    const redis = redisConfig.getClient();
    await redis.del(key);
  } else {
    otpStore.delete(key);
  }
}

// **ROUTE 1: Demander OTP (SMS)**
router.post('/request-otp', 
  otpLimiter,
  [
    body('phoneNumber')
      .notEmpty()
      .withMessage('Numéro de téléphone requis')
      .matches(/^(\+\d{1,3}[- ]?)?\d{10,14}$/)
      .withMessage('Format de numéro invalide')
  ],
  async (req, res) => {
    try {
      // Validation
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Données invalides',
          code: 'VALIDATION_ERROR',
          details: errors.array()
        });
      }

      let { phoneNumber } = req.body;
      phoneNumber = twilioService.formatPhoneNumber(phoneNumber);

      // Générer et stocker OTP
      const otp = twilioService.generateOTP(6);
      await storeOTP(phoneNumber, otp);

      // Envoyer SMS
      const smsResult = await twilioService.sendOTP(phoneNumber, otp, 'login');

      // Vérifier si utilisateur existe (sans révéler l'info)
      const existingUser = await User.findOne({
        where: { phoneNumber },
        include: [
          {
            model: AssociationMember,
            as: 'associationMemberships',
            include: [
              { model: Association, as: 'association' },
              { model: Section, as: 'section' }
            ]
          }
        ]
      });

      console.log(`📱 OTP envoyé à ${phoneNumber}: ${otp} (Mode DEV)`);

      res.json({
        success: true,
        message: 'Code de vérification envoyé',
        phoneNumber: phoneNumber,
        expiresIn: 600, // 10 minutes
        // En développement uniquement
        ...(process.env.NODE_ENV === 'development' && { otp })
      });

    } catch (error) {
      console.error('Erreur demande OTP:', error);
      res.status(500).json({
        error: 'Erreur lors de l\'envoi du code',
        code: 'SMS_SEND_ERROR',
        message: error.message
      });
    }
  }
);

// **ROUTE 2: Vérifier OTP et authentifier**
router.post('/verify-otp',
  authLimiter,
  [
    body('phoneNumber')
      .notEmpty()
      .withMessage('Numéro de téléphone requis'),
    body('otp')
      .notEmpty()
      .withMessage('Code OTP requis')
      .isLength({ min: 4, max: 8 })
      .withMessage('Code OTP invalide')
  ],
  async (req, res) => {
    try {
      // Validation
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Données invalides',
          code: 'VALIDATION_ERROR',
          details: errors.array()
        });
      }

      let { phoneNumber, otp } = req.body;
      phoneNumber = twilioService.formatPhoneNumber(phoneNumber);

      // Vérifier OTP stocké
      const storedOTP = await getOTP(phoneNumber);
      if (!storedOTP) {
        return res.status(400).json({
          error: 'Code expiré ou introuvable',
          code: 'OTP_EXPIRED'
        });
      }

      // Vérifier tentatives
      if (storedOTP.attempts >= 3) {
        await deleteOTP(phoneNumber);
        return res.status(429).json({
          error: 'Trop de tentatives, demandez un nouveau code',
          code: 'TOO_MANY_ATTEMPTS'
        });
      }

      // Vérifier code
      if (storedOTP.otp !== otp) {
        // Incrémenter tentatives
        storedOTP.attempts++;
        await storeOTP(phoneNumber, storedOTP.otp, storedOTP.expiresAt - Date.now());
        
        return res.status(400).json({
          error: 'Code incorrect',
          code: 'INVALID_OTP',
          attemptsRemaining: 3 - storedOTP.attempts
        });
      }

      // OTP valide - Supprimer
      await deleteOTP(phoneNumber);

      // Rechercher ou créer utilisateur
      let user = await User.findOne({
        where: { phoneNumber },
        include: [
          {
            model: AssociationMember,
            as: 'associationMemberships',
            include: [
              { model: Association, as: 'association' },
              { model: Section, as: 'section' }
            ]
          }
        ]
      });

      const isNewUser = !user;

      if (!user) {
        // Créer nouvel utilisateur avec valeurs temporaires
        user = await User.create({
          phoneNumber,
          firstName: 'Utilisateur', // Valeur temporaire
          lastName: 'Temporaire',   // Valeur temporaire
          phoneVerified: true,
          phoneVerifiedAt: new Date(),
          status: 'pending_verification', // Doit définir PIN
          role: 'member'
        });
        
        console.log(`👤 Nouvel utilisateur créé: ${phoneNumber}`);
      } else {
        // Marquer téléphone comme vérifié
        await user.update({
          phoneVerified: true,
         phoneVerifiedAt: new Date(),
         lastLoginAt: new Date()
       });
     }

     // Auto-détection association/section si utilisateur existant
     let contextInfo = null;
     if (user.associationMemberships && user.associationMemberships.length > 0) {
       const primaryMembership = user.associationMemberships.find(m => m.status === 'active') 
                                || user.associationMemberships[0];
       
       contextInfo = {
         hasAssociations: true,
         primaryAssociation: {
           id: primaryMembership.association.id,
           name: primaryMembership.association.name,
           role: primaryMembership.role
         },
         section: primaryMembership.section ? {
           id: primaryMembership.section.id,
           name: primaryMembership.section.name,
           country: primaryMembership.section.country
         } : null
       };
     }

     // Générer tokens si utilisateur a déjà un PIN
     let tokens = null;
     if (user.pinCode && user.status === 'active') {
       tokens = authService.generateTokens(user, {
         sessionId: `session_${Date.now()}`,
         loginMethod: 'otp',
         ipAddress: req.ip
       });
     }

     res.json({
       success: true,
       message: isNewUser ? 'Compte créé avec succès' : 'Connexion réussie',
       user: {
         id: user.id,
         phoneNumber: user.phoneNumber,
         firstName: user.firstName,
         lastName: user.lastName,
         status: user.status,
         isNewUser,
         needsPINSetup: !user.pinCode || user.status === 'pending_setup'
       },
       context: contextInfo,
       tokens,
       nextStep: !user.pinCode ? 'setup_pin' : 'complete'
     });

   } catch (error) {
     console.error('Erreur vérification OTP:', error);
     res.status(500).json({
       error: 'Erreur lors de la vérification',
       code: 'VERIFICATION_ERROR',
       message: error.message
     });
   }
 }
);

// **ROUTE 3: Définir PIN (nouveaux utilisateurs)**
router.post('/setup-pin',
 authLimiter,
 [
   body('phoneNumber')
     .notEmpty()
     .withMessage('Numéro de téléphone requis'),
   body('pin')
     .isNumeric()
     .withMessage('Le PIN doit être numérique')
     .isLength({ min: 4, max: 6 })
     .withMessage('Le PIN doit contenir 4 à 6 chiffres'),
   body('confirmPin')
     .custom((value, { req }) => {
       if (value !== req.body.pin) {
         throw new Error('Les codes PIN ne correspondent pas');
       }
       return true;
     }),
   body('firstName')
     .optional()
     .trim()
     .isLength({ min: 2, max: 50 })
     .withMessage('Prénom entre 2 et 50 caractères'),
   body('lastName')
     .optional()
     .trim()
     .isLength({ min: 2, max: 50 })
     .withMessage('Nom entre 2 et 50 caractères')
 ],
 async (req, res) => {
   try {
     const errors = validationResult(req);
     if (!errors.isEmpty()) {
       return res.status(400).json({
         error: 'Données invalides',
         code: 'VALIDATION_ERROR',
         details: errors.array()
       });
     }

     let { phoneNumber, pin, firstName, lastName } = req.body;
     phoneNumber = twilioService.formatPhoneNumber(phoneNumber);

     // Vérifier utilisateur existe
     const user = await User.findOne({ where: { phoneNumber } });
     if (!user) {
       return res.status(404).json({
         error: 'Utilisateur introuvable',
         code: 'USER_NOT_FOUND'
       });
     }

     if (user.pinCode && user.status === 'active') {
       return res.status(400).json({
         error: 'PIN déjà configuré',
         code: 'PIN_ALREADY_SET'
       });
     }

     // Hasher PIN et mettre à jour utilisateur
     await user.update({
  pinCode: pin, // Le hook beforeUpdate du model va hasher automatiquement
  firstName: firstName || user.firstName,
  lastName: lastName || user.lastName,
  status: 'active',
  setupCompletedAt: new Date()
});

     // Générer tokens
     const tokens = authService.generateTokens(user, {
       sessionId: `session_${Date.now()}`,
       loginMethod: 'pin_setup',
       ipAddress: req.ip
     });

     res.json({
       success: true,
       message: 'Configuration terminée avec succès',
       user: {
         id: user.id,
         phoneNumber: user.phoneNumber,
         firstName: user.firstName,
         lastName: user.lastName,
         status: user.status
       },
       tokens
     });

   } catch (error) {
     console.error('Erreur configuration PIN:', error);
     res.status(500).json({
       error: 'Erreur lors de la configuration',
       code: 'SETUP_ERROR',
       message: error.message
     });
   }
 }
);

// **ROUTE 4: Connexion avec PIN**
router.post('/login-pin',
 authLimiter,
 [
   body('phoneNumber')
     .notEmpty()
     .withMessage('Numéro de téléphone requis'),
   body('pin')
     .notEmpty()
     .withMessage('Code PIN requis')
     .isNumeric()
     .withMessage('Le PIN doit être numérique')
 ],
 async (req, res) => {
   try {
     const errors = validationResult(req);
     if (!errors.isEmpty()) {
       return res.status(400).json({
         error: 'Données invalides',
         code: 'VALIDATION_ERROR',
         details: errors.array()
       });
     }

     let { phoneNumber, pin } = req.body;
     phoneNumber = twilioService.formatPhoneNumber(phoneNumber);

     // Rechercher utilisateur
     const user = await User.findOne({
       where: { phoneNumber },
       include: [
         {
           model: AssociationMember,
           as: 'associationMemberships',
           include: [
             { model: Association, as: 'association' },
             { model: Section, as: 'section' }
           ]
         }
       ]
     });

     if (!user || !user.pinCode) {
       return res.status(401).json({
         error: 'Identifiants incorrects',
         code: 'INVALID_CREDENTIALS'
       });
     }

     // Vérifier PIN
     const isPINValid = await authService.verifyPIN(pin, user.pinCode);
     if (!isPINValid) {
       return res.status(401).json({
         error: 'Code PIN incorrect',
         code: 'INVALID_PIN'
       });
     }

     // Mettre à jour dernière connexion
     await user.update({
       lastLoginAt: new Date(),
       failedLoginAttempts: 0
     });

     // Générer tokens
     const tokens = authService.generateTokens(user, {
       sessionId: `session_${Date.now()}`,
       loginMethod: 'pin',
       ipAddress: req.ip
     });

     // Context utilisateur
     const contextInfo = user.associationMemberships?.length > 0 ? {
       hasAssociations: true,
       associations: user.associationMemberships.map(m => ({
         id: m.association.id,
         name: m.association.name,
         role: m.role,
         status: m.status,
         section: m.section ? {
           id: m.section.id,
           name: m.section.name,
           country: m.section.country
         } : null
       }))
     } : { hasAssociations: false };

     res.json({
       success: true,
       message: 'Connexion réussie',
       user: {
         id: user.id,
         phoneNumber: user.phoneNumber,
         firstName: user.firstName,
         lastName: user.lastName,
         status: user.status,
         role: user.role
       },
       context: contextInfo,
       tokens
     });

   } catch (error) {
     console.error('Erreur connexion PIN:', error);
     res.status(500).json({
       error: 'Erreur lors de la connexion',
       code: 'LOGIN_ERROR',
       message: error.message
     });
   }
 }
);

// **ROUTE 5: Renouveler token**
router.post('/refresh-token',
 [
   body('refreshToken')
     .notEmpty()
     .withMessage('Refresh token requis')
 ],
 async (req, res) => {
   try {
     const errors = validationResult(req);
     if (!errors.isEmpty()) {
       return res.status(400).json({
         error: 'Données invalides',
         code: 'VALIDATION_ERROR',
         details: errors.array()
       });
     }

     const { refreshToken } = req.body;

     // Vérifier refresh token
     const decoded = await authService.verifyToken(refreshToken);
     
     if (decoded.type !== 'refresh') {
       return res.status(401).json({
         error: 'Token de rafraîchissement invalide',
         code: 'INVALID_REFRESH_TOKEN'
       });
     }

     // Récupérer utilisateur
     const user = await User.findByPk(decoded.userId);
     if (!user || user.status !== 'active') {
       return res.status(401).json({
         error: 'Utilisateur introuvable ou inactif',
         code: 'USER_INACTIVE'
       });
     }

     // Générer nouveaux tokens
     const tokens = authService.generateTokens(user, {
       sessionId: decoded.sessionId,
       loginMethod: 'refresh',
       ipAddress: req.ip
     });

     res.json({
       success: true,
       tokens
     });

   } catch (error) {
     console.error('Erreur renouvellement token:', error);
     res.status(401).json({
       error: 'Token de rafraîchissement invalide ou expiré',
       code: 'REFRESH_TOKEN_ERROR'
     });
   }
 }
);

// **ROUTE 6: Déconnexion**
router.post('/logout', authenticate, async (req, res) => {
 try {
   // Révoquer token actuel
   await authService.revokeToken(req.token);

   res.json({
     success: true,
     message: 'Déconnexion réussie'
   });

 } catch (error) {
   console.error('Erreur déconnexion:', error);
   res.status(500).json({
     error: 'Erreur lors de la déconnexion',
     code: 'LOGOUT_ERROR'
   });
 }
});

// **ROUTE 7: Profil utilisateur connecté**
router.get('/profile', authenticate, async (req, res) => {
 try {
   const user = await User.findByPk(req.user.id, {
     include: [
       {
         model: AssociationMember,
         as: 'associationMemberships',
         include: [
           { model: Association, as: 'association' },
           { model: Section, as: 'section' }
         ]
       }
     ]
   });

   res.json({
     success: true,
     user: {
       id: user.id,
       phoneNumber: user.phoneNumber,
       firstName: user.firstName,
       lastName: user.lastName,
       email: user.email,
       status: user.status,
       role: user.role,
       phoneVerified: user.phoneVerified,
       createdAt: user.createdAt,
       lastLoginAt: user.lastLoginAt
     },
     associations: user.associationMemberships?.map(m => ({
       id: m.association.id,
       name: m.association.name,
       role: m.role,
       status: m.status,
       joinDate: m.joinDate,
       section: m.section ? {
         id: m.section.id,
         name: m.section.name,
         country: m.section.country
       } : null
     })) || []
   });

 } catch (error) {
   console.error('Erreur récupération profil:', error);
   res.status(500).json({
     error: 'Erreur lors de la récupération du profil',
     code: 'PROFILE_ERROR'
   });
 }
});

// **ROUTE: Vérifier si utilisateur existe et a un PIN**
router.post('/check-user',
  authLimiter,
  [
    body('phoneNumber')
      .notEmpty()
      .withMessage('Numéro de téléphone requis')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          error: 'Données invalides',
          code: 'VALIDATION_ERROR',
          details: errors.array()
        });
      }

      let { phoneNumber } = req.body;
      phoneNumber = twilioService.formatPhoneNumber(phoneNumber);

      const user = await User.findOne({ where: { phoneNumber } });

      if (!user) {
        return res.json({
          success: true,
          userExists: false,
          hasPIN: false,
          nextAction: 'request_otp'
        });
      }

      const hasPIN = user.pinCode && user.status === 'active';

      res.json({
        success: true,
        userExists: true,
        hasPIN: hasPIN,
        nextAction: hasPIN ? 'login_pin' : 'request_otp'
      });

    } catch (error) {
      console.error('Erreur vérification utilisateur:', error);
      res.status(500).json({
        error: 'Erreur lors de la vérification',
        code: 'CHECK_USER_ERROR'
      });
    }
  }
);



module.exports = router;