'use strict';
const { Model } = require('sequelize');
const bcrypt = require('bcryptjs');

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
      // Associations avec les autres modèles
      User.hasMany(models.AssociationMember, {
        foreignKey: 'userId',
        as: 'associationMemberships'
      });
      
      User.hasMany(models.TontineParticipant, {
        foreignKey: 'userId', 
        as: 'tontineParticipations'
      });
      
      User.hasMany(models.Tontine, {
        foreignKey: 'organizerId',
        as: 'organizedTontines'
      });
      
      User.hasMany(models.Transaction, {
        foreignKey: 'userId',
        as: 'transactions'
      });
      
      User.hasMany(models.Document, {
        foreignKey: 'userId',
        as: 'documents'
      });
    }

    // Méthodes d'instance
    async checkPassword(password) {
      return bcrypt.compare(password, this.password);
    }

    // Supprimer le password des JSON
    toJSON() {
      const values = { ...this.get() };
      delete values.password;
      delete values.pinCode;
      return values;
    }

    // Calculer la réputation globale
    calculateReputation() {
      const associationScore = this.associationReputationScore || 0;
      const tontineScore = this.tontineReputationScore || 0;
      return Math.round((associationScore + tontineScore) / 2);
    }
  }

  User.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    
    // 📱 IDENTIFICATION UNIQUE
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        len: [8, 20],
        isNumeric: false // Permet les +, espaces, tirets
      },
      comment: 'Numéro de téléphone unique (identifiant principal)'
    },
    
    email: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
      validate: {
        isEmail: true
      }
    },
    
    // 👤 INFORMATIONS PERSONNELLES
    firstName: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        len: [2, 50]
      }
    },
    
    lastName: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        len: [2, 50]
      }
    },
    
    dateOfBirth: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    
    gender: {
      type: DataTypes.ENUM('male', 'female', 'other', 'prefer_not_to_say'),
      allowNull: true
    },
    
    // 📍 ADRESSE
    address: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    
    city: {
      type: DataTypes.STRING,
      allowNull: true
    },
    
    country: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: 'FR'
    },
    
    postalCode: {
      type: DataTypes.STRING,
      allowNull: true
    },
    
    // 🔐 AUTHENTIFICATION
    password: {
      type: DataTypes.STRING,
      allowNull: true, // Optionnel si connexion SMS uniquement
      validate: {
        len: [6, 255]
      }
    },
    
    pinCode: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        len: [4, 6],
        isNumeric: true
      },
      comment: 'Code PIN pour connexion rapide'
    },
    
    // 📱 VERIFICATION & STATUT
    phoneVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    
    phoneVerifiedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    emailVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    
    emailVerifiedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    status: {
      type: DataTypes.ENUM('pending', 'active', 'suspended', 'deactivated'),
      allowNull: false,
      defaultValue: 'pending'
    },
    
    // 🆔 KYC (Know Your Customer)
    kycStatus: {
      type: DataTypes.ENUM('none', 'pending', 'approved', 'rejected'),
      allowNull: false,
      defaultValue: 'none'
    },
    
    kycDocuments: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'URLs des documents KYC (CNI, passeport, etc.)'
    },
    
    kycVerifiedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    // 💳 PAIEMENTS
    preferredCurrency: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'EUR',
      validate: {
        isIn: [['EUR', 'USD', 'XOF', 'GBP', 'CAD']]
      }
    },
    
    stripeCustomerId: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'ID client Stripe pour l\'Europe'
    },
    
    squareCustomerId: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'ID client Square pour les USA'
    },
    
    // ⭐ REPUTATION SYSTEM
    associationReputationScore: {
      type: DataTypes.DECIMAL(3, 2),
      allowNull: true,
      defaultValue: 0.00,
      validate: {
        min: 0.00,
        max: 5.00
      },
      comment: 'Note réputation associations (0-5)'
    },
    
    tontineReputationScore: {
      type: DataTypes.DECIMAL(3, 2),
      allowNull: true,
      defaultValue: 0.00,
      validate: {
        min: 0.00,
        max: 5.00
      },
      comment: 'Note réputation tontines (0-5)'
    },
    
    totalAssociationsJoined: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    
    totalTontinesCompleted: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    
    totalTontinesDefaulted: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    
    // 🌍 PREFERENCES
    preferredLanguage: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'fr',
      validate: {
        isIn: [['fr', 'en', 'it', 'es']]
      }
    },
    
    timezone: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: 'Europe/Paris'
    },
    
    // 📱 NOTIFICATIONS
    notificationSettings: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {
        pushEnabled: true,
        smsEnabled: true,
        emailEnabled: false,
        cotisationReminders: true,
        tontineUpdates: true,
        aidApprovals: true
      }
    },
    
    fcmTokens: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Tokens Firebase pour notifications push'
    },
    
    // 🔒 SECURITE
    loginAttempts: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    
    lockedUntil: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    lastLoginAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    lastLoginIP: {
      type: DataTypes.STRING,
      allowNull: true
    },
    
    // 📊 METADATA
    profileCompleteness: {
      type: DataTypes.INTEGER,
      defaultValue: 30,
      validate: {
        min: 0,
        max: 100
      },
      comment: 'Pourcentage de complétion du profil'
    },
    
    referralCode: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
      comment: 'Code parrainage unique'
    },
    
    referredBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    }
    
  }, {
    sequelize,
    modelName: 'User',
    tableName: 'users',
    underscored: true,
    timestamps: true,
    paranoid: true, // Soft delete avec deleted_at
    
    hooks: {
      beforeCreate: async (user) => {
        // Hash password si fourni
        if (user.password) {
          user.password = await bcrypt.hash(user.password, 12);
        }
        
        // Hash PIN code si fourni
        if (user.pinCode) {
          user.pinCode = await bcrypt.hash(user.pinCode, 12);
        }
        
        // Générer code parrainage unique
        if (!user.referralCode) {
          const timestamp = Date.now().toString().slice(-6);
          const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
          user.referralCode = `REF${timestamp}${random}`;
        }
      },
      
      beforeUpdate: async (user) => {
        // Rehash password si modifié
        if (user.changed('password') && user.password) {
          user.password = await bcrypt.hash(user.password, 12);
        }
        
        // Rehash PIN si modifié
        if (user.changed('pinCode') && user.pinCode) {
          user.pinCode = await bcrypt.hash(user.pinCode, 12);
        }
      },
      
      afterCreate: (user) => {
        console.log(`👤 Nouvel utilisateur créé: ${user.firstName} ${user.lastName} (${user.phoneNumber})`);
      }
    },
    
    indexes: [
      { fields: ['phone_number'], unique: true },
      { fields: ['email'], unique: true, where: { email: { [sequelize.Sequelize.Op.ne]: null } } },
      { fields: ['status'] },
      { fields: ['kyc_status'] },
      { fields: ['referral_code'], unique: true },
      { fields: ['created_at'] }
    ]
  });

  return User;
};