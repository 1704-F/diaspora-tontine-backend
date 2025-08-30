//src/core/controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../../../models');
const { body, validationResult } = require('express-validator');

// Générer token JWT
const generateToken = (user) => {
  return jwt.sign(
    { 
      userId: user.id,
      phoneNumber: user.phoneNumber,
      status: user.status 
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// Validation rules
const registerValidation = [
  body('phoneNumber')
    .matches(/^\+?[1-9]\d{1,14}$/)
    .withMessage('Numéro de téléphone invalide'),
  body('firstName')
    .isLength({ min: 2, max: 50 })
    .withMessage('Prénom requis (2-50 caractères)'),
  body('lastName')
    .isLength({ min: 2, max: 50 })
    .withMessage('Nom requis (2-50 caractères)'),
  body('email')
    .optional()
    .isEmail()
    .withMessage('Email invalide'),
  body('password')
    .optional()
    .isLength({ min: 6 })
    .withMessage('Mot de passe minimum 6 caractères')
];

const loginValidation = [
  body('phoneNumber')
    .matches(/^\+?[1-9]\d{1,14}$/)
    .withMessage('Numéro de téléphone invalide')
];

// @desc    Inscription utilisateur
// @route   POST /api/v1/auth/register
// @access  Public
const register = async (req, res) => {
  try {
    // Vérifier les erreurs de validation
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: errors.array()
      });
    }

    const { phoneNumber, firstName, lastName, email, password, country, preferredLanguage } = req.body;

    // Vérifier si l'utilisateur existe déjà
    const existingUser = await User.findOne({ 
      where: { phoneNumber },
      paranoid: false // Inclure les utilisateurs soft-deleted
    });

    if (existingUser && !existingUser.deletedAt) {
      return res.status(400).json({
        success: false,
        message: 'Un compte avec ce numéro existe déjà'
      });
    }

    // Si utilisateur soft-deleted, le restaurer
    if (existingUser && existingUser.deletedAt) {
      await existingUser.restore();
      await existingUser.update({
        firstName,
        lastName,
        email,
        password,
        country: country || 'FR',
        preferredLanguage: preferredLanguage || 'fr',
        status: 'pending'
      });

      return res.status(200).json({
        success: true,
        message: 'Compte restauré avec succès',
        data: {
          user: existingUser,
          requiresVerification: true
        }
      });
    }

    // Créer nouvel utilisateur
    const userData = {
      phoneNumber,
      firstName,
      lastName,
      country: country || 'FR',
      preferredLanguage: preferredLanguage || 'fr',
      status: 'pending' // Nécessite vérification SMS
    };

    if (email) userData.email = email;
    if (password) userData.password = password;

    const user = await User.create(userData);

    // TODO: Envoyer SMS de vérification
    console.log(`📱 SMS OTP à envoyer à ${phoneNumber}`);

    res.status(201).json({
      success: true,
      message: 'Inscription réussie. Vérifiez votre SMS pour activer votre compte.',
      data: {
        user,
        requiresVerification: true
      }
    });

  } catch (error) {
    console.error('Erreur inscription:', error);
    
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({
        success: false,
        message: 'Ce numéro de téléphone est déjà utilisé'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'inscription'
    });
  }
};

// @desc    Connexion avec SMS OTP
// @route   POST /api/v1/auth/login-sms
// @access  Public
const loginSMS = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Numéro de téléphone invalide',
        errors: errors.array()
      });
    }

    const { phoneNumber } = req.body;

    // Vérifier si l'utilisateur existe
    const user = await User.findOne({ where: { phoneNumber } });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Aucun compte trouvé avec ce numéro'
      });
    }

    if (user.status === 'suspended' || user.status === 'deactivated') {
      return res.status(403).json({
        success: false,
        message: 'Compte suspendu ou désactivé'
      });
    }

    // TODO: Générer et envoyer SMS OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`📱 Code OTP pour ${phoneNumber}: ${otpCode}`);

    // Stocker OTP temporairement (Redis ou base de données)
    // Pour le développement, on peut stocker dans le user
    await user.update({
      tempOtpCode: await bcrypt.hash(otpCode, 10),
      tempOtpExpiry: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
    });

    res.status(200).json({
      success: true,
      message: 'Code de vérification envoyé par SMS',
      data: {
        phoneNumber,
        expiresIn: 300, // 5 minutes
        // TODO: Retirer en production
        ...(process.env.NODE_ENV === 'development' && { devOtpCode: otpCode })
      }
    });

  } catch (error) {
    console.error('Erreur login SMS:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'envoi du SMS'
    });
  }
};

