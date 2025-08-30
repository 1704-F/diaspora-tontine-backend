'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Transaction extends Model {
    static associate(models) {
      // Une transaction appartient à un utilisateur
      Transaction.belongsTo(models.User, {
        foreignKey: 'userId',
        as: 'user'
      });
      
      // Transaction peut concerner une association
      Transaction.belongsTo(models.Association, {
        foreignKey: 'associationId',
        as: 'association'
      });
      
      // Transaction peut concerner une section
      Transaction.belongsTo(models.Section, {
        foreignKey: 'sectionId',
        as: 'section'
      });
      
      // Transaction peut concerner un membre association
      Transaction.belongsTo(models.AssociationMember, {
        foreignKey: 'memberId',
        as: 'member'
      });
      
      // Transaction peut concerner une tontine
      Transaction.belongsTo(models.Tontine, {
        foreignKey: 'tontineId',
        as: 'tontine'
      });
      
      // Transaction peut concerner un participant tontine
      Transaction.belongsTo(models.TontineParticipant, {
        foreignKey: 'participantId',
        as: 'participant'
      });
    }

    // Calculer commission sur cette transaction
    calculateCommission() {
      if (['cotisation', 'cotisation_tontine', 'aide'].includes(this.type)) {
        const baseCommission = this.amount * 0.025; // 2.5%
        const fixedFee = 0.25; // 0.25€
        return parseFloat((baseCommission + fixedFee).toFixed(2));
      }
      return 0;
    }

    // Calculer montant net (après commission)
    getNetAmount() {
      const commission = this.commissionAmount || this.calculateCommission();
      return parseFloat((this.amount - commission).toFixed(2));
    }

    // Vérifier si transaction est en attente
    isPending() {
      return ['pending', 'processing'].includes(this.status);
    }

    // Vérifier si transaction est réussie
    isCompleted() {
      return this.status === 'completed';
    }

    // Vérifier si transaction a échoué
    isFailed() {
      return ['failed', 'cancelled', 'refunded'].includes(this.status);
    }

    // Obtenir description formatée selon le type
    getFormattedDescription() {
      const descriptions = {
        'cotisation': `Cotisation ${this.month}/${this.year}`,
        'cotisation_tontine': `Cotisation tontine`,
        'aide': 'Aide financière',
        'versement_tontine': 'Versement tontine',
        'remboursement': 'Remboursement',
        'commission': 'Commission DiasporaTontine'
      };
      
      return descriptions[this.type] || this.description || 'Transaction';
    }
  }

  Transaction.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    
    // 🔗 RELATIONS CONTEXTUELLES
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'Utilisateur concerné par la transaction'
    },
    
    associationId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'associations',
        key: 'id'
      },
      comment: 'Association concernée (pour cotisations/aides)'
    },
    
    sectionId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'sections',
        key: 'id'
      },
      comment: 'Section concernée (pour associations multi-sections)'
    },
    
    memberId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'association_members',
        key: 'id'
      },
      comment: 'Membre association concerné'
    },
    
    tontineId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'tontines',
        key: 'id'
      },
      comment: 'Tontine concernée (pour cotisations/versements tontine)'
    },
    
    participantId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'tontine_participants',
        key: 'id'
      },
      comment: 'Participant tontine concerné'
    },
    
    // 🏷️ IDENTIFICATION TRANSACTION
    type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        isIn: [[
          'cotisation',           // Cotisation association
          'cotisation_tontine',   // Cotisation tontine
          'aide',                 // Aide association
          'versement_tontine',    // Versement tontine (bénéficiaire)
          'remboursement',        // Remboursement défaillance
          'commission',           // Commission DiasporaTontine
          'refund'               // Remboursement client
        ]]
      },
      comment: 'Type de transaction'
    },
    
    category: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Catégorie spécifique (configurable par association/tontine)'
    },
    
    // 💰 MONTANTS
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        min: 0.01
      },
      comment: 'Montant brut de la transaction'
    },
    
    commissionAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.00,
      comment: 'Montant commission DiasporaTontine (calculé automatiquement)'
    },
    
    netAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      comment: 'Montant net (après commission)'
    },
    
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'EUR',
      comment: 'Devise de la transaction'
    },
    
    // 📅 PÉRIODE (pour cotisations)
    month: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        min: 1,
        max: 12
      },
      comment: 'Mois concerné (cotisations)'
    },
    
    year: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        min: 2020,
        max: 2050
      },
      comment: 'Année concernée (cotisations)'
    },
    
    // 💳 PAIEMENT
    paymentMethod: {
      type: DataTypes.STRING(20),
      allowNull: false,
      validate: {
        isIn: [['card', 'iban', 'mobile_money', 'cash', 'internal']]
      },
      comment: 'Méthode de paiement utilisée'
    },
    
    paymentProvider: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: 'Fournisseur paiement (stripe, square, flutterwave)'
    },
    
    externalTransactionId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'ID transaction chez le PSP (Stripe, Square)'
    },
    
    paymentMethodId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'ID méthode paiement (carte, IBAN)'
    },
    
    // 🔄 STATUT & SUIVI
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'pending',
      validate: {
        isIn: [['pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded', 'late']]
      },
      comment: 'Statut de la transaction'
    },
    
    failureReason: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Raison de l\'échec (si applicable)'
    },
    
    // 📝 DESCRIPTION
    description: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Description de la transaction'
    },
    
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Notes internes (gestion, validation)'
    },
    
    // 🎯 WORKFLOW VALIDATION
    requiresApproval: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Transaction nécessite approbation bureau'
    },
    
    approvedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'Utilisateur ayant approuvé'
    },
    
    approvedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date/heure approbation'
    },
    
    // 🔄 RÉCURRENCE (prélèvements auto)
    isRecurring: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Transaction récurrente (prélèvement auto)'
    },
    
    recurringId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'ID abonnement récurrent PSP'
    },
    
    nextOccurrence: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Prochaine occurrence (si récurrent)'
    },
    
    // 📊 MÉTADONNÉES
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Données additionnelles (contexte, config spécifique)'
    },
    
    // 🔍 AUDIT TRAIL
    source: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'app',
      validate: {
        isIn: [['imported', 'app', 'manual']]
      },
      comment: 'Source de la transaction (import historique, app, saisie manuelle)'
    },
    
    ipAddress: {
      type: DataTypes.STRING(45),
      allowNull: true,
      comment: 'Adresse IP origine transaction'
    },
    
    userAgent: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: 'User agent client'
    },
    
    // 📅 DATES IMPORTANTES
    scheduledDate: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date prévue transaction (prélèvements auto)'
    },
    
    processedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date/heure traitement effectif'
    },
    
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date/heure finalisation'
    },
    
    // 🔄 RELATIONS PARENT/ENFANT
    parentTransactionId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'transactions',
        key: 'id'
      },
      comment: 'Transaction parent (pour remboursements, corrections)'
    },
    
    // 📱 ORIGINE
    originApp: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'mobile',
      comment: 'Application origine (mobile, web, admin)'
    }
  }, {
    sequelize,
    modelName: 'Transaction',
    tableName: 'transactions',
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
        fields: ['tontine_id']
      },
      {
        fields: ['type']
      },
      {
        fields: ['status']
      },
      {
        fields: ['payment_method']
      },
      {
        fields: ['external_transaction_id']
      },
      {
        fields: ['month', 'year']
      },
      {
        fields: ['created_at']
      },
      {
        fields: ['scheduled_date']
      },
      {
        fields: ['processed_at']
      }
    ],
    
    // Hook pour calculer automatiquement commission et net amount
    hooks: {
      beforeValidate: (transaction) => {
        // Calculer commission automatiquement si pas déjà définie
        if (transaction.commissionAmount === 0) {
          transaction.commissionAmount = transaction.calculateCommission();
        }
        
        // Calculer montant net
        transaction.netAmount = transaction.amount - transaction.commissionAmount;
      }
    }
  });

  return Transaction;
};