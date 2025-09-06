//src/models/user.js
"use strict";
const { Model } = require("sequelize");
const bcrypt = require("bcryptjs");

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
      // Associations avec les autres modèles
      User.hasMany(models.AssociationMember, {
        foreignKey: "userId",
        as: "associationMemberships",
      });

      User.hasMany(models.TontineParticipant, {
        foreignKey: "userId",
        as: "tontineParticipations",
      });

      User.hasMany(models.Tontine, {
        foreignKey: "organizerId",
        as: "organizedTontines",
      });

      User.hasMany(models.Transaction, {
        foreignKey: "userId",
        as: "transactions",
      });

      User.hasMany(models.Document, {
        foreignKey: "userId",
        as: "documents",
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

  User.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },

      // 📱 IDENTIFICATION UNIQUE
      phoneNumber: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: "phone_number",
        validate: {
          len: [8, 20],
          isNumeric: false, // Permet les +, espaces, tirets
        },
        comment: "Numéro de téléphone unique (identifiant principal)",
      },

      email: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
          isEmail: true,
        },
      },

      // 👤 INFORMATIONS PERSONNELLES
      firstName: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          len: [2, 50],
        },
      },

      lastName: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          len: [2, 50],
        },
      },

      dateOfBirth: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },

      gender: {
        type: DataTypes.ENUM("male", "female", "other", "prefer_not_to_say"),
        allowNull: true,
      },

      // 📍 ADRESSE
      address: {
        type: DataTypes.TEXT,
        allowNull: true,
      },

      city: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      country: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: "FR",
      },

      postalCode: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },

      // 🔐 SECURITE & AUTHENTIFICATION
      password: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
          len: [8, 128],
        },
        comment: "Hash du mot de passe (optionnel)",
      },

      pinCode: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {},
        comment: "Hash du code PIN (obligatoire)",
      },

      // 📋 STATUTS & ROLES
      status: {
        type: DataTypes.ENUM(
          "pending_verification",
          "active",
          "suspended",
          "banned",
          "inactive"
        ),
        defaultValue: "pending_verification",
      },

      role: {
        type: DataTypes.ENUM("member", "association_admin", "platform_admin"),
        defaultValue: "member",
      },

      // 🔍 KYC (Know Your Customer)
      kycStatus: {
        type: DataTypes.ENUM(
          "not_started",
          "in_progress",
          "approved",
          "rejected",
          "expired"
        ),
        defaultValue: "not_started",
      },

      kycDocuments: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {},
        comment: "Documents KYC: ID, selfie, proof_address",
      },

      kycVerifiedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      enabledModules: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {
          associations: { enabled: true, plan: "free" },
          tontines: { enabled: true, plan: "free" },
          family: { enabled: false, plan: null },
          commerce: { enabled: false, plan: null },
        },
        comment: "Modules activés par utilisateur",
      },

      // 💰 FINANCE & REPUTATION
      associationReputationScore: {
        type: DataTypes.DECIMAL(3, 2),
        defaultValue: 5.0,
        validate: {
          min: 0.0,
          max: 5.0,
        },
      },

      tontineReputationScore: {
        type: DataTypes.DECIMAL(3, 2),
        defaultValue: 5.0,
        validate: {
          min: 0.0,
          max: 5.0,
        },
      },

      totalContributed: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0.0,
        comment: "Total cotisations payées",
      },

      // 🌍 LOCALISATION & PREFERENCES
      language: {
        type: DataTypes.STRING(5),
        defaultValue: "fr",
        validate: {
          isIn: [["fr", "en", "es", "ar"]],
        },
      },

      timezone: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: "Europe/Paris",
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
          aidApprovals: true,
        },
      },

      fcmTokens: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: "Tokens Firebase pour notifications push",
      },

      // 🔒 SECURITE
      loginAttempts: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },

      lockedUntil: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      lastLoginAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      lastLoginIP: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      // 📊 METADATA
      profileCompleteness: {
        type: DataTypes.INTEGER,
        defaultValue: 30,
        validate: {
          min: 0,
          max: 100,
        },
        comment: "Pourcentage de complétion du profil",
      },

      referralCode: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "Code parrainage unique",
      },

      referredBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "users",
          key: "id",
        },
      },
    },
    {
      sequelize,
      modelName: "User",
      tableName: "users",
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
            const random = Math.floor(Math.random() * 1000)
              .toString()
              .padStart(3, "0");
            user.referralCode = `REF${timestamp}${random}`;
          }
        },

        beforeUpdate: async (user) => {
          // Rehash password si modifié
          if (user.changed("password") && user.password) {
            user.password = await bcrypt.hash(user.password, 12);
          }

          // Rehash PIN si modifié
          if (user.changed("pinCode") && user.pinCode) {
            user.pinCode = await bcrypt.hash(user.pinCode, 12);
          }
        },

        afterCreate: (user) => {
          console.log(
            `👤 Nouvel utilisateur créé: ${user.firstName} ${user.lastName} (${user.phoneNumber})`
          );
        },
      },

      indexes: [
        {
          fields: ["phone_number"],
          unique: true,
          name: "users_phone_number_unique",
        },
        {
          fields: ["email"],
          unique: true,
          where: { email: { [sequelize.Sequelize.Op.ne]: null } },
          name: "users_email_unique",
        },
        { fields: ["status"] },
        { fields: ["kyc_status"] },
        {
          fields: ["referral_code"],
          unique: true,
          name: "users_referral_code_unique",
        },
        { fields: ["created_at"] },
      ],
    }
  );

  return User;
};