// @desc    Vérifier OTP et connexion
// @route   POST /api/v1/auth/verify-otp
// @access  Public
const verifyOTP = async (req, res) => {
  try {
    const { phoneNumber, otpCode, rememberMe } = req.body;

    if (!phoneNumber || !otpCode) {
      return res.status(400).json({
        success: false,
        message: 'Numéro de téléphone et code OTP requis'
      });
    }

    const user = await User.findOne({ where: { phoneNumber } });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      });
    }

    // Vérifier si OTP expiré
    if (!user.tempOtpExpiry || new Date() > user.tempOtpExpiry) {
      return res.status(400).json({
        success: false,
        message: 'Code OTP expiré'
      });
    }

    // Vérifier OTP
    const isValidOTP = await bcrypt.compare(otpCode, user.tempOtpCode || '');
    
    if (!isValidOTP) {
      // Incrémenter tentatives échouées
      await user.increment('loginAttempts');
      
      if (user.loginAttempts >= 5) {
        await user.update({
          lockedUntil: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
        });
        
        return res.status(423).json({
          success: false,
          message: 'Compte temporairement bloqué suite à trop de tentatives'
        });
      }

      return res.status(400).json({
        success: false,
        message: 'Code OTP incorrect'
      });
    }

    // Réinitialiser les tentatives et activer le compte
    await user.update({
      status: 'active',
      phoneVerified: true,
      phoneVerifiedAt: new Date(),
      loginAttempts: 0,
      lockedUntil: null,
      tempOtpCode: null,
      tempOtpExpiry: null,
      lastLoginAt: new Date(),
      lastLoginIP: req.ip
    });

    // Générer token JWT
    const token = generateToken(user);

    res.status(200).json({
      success: true,
      message: 'Connexion réussie',
      data: {
        user,
        token,
        expiresIn: rememberMe ? '30d' : '7d'
      }
    });

  } catch (error) {
    console.error('Erreur vérification OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la vérification'
    });
  }
};

// @desc    Connexion avec PIN
// @route   POST /api/v1/auth/login-pin
// @access  Public
const loginPIN = async (req, res) => {
  try {
    const { phoneNumber, pinCode } = req.body;

    if (!phoneNumber || !pinCode) {
      return res.status(400).json({
        success: false,
        message: 'Numéro de téléphone et code PIN requis'
      });
    }

    const user = await User.findOne({ where: { phoneNumber } });

    if (!user || !user.pinCode) {
      return res.status(404).json({
        success: false,
        message: 'Code PIN non configuré pour ce compte'
      });
    }

    // Vérifier si compte bloqué
    if (user.lockedUntil && new Date() < user.lockedUntil) {
      return res.status(423).json({
        success: false,
        message: 'Compte temporairement bloqué'
      });
    }

    // Vérifier PIN
    const isValidPIN = await bcrypt.compare(pinCode, user.pinCode);
    
    if (!isValidPIN) {
      await user.increment('loginAttempts');
      
      if (user.loginAttempts >= 5) {
        await user.update({
          lockedUntil: new Date(Date.now() + 30 * 60 * 1000)
        });
      }

      return res.status(400).json({
        success: false,
        message: 'Code PIN incorrect'
      });
    }

    // Réinitialiser tentatives
    await user.update({
      loginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastLoginIP: req.ip
    });

    const token = generateToken(user);

    res.status(200).json({
      success: true,
      message: 'Connexion par PIN réussie',
      data: {
        user,
        token
      }
    });

  } catch (error) {
    console.error('Erreur login PIN:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la connexion'
    });
  }
};

// @desc    Définir code PIN
// @route   POST /api/v1/auth/set-pin
// @access  Private
const setPIN = async (req, res) => {
  try {
    const { pinCode, confirmPinCode } = req.body;

    if (!pinCode || !confirmPinCode) {
      return res.status(400).json({
        success: false,
        message: 'Code PIN et confirmation requis'
      });
    }

    if (pinCode !== confirmPinCode) {
      return res.status(400).json({
        success: false,
        message: 'Les codes PIN ne correspondent pas'
      });
    }

    if (!/^\d{4,6}$/.test(pinCode)) {
      return res.status(400).json({
        success: false,
        message: 'Le code PIN doit contenir 4 à 6 chiffres'
      });
    }

    await req.user.update({
      pinCode // Sera hashé automatiquement par le hook beforeUpdate
    });

    res.status(200).json({
      success: true,
      message: 'Code PIN défini avec succès'
    });

  } catch (error) {
    console.error('Erreur définition PIN:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la définition du PIN'
    });
  }
};

// @desc    Déconnexion
// @route   POST /api/v1/auth/logout
// @access  Private
const logout = async (req, res) => {
  try {
    // TODO: Invalider le token côté serveur (blacklist Redis)
    
    res.status(200).json({
      success: true,
      message: 'Déconnexion réussie'
    });
  } catch (error) {
    console.error('Erreur déconnexion:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la déconnexion'
    });
  }
};

// @desc    Profil utilisateur
// @route   GET /api/v1/auth/profile
// @access  Private
const getProfile = async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: {
        user: req.user
      }
    });
  } catch (error) {
    console.error('Erreur récupération profil:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du profil'
    });
  }
};

module.exports = {
  register,
  loginSMS,
  verifyOTP,
  loginPIN,
  setPIN,
  logout,
  getProfile,
  registerValidation,
  loginValidation
};