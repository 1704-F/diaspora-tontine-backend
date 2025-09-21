// src/core/auth/routes/auth.js - VERSION COMPLÈTE MISE À JOUR

const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { User, AssociationMember, Section, Association, TontineParticipant, Tontine } = require('../../../models');
const { authService, authenticate } = require('../middleware/auth');
const { twilioService } = require('../../twilio/twilio');
const redisConfig = require('../../redis/redis');
const UserDataSearchService = require('../../services/userDataSearchService'); // 🆕 Service recherche

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

// **ROUTE 2: Vérifier OTP et authentifier (MISE À JOUR COMPLÈTE)**
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

      // 🔍 NOUVELLE LOGIQUE : Recherche intelligente de données existantes
      let existingDataSources = [];

// Rechercher si l'utilisateur n'existe pas OU s'il a un profil incomplet
const shouldSearchExistingData = !user || 
  (user.status === 'pending_verification') || 
  (user.firstName === 'Utilisateur' && user.lastName === 'Temporaire');

if (shouldSearchExistingData) {
  console.log(`🔍 Recherche données existantes pour ${phoneNumber}...`);
  console.log(`📊 Critères: isNewUser=${!user}, status=${user?.status}, nom=${user?.firstName} ${user?.lastName}`);
  
  try {
    // Rechercher à travers tous les modules
    const foundDataSources = await UserDataSearchService.searchUserDataAcrossModules(phoneNumber);
    
    if (foundDataSources.length > 0) {
      console.log(`✅ ${foundDataSources.length} source(s) de données trouvée(s)`);
      existingDataSources = UserDataSearchService.formatResultsForFrontend(foundDataSources);
      
      // Si pas d'utilisateur, en créer un temporaire
      if (!user) {
        user = await User.create({
          phoneNumber,
          firstName: 'Utilisateur', // Valeurs temporaires
          lastName: 'Temporaire',   
          phoneVerified: true,
          status: 'pending_verification'
        });
        console.log(`👤 Utilisateur temporaire créé: ID ${user.id}`);
      }
    } else {
      console.log(`❌ Aucune donnée existante trouvée`);
    }
  } catch (error) {
    console.error('❌ Erreur recherche données existantes:', error);
  }
} else {
  console.log(`⏭️ Pas de recherche nécessaire pour utilisateur actif: ${user.firstName} ${user.lastName}`);
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

      // 🎯 RÉPONSE ENRICHIE avec données existantes
      const response = {
        success: true,
        message: isNewUser ? 'Compte créé avec succès' : 'Connexion réussie',
        user: {
          id: user.id,
          phoneNumber: user.phoneNumber,
          firstName: user.firstName,
          lastName: user.lastName,
          status: user.status,
          isNewUser,
          needsPINSetup: !user.pinCode || user.status === 'pending_verification'
        },
        context: contextInfo,
        tokens,
        nextStep: !user.pinCode ? 'setup_pin' : 'complete'
      };

      // ⭐ AJOUTER DONNÉES EXISTANTES si trouvées
      if (existingDataSources.length > 0) {
        response.existingData = {
          found: true,
          sources: existingDataSources,
          summary: {
            totalSources: existingDataSources.length,
            modules: [...new Set(existingDataSources.map(s => s.module.name))],
            recommendedData: UserDataSearchService.mergeUserDataSources(
              existingDataSources.map(s => ({ data: s.data, priority: s.metadata.priority }))
            )
          }
        };
        
        // Modifier le nextStep pour afficher l'écran de révision des données
        response.nextStep = 'review_existing_data';
        
        console.log(`📋 Données existantes incluses dans la réponse`);
      } else {
        response.existingData = {
          found: false,
          sources: [],
          summary: null
        };
      }

      res.json(response);

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

// **ROUTE 3: Définir PIN (nouveaux utilisateurs) - MISE À JOUR**
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
      .withMessage('Nom entre 2 et 50 caractères'),
    
    // 🆕 NOUVEAUX CHAMPS pour données optionnelles
    body('email')
      .optional()
      .isEmail()
      .withMessage('Email invalide'),
    body('dateOfBirth')
      .optional()
      .isISO8601()
      .withMessage('Date de naissance invalide'),
    body('gender')
      .optional()
      .isIn(['male', 'female', 'other', 'prefer_not_to_say'])
      .withMessage('Genre invalide'),
    body('address')
      .optional()
      .trim(),
    body('city')
      .optional()
      .trim(),
    body('country')
      .optional()
      .trim(),
    body('postalCode')
      .optional()
      .trim(),
    
    // 🎯 CHAMP pour indiquer quelle source de données a été choisie
    body('selectedDataSource')
      .optional()
      .custom((value) => {
        if (value && (!value.userId || !value.module)) {
          throw new Error('Source de données invalide');
        }
        return true;
      })
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

      let { 
        phoneNumber, 
        pin, 
        firstName, 
        lastName,
        email,
        dateOfBirth,
        gender,
        address,
        city,
        country,
        postalCode,
        selectedDataSource
      } = req.body;
      
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

      // 🔍 LOGIQUE DONNÉES EXISTANTES
      let finalUserData = {
        firstName: firstName || user.firstName,
        lastName: lastName || user.lastName,
        email: email || user.email,
        dateOfBirth: dateOfBirth || user.dateOfBirth,
        gender: gender || user.gender,
        address: address || user.address,
        city: city || user.city,
        country: country || user.country,
        postalCode: postalCode || user.postalCode
      };

      // 🎯 Si utilisateur a choisi une source de données existante
      if (selectedDataSource) {
        console.log(`📋 Utilisation source existante: ${selectedDataSource.module} (User ID: ${selectedDataSource.userId})`);
        
        try {
          // Récupérer les données de la source choisie
          const sourceUser = await User.findByPk(selectedDataSource.userId);
          
          if (sourceUser) {
            // Fusionner avec les données de la source choisie (priorité aux données de la source)
            finalUserData = {
              firstName: sourceUser.firstName !== 'Utilisateur' ? sourceUser.firstName : (firstName || finalUserData.firstName),
              lastName: sourceUser.lastName !== 'Temporaire' ? sourceUser.lastName : (lastName || finalUserData.lastName),
              email: sourceUser.email || email || finalUserData.email,
              dateOfBirth: sourceUser.dateOfBirth || dateOfBirth || finalUserData.dateOfBirth,
              gender: sourceUser.gender || gender || finalUserData.gender,
              address: sourceUser.address || address || finalUserData.address,
              city: sourceUser.city || city || finalUserData.city,
              country: sourceUser.country || country || finalUserData.country,
              postalCode: sourceUser.postalCode || postalCode || finalUserData.postalCode
            };
            
            console.log(`✅ Données fusionnées depuis source ${selectedDataSource.module}`);
          }
        } catch (sourceError) {
          console.error('Erreur récupération source choisie:', sourceError);
          // Continuer avec les données fournies par l'utilisateur
        }
      }

      // Nettoyer les valeurs temporaires si présentes
      if (finalUserData.firstName === 'Utilisateur') {
        finalUserData.firstName = firstName || 'Prénom';
      }
      if (finalUserData.lastName === 'Temporaire') {
        finalUserData.lastName = lastName || 'Nom';
      }

      // 📝 HISTORIQUE DES DONNÉES (pour audit)
      const dataHistory = {
        originalData: {
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          dateOfBirth: user.dateOfBirth,
          gender: user.gender,
          address: user.address,
          city: user.city,
          country: user.country,
          postalCode: user.postalCode
        },
        selectedSource: selectedDataSource || null,
        finalData: finalUserData,
        updatedAt: new Date()
      };

      // Hasher PIN et mettre à jour utilisateur avec toutes les données
      await user.update({
        pinCode: pin, // Le hook beforeUpdate du model va hasher automatiquement
        firstName: finalUserData.firstName,
        lastName: finalUserData.lastName,
        email: finalUserData.email,
        dateOfBirth: finalUserData.dateOfBirth,
        gender: finalUserData.gender,
        address: finalUserData.address,
        city: finalUserData.city,
        country: finalUserData.country,
        postalCode: finalUserData.postalCode,
        status: 'active',
        setupCompletedAt: new Date(),
        // 🆕 Stocker l'historique des données pour audit
        dataSetupHistory: dataHistory
      });

      // 🔄 Si une source existante a été choisie, marquer la fusion
      if (selectedDataSource) {
        try {
          // Optionnel: Marquer l'utilisateur source comme "fusionné"
          const sourceUser = await User.findByPk(selectedDataSource.userId);
          if (sourceUser && sourceUser.id !== user.id) {
            await sourceUser.update({
              mergedIntoUserId: user.id,
              mergedAt: new Date(),
              status: 'merged' // Nouveau statut pour les profils fusionnés
            });
            
            console.log(`🔄 Profil source ${selectedDataSource.userId} marqué comme fusionné`);
          }
        } catch (mergeError) {
          console.error('Erreur marquage fusion:', mergeError);
          // Continuer même si le marquage échoue
        }
      }

      // Générer tokens
      const tokens = authService.generateTokens(user, {
        sessionId: `session_${Date.now()}`,
        loginMethod: 'pin_setup',
        ipAddress: req.ip
      });

      console.log(`✅ Configuration terminée pour ${user.phoneNumber}: ${finalUserData.firstName} ${finalUserData.lastName}`);

      res.json({
        success: true,
        message: 'Configuration terminée avec succès',
        user: {
          id: user.id,
          phoneNumber: user.phoneNumber,
          firstName: finalUserData.firstName,
          lastName: finalUserData.lastName,
          email: finalUserData.email,
          status: user.status,
          setupMethod: selectedDataSource ? 'existing_data' : 'manual_entry'
        },
        tokens,
        // 📊 Résumé de la configuration pour debug/audit
        setupSummary: {
          dataSource: selectedDataSource ? {
            module: selectedDataSource.module,
            userId: selectedDataSource.userId
          } : 'manual',
          fieldsCompleted: Object.keys(finalUserData).filter(key => 
            finalUserData[key] && 
            finalUserData[key] !== 'Utilisateur' && 
            finalUserData[key] !== 'Temporaire'
          ).length,
          completionLevel: Math.round(
            (Object.keys(finalUserData).filter(key => 
              finalUserData[key] && 
              finalUserData[key] !== 'Utilisateur' && 
              finalUserData[key] !== 'Temporaire'
            ).length / Object.keys(finalUserData).length) * 100
          )
        }
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
        return res.status(404).json({
          error: 'PIN non configuré pour ce numéro',
          code: 'PIN_NOT_CONFIGURED'
        });
      }

      // Vérification PIN
      const bcrypt = require('bcryptjs');
      const isPinValid = await bcrypt.compare(pin, user.pinCode);

      if (!isPinValid) {
        return res.status(400).json({
          error: 'PIN incorrect',
          code: 'INVALID_PIN'
        });
      }

      // Mettre à jour dernière connexion
      await user.update({
        lastLoginAt: new Date(),
        lastLoginIP: req.ip
      });

      // Générer tokens
      const tokens = authService.generateTokens(user, {
        sessionId: `session_${Date.now()}`,
        loginMethod: 'pin',
        ipAddress: req.ip
      });

      res.json({
        success: true,
        message: 'Connexion réussie',
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

// 🆕 NOUVELLE ROUTE : Aperçu des données de fusion
router.post('/preview-data-merge',
  authLimiter,
  [
    body('phoneNumber').notEmpty(),
    body('selectedDataSource').notEmpty(),
    body('userProvidedData').optional()
  ],
  async (req, res) => {
    try {
      const { phoneNumber, selectedDataSource, userProvidedData = {} } = req.body;
      const formattedNumber = twilioService.formatPhoneNumber(phoneNumber);

      // Récupérer utilisateur temporaire
      const tempUser = await User.findOne({ where: { phoneNumber: formattedNumber } });
      if (!tempUser) {
        return res.status(404).json({
          error: 'Utilisateur temporaire introuvable',
          code: 'TEMP_USER_NOT_FOUND'
        });
      }

      // Récupérer source choisie
      const sourceUser = await User.findByPk(selectedDataSource.userId);
      if (!sourceUser) {
        return res.status(404).json({
          error: 'Source de données introuvable',
          code: 'DATA_SOURCE_NOT_FOUND'
        });
      }

      // Simuler la fusion des données
      const mergedData = {
        firstName: userProvidedData.firstName || 
                  (sourceUser.firstName !== 'Utilisateur' ? sourceUser.firstName : tempUser.firstName),
        lastName: userProvidedData.lastName || 
                 (sourceUser.lastName !== 'Temporaire' ? sourceUser.lastName : tempUser.lastName),
        email: userProvidedData.email || sourceUser.email || tempUser.email,
        dateOfBirth: userProvidedData.dateOfBirth || sourceUser.dateOfBirth || tempUser.dateOfBirth,
        gender: userProvidedData.gender || sourceUser.gender || tempUser.gender,
        address: userProvidedData.address || sourceUser.address || tempUser.address,
        city: userProvidedData.city || sourceUser.city || tempUser.city,
        country: userProvidedData.country || sourceUser.country || tempUser.country,
        postalCode: userProvidedData.postalCode || sourceUser.postalCode || tempUser.postalCode
      };

      // Identifier les conflits potentiels
      const conflicts = [];
      Object.keys(mergedData).forEach(key => {
        const sourceValue = sourceUser[key];
        const providedValue = userProvidedData[key];
        
        if (sourceValue && providedValue && sourceValue !== providedValue) {
          conflicts.push({
            field: key,
            sourceValue: sourceValue,
            providedValue: providedValue,
            suggestion: 'user_provided'
          });
        }
      });

      res.json({
        success: true,
        preview: {
          mergedData,
          conflicts,
          source: {
            module: selectedDataSource.module,
            userId: selectedDataSource.userId,
            originalData: {
              firstName: sourceUser.firstName,
              lastName: sourceUser.lastName,
              email: sourceUser.email,
              dateOfBirth: sourceUser.dateOfBirth,
              gender: sourceUser.gender,
              address: sourceUser.address,
              city: sourceUser.city,
              country: sourceUser.country,
              postalCode: sourceUser.postalCode
            }
          },
          completionScore: Math.round(
            (Object.keys(mergedData).filter(key => 
              mergedData[key] && 
              mergedData[key] !== 'Utilisateur' && 
              mergedData[key] !== 'Temporaire'
            ).length / Object.keys(mergedData).length) * 100
          )
        }
      });

    } catch (error) {
      console.error('Erreur aperçu fusion données:', error);
      res.status(500).json({
        error: 'Erreur lors de l\'aperçu de fusion',
        code: 'PREVIEW_MERGE_ERROR'
      });
    }
  }
);

// 🔍 NOUVELLE ROUTE : Récupérer détails données existantes
router.get('/existing-data/:phoneNumber',
  authLimiter,
  async (req, res) => {
    try {
      const { phoneNumber } = req.params;
      const formattedNumber = twilioService.formatPhoneNumber(phoneNumber);
      
      const foundDataSources = await UserDataSearchService.searchUserDataAcrossModules(formattedNumber);
      const formattedData = UserDataSearchService.formatResultsForFrontend(foundDataSources);
      
      res.json({
        success: true,
        phoneNumber: formattedNumber,
        existingData: {
          found: formattedData.length > 0,
          sources: formattedData,
          summary: {
            totalSources: formattedData.length,
            modules: [...new Set(formattedData.map(s => s.module.name))],
            recommendedData: formattedData.length > 0 ? 
              UserDataSearchService.mergeUserDataSources(
                formattedData.map(s => ({ data: s.data, priority: s.metadata.priority }))
              ) : null
          }
        }
      });
      
    } catch (error) {
      console.error('Erreur récupération données existantes:', error);
      res.status(500).json({
        error: 'Erreur lors de la récupération des données',
        code: 'EXISTING_DATA_ERROR'
      });
    }
  }
);

module.exports = router;