//src/modules/association/models/AssociationMember.js
'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class AssociationMember extends Model {
    static associate(models) {
      // Un membre appartient à un utilisateur
      AssociationMember.belongsTo(models.User, {
        foreignKey: 'userId',
        as: 'user'
      });
      
      // Un membre appartient à une association
      AssociationMember.belongsTo(models.Association, {
        foreignKey: 'associationId',
        as: 'association'
      });
      
      // Un membre peut appartenir à une section (optionnel)
      AssociationMember.belongsTo(models.Section, {
        foreignKey: 'sectionId',
        as: 'section'
      });
      
      // Un membre a plusieurs transactions (cotisations, aides)
      AssociationMember.hasMany(models.Transaction, {
        foreignKey: 'memberId',
        as: 'transactions'
      });
    }

    // Calculer ancienneté totale (import + app)
    getTotalSeniority() {
      const imported = this.ancienneteImported || 0; // En mois
      const app = this.getAppSeniority(); // En mois
      return imported + app;
    }

    // Calculer ancienneté dans l'app
    getAppSeniority() {
      if (!this.joinDate) return 0;
      const now = new Date();
      const join = new Date(this.joinDate);
      const diffTime = Math.abs(now - join);
      return Math.floor(diffTime / (1000 * 60 * 60 * 24 * 30)); // Mois
    }

    // Vérifier si cotisation à jour ce mois
    async isCurrentMonthPaid() {
      const { Transaction } = sequelize.models;
      const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const endOfMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);
      
      const payment = await Transaction.findOne({
        where: { 
          memberId: this.id,
          type: 'cotisation',
          status: 'completed',
          createdAt: {
            [sequelize.Sequelize.Op.between]: [startOfMonth, endOfMonth]
          }
        }
      });
      
      return !!payment;
    }

    // Calculer total cotisations versées
    async getTotalContributions() {
      const { Transaction } = sequelize.models;
      const result = await Transaction.findOne({
        where: { 
          memberId: this.id,
          type: 'cotisation',
          status: 'completed'
        },
        attributes: [
          [sequelize.fn('SUM', sequelize.col('amount')), 'total']
        ],
        raw: true
      });
      return parseFloat(result?.total || 0);
    }

    // Calculer total aides reçues
    async getTotalAidsReceived() {
      const { Transaction } = sequelize.models;
      const result = await Transaction.findOne({
        where: { 
          memberId: this.id,
          type: 'aide',
          status: 'completed'
        },
        attributes: [
          [sequelize.fn('SUM', sequelize.col('amount')), 'total']
        ],
        raw: true
      });
      return parseFloat(result?.total || 0);
    }

    // Vérifier éligibilité aide selon règles
    isEligibleForAid(aidAmount) {
      if (this.status !== 'active') return false;
      
      const settings = this.association?.settings || {};
      const aidRules = settings.aidRules || {};
      
      // Vérifier ancienneté minimum
      if (aidRules.minSeniority && this.getTotalSeniority() < aidRules.minSeniority) {
        return false;
      }
      
      // Vérifier cotisations à jour
      if (aidRules.requireCurrentPayments && !this.isCurrentMonthPaid()) {
        return false;
      }
      
      return true;
    }
  }

  AssociationMember.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    
    // 🔗 RELATIONS PRINCIPALES
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'Utilisateur membre'
    },
    
    associationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'associations',
        key: 'id'
      },
      comment: 'Association dont il est membre'
    },
    
    sectionId: {
      type: DataTypes.INTEGER,
      allowNull: true, // Null pour associations simples
      references: {
        model: 'sections',
        key: 'id'
      },
      comment: 'Section géographique (optionnel)'
    },
    
    // 🏷️ TYPE & STATUT MEMBRE (CONFIGURABLE)
    memberType: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: 'Type membre configurable par association (ex: "actif", "fondateur", "ancien")'
    },
    
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'pending',
      validate: {
        isIn: [['pending', 'active', 'suspended', 'excluded', 'inactive']]
      },
      comment: 'Statut actuel du membre'
    },
    
    // 📅 DATES IMPORTANTES
    joinDate: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: 'Date d\'adhésion à l\'association'
    },
    
    approvedDate: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date d\'approbation par le bureau'
    },
    
    approvedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'Membre bureau qui a approuvé'
    },
    
    // ⏰ ANCIENNETÉ (DIFFÉRENCIATEUR CLÉ)
    ancienneteImported: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: 'Ancienneté avant app (mois) - import historique'
    },
    
    // 🎯 RÔLES & PERMISSIONS
    roles: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Rôles dans association/section (configurable JSON)'
    },
    
    permissions: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Permissions spécifiques (transparence configurable)'
    },
    
    // 💰 CONFIGURATION COTISATIONS
    cotisationAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      comment: 'Montant cotisation personnalisée (si différent du type)'
    },
    
    autoPaymentEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Prélèvement automatique activé'
    },
    
    paymentMethod: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: 'Méthode paiement préférée (card, iban)'
    },
    
    paymentMethodId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'ID méthode paiement (Stripe/Square)'
    },
    
    // 📊 STATISTIQUES FINANCIÈRES
    totalContributed: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.00,
      comment: 'Total cotisations versées (mis à jour automatiquement)'
    },
    
    totalAidsReceived: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.00,
      comment: 'Total aides reçues (mis à jour automatiquement)'
    },
    
    lastContributionDate: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date dernière cotisation'
    },
    
    contributionStatus: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'uptodate',
      validate: {
        isIn: [['uptodate', 'late', 'very_late']]
      },
      comment: 'Statut cotisations'
    },
    
    // 📋 INFORMATIONS ADDITIONNELLES
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Notes internes bureau association'
    },
    
    socialProfileVisible: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: 'Profil visible autres membres'
    },
    
    // 📱 PREFERENCES COMMUNICATION
    notificationPreferences: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Préférences notifications (SMS, email, push)'
    },
    
    // 🔄 HISTORIQUE TRANSFERTS
    transferHistory: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Historique transferts inter-sections'
    },
    
    // 📅 DATES AUDIT
    lastActiveDate: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Dernière activité dans association'
    },
    
    suspensionReason: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Raison suspension/exclusion'
    }
  }, {
    sequelize,
    modelName: 'AssociationMember',
    tableName: 'association_members',
    underscored: true,
    timestamps: true,
    
    indexes: [
      {
        fields: ['user_id']
      },
      {
        fields: ['association_id']
      },
      {
        fields: ['section_id']
      },
      {
        fields: ['status']
      },
      {
        fields: ['member_type']
      },
      {
        unique: true,
        fields: ['user_id', 'association_id'],
        name: 'unique_user_per_association'
      },
      {
        fields: ['contribution_status']
      }
    ]
  });

  return AssociationMember;
};