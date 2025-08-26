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
      
      // Une transaction peut appartenir à une association
      Transaction.belongsTo(models.Association, {
        foreignKey: 'associationId',
        as: 'association'
      });
      
      // Une transaction peut appartenir à une section
      Transaction.belongsTo(models.Section, {
        foreignKey: 'sectionId',
        as: 'section'
      });
      
      // Une transaction peut appartenir à un membership association
      Transaction.belongsTo(models.AssociationMember, {
        foreignKey: 'membershipId',
        as: 'membership'
      });
      
      // Une transaction peut appartenir à une tontine
      Transaction.belongsTo(models.Tontine, {
        foreignKey: 'tontineId',
        as: 'tontine'
      });
      
      // Une transaction peut appartenir à un participant tontine
      Transaction.belongsTo(models.TontineParticipant, {
        foreignKey: 'participantId',
        as: 'participant'
      });
    }

    // Calculer commission plateforme
    calculatePlatformCommission() {
      const rate = 0.025; // 2.5%
      const fixedFee = 0.25; // 0.25€
      return parseFloat((this.amount * rate + fixedFee).toFixed(2));
    }

    // Vérifier si transaction est en retard
    isLate() {
      if (this.status !== 'pending') return false;
      if (!this.dueDate) return false;
      
      return new Date() > this.dueDate;
    }

    // Obtenir délai en jours
    getDaysLate() {
      if (!this.isLate()) return 0;
      
      const diffTime = Math.abs(new Date() - this.dueDate);
      return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    // Formater pour affichage
    getDisplayInfo() {
      return {
        id: this.id,
        type: this.type,
        amount: this.amount,
        currency: this.currency,
        status: this.status,
        date: this.createdAt,
        description: this.description
      };
    }
  }

  Transaction.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    
    // 🔗 RELATIONS FLEXIBLES
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
      comment: 'Association concernée (si transaction association)'
    },
    
    sectionId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'sections',
        key: 'id'
      },
      comment: 'Section concernée (si transaction association multi-sections)'
    },
    
    membershipId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'association_members',
        key: 'id'
      },
      comment: 'Membership association concerné'
    },
    
    tontineId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'tontines',
        key: 'id'
      },
      comment: 'Tontine concernée (si transaction tontine)'
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
    transactionNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      comment: 'Numéro unique transaction: TRX20250824001'
    },
    
    type: {
      type: DataTypes.ENUM(
        // ASSOCIATION
        'cotisation_association',      // Cotisation mensuelle association
        'aide_association',           // Aide versée par association
        'subscription_association',   // Abonnement 10€/mois association
        
        // TONTINE
        'cotisation_tontine',         // Cotisation mensuelle tontine
        'versement_tontine',          // Versement reçu dans tontine
        
        // PLATFORM
        'commission',                 // Commission plateforme
        'refund',                    // Remboursement
        'penalty',                   // Pénalité retard
        'transfer',                  // Transfert entre comptes
        
        // AUTRES
        'deposit',                   // Dépôt fonds
        'withdrawal',               // Retrait fonds
        'adjustment'               // Ajustement comptable
      ),
      allowNull: false
    },
    
    subType: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Sous-type pour précision: aide_maladie, aide_deces, etc.'
    },
    
    // 💰 MONTANTS
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        min: 0.01
      }
    },
    
    currency: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'EUR',
      validate: {
        isIn: [['EUR', 'USD', 'XOF', 'GBP', 'CAD']]
      }
    },
    
    // Commissions et frais
    platformCommission: {
      type: DataTypes.DECIMAL(8, 2),
      defaultValue: 0.00,
      comment: 'Commission plateforme (2.5% + 0.25€)'
    },
    
    paymentProviderFees: {
      type: DataTypes.DECIMAL(8, 2),
      defaultValue: 0.00,
      comment: 'Frais PSP (Stripe, Square)'
    },
    
    netAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      comment: 'Montant net après commissions'
    },
    
    // 📊 STATUT & SUIVI
    status: {
      type: DataTypes.ENUM(
        'pending',           // En attente
        'processing',        // En cours de traitement
        'completed',         // Terminée avec succès
        'failed',           // Échec
        'cancelled',        // Annulée
        'late',            // En retard
        'disputed',        // Contestée
        'refunded',        // Remboursée
        'partially_refunded' // Partiellement remboursée
      ),
      allowNull: false,
      defaultValue: 'pending'
    },
    
    statusReason: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Raison du statut (échec, contestation, etc.)'
    },
    
    // 📅 DATES
    dueDate: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date d\'échéance (pour cotisations)'
    },
    
    processedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date de traitement effectif'
    },
    
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    // 💳 INFORMATIONS PAIEMENT
    paymentMethod: {
      type: DataTypes.ENUM(
        'card',              // Carte bancaire
        'bank_transfer',     // Virement bancaire
        'mobile_money',      // Mobile Money (Afrique)
        'cash',             // Espèces (déclaré)
        'check',            // Chèque
        'other'             // Autre
      ),
      allowNull: false,
      defaultValue: 'card'
    },
    
    paymentProvider: {
      type: DataTypes.ENUM('stripe', 'square', 'flutterwave', 'manual', 'other'),
      allowNull: false,
      defaultValue: 'stripe'
    },
    
    // IDs externes des PSP
    stripePaymentId: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'ID Stripe: pi_xxx'
    },
    
    squarePaymentId: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'ID Square'
    },
    
    externalTransactionId: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'ID transaction externe (banque, etc.)'
    },
    
    // 📱 INFORMATIONS CARTE/COMPTE
    cardLast4: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        len: [4, 4],
        isNumeric: true
      }
    },
    
    cardBrand: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'visa, mastercard, amex'
    },
    
    bankName: {
      type: DataTypes.STRING,
      allowNull: true
    },
    
    // 📝 DESCRIPTION & METADATA
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Description de la transaction'
    },
    
    reference: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Référence externe (numéro facture, etc.)'
    },
    
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Données additionnelles (webhook data, etc.)'
    },
    
    // 🔄 RECURRENCE & AUTOMATISATION
    isRecurring: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Transaction récurrente (cotisations auto)'
    },
    
    recurringId: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'ID abonnement récurrent'
    },
    
    parentTransactionId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'transactions',
        key: 'id'
      },
      comment: 'Transaction parent (pour refunds, etc.)'
    },
    
    // 🚨 GESTION ECHECS & RETRIES
    attemptCount: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      comment: 'Nombre de tentatives'
    },
    
    maxAttempts: {
      type: DataTypes.INTEGER,
      defaultValue: 3
    },
    
    lastAttemptAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    nextRetryAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    failureReason: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Raison de l\'échec technique'
    },
    
    // 📍 CONTEXT & TRACKING
    ipAddress: {
      type: DataTypes.STRING,
      allowNull: true
    },
    
    userAgent: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    
    deviceFingerprint: {
      type: DataTypes.STRING,
      allowNull: true
    },
    
    // 🌍 LOCALISATION
    country: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Pays émission carte/paiement'
    },
    
    exchangeRate: {
      type: DataTypes.DECIMAL(10, 6),
      allowNull: true,
      comment: 'Taux change si conversion devise'
    },
    
    originalCurrency: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Devise originale avant conversion'
    },
    
    originalAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      comment: 'Montant original avant conversion'
    },
    
    // 🔐 SECURITY & FRAUD
    riskScore: {
      type: DataTypes.DECIMAL(3, 2),
      allowNull: true,
      validate: {
        min: 0.00,
        max: 1.00
      },
      comment: 'Score risque fraud (0-1)'
    },
    
    fraudChecks: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Résultats vérifications anti-fraud'
    },
    
    isHighRisk: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    
    // 📊 BUSINESS METRICS
    monthYear: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Format YYYY-MM pour agrégations rapides'
    },
    
    fiscalYear: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'Année fiscale pour rapports'
    },
    
    // 🔔 NOTIFICATIONS
    userNotified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Utilisateur notifié du résultat'
    },
    
    adminNotified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Admin notifié si nécessaire'
    },
    
    // 📈 TRACKING BUSINESS
    revenueImpact: {
      type: DataTypes.DECIMAL(8, 2),
      defaultValue: 0.00,
      comment: 'Impact revenue pour la plateforme'
    },
    
    customerLifetimeValue: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      comment: 'LTV client au moment transaction'
    }
    
  }, {
    sequelize,
    modelName: 'Transaction',
    tableName: 'transactions',
    underscored: true,
    timestamps: true,
    paranoid: true, // Soft delete
    
    hooks: {
      beforeCreate: (transaction) => {
        // Générer numéro transaction unique
        if (!transaction.transactionNumber) {
          const date = new Date();
          const year = date.getFullYear();
          const month = (date.getMonth() + 1).toString().padStart(2, '0');
          const day = date.getDate().toString().padStart(2, '0');
          const timestamp = Date.now().toString().slice(-6);
          transaction.transactionNumber = `TRX${year}${month}${day}${timestamp}`;
        }
        
        // Calculer commission plateforme
        if (!transaction.platformCommission && ['cotisation_association', 'cotisation_tontine'].includes(transaction.type)) {
          const rate = 0.025; // 2.5%
          const fixedFee = 0.25; // 0.25€
          transaction.platformCommission = parseFloat((transaction.amount * rate + fixedFee).toFixed(2));
        }
        
        // Calculer montant net
        transaction.netAmount = parseFloat((
          transaction.amount - 
          (transaction.platformCommission || 0) - 
          (transaction.paymentProviderFees || 0)
        ).toFixed(2));
        
        // Générer monthYear et fiscalYear
        const date = transaction.createdAt || new Date();
        transaction.monthYear = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
        transaction.fiscalYear = date.getFullYear();
        
        // Impact revenue pour plateforme
        if (['cotisation_association', 'cotisation_tontine', 'subscription_association'].includes(transaction.type)) {
          transaction.revenueImpact = transaction.platformCommission || 0;
        }
      },
      
      beforeUpdate: (transaction) => {
        // Mise à jour dates selon statut
        if (transaction.changed('status')) {
          const now = new Date();
          
          switch (transaction.status) {
            case 'processing':
              if (!transaction.processedAt) {
                transaction.processedAt = now;
              }
              break;
            case 'completed':
              if (!transaction.completedAt) {
                transaction.completedAt = now;
              }
              break;
          }
        }
        
        // Incrémenter tentatives si échec
        if (transaction.changed('status') && transaction.status === 'failed') {
          transaction.attemptCount = (transaction.attemptCount || 0) + 1;
          transaction.lastAttemptAt = new Date();
          
          // Programmer prochaine tentative si pas max atteint
          if (transaction.attemptCount < transaction.maxAttempts) {
            const nextRetry = new Date();
            nextRetry.setHours(nextRetry.getHours() + (transaction.attemptCount * 2)); // Backoff exponentiel
            transaction.nextRetryAt = nextRetry;
          }
        }
      },
      
      afterCreate: (transaction) => {
        console.log(`💳 Transaction créée: ${transaction.transactionNumber} - ${transaction.amount}${transaction.currency} (${transaction.type})`);
      },
      
      afterUpdate: async (transaction) => {
        // Mettre à jour compteurs si transaction terminée
        if (transaction.changed('status') && transaction.status === 'completed') {
          
          // Mettre à jour compteurs association member
          if (transaction.membershipId && transaction.type === 'cotisation_association') {
            const member = await transaction.getMembership();
            if (member) {
              await member.increment('totalContributed', { by: transaction.amount });
              member.lastCotisationDate = transaction.completedAt;
              member.cotisationStatus = 'up_to_date';
              member.monthsBehind = 0;
              await member.save();
            }
          }
          
          // Mettre à jour compteurs tontine participant
          if (transaction.participantId && transaction.type === 'cotisation_tontine') {
            const participant = await transaction.getParticipant();
            if (participant) {
              await participant.increment(['contributionsCount', 'totalContributed'], { 
                contributionsCount: 1,
                totalContributed: transaction.amount 
              });
              participant.lastContributionDate = transaction.completedAt;
              await participant.save();
            }
          }
        }
      }
    },
    
    indexes: [
      { fields: ['transaction_number'], unique: true },
      { fields: ['user_id'] },
      { fields: ['association_id'] },
      { fields: ['section_id'] },
      { fields: ['membership_id'] },
      { fields: ['tontine_id'] },
      { fields: ['participant_id'] },
      { fields: ['type'] },
      { fields: ['status'] },
      { fields: ['payment_method'] },
      { fields: ['payment_provider'] },
      { fields: ['month_year'] },
      { fields: ['fiscal_year'] },
      { fields: ['is_recurring'] },
      { fields: ['due_date'] },
      { fields: ['completed_at'] },
      { fields: ['created_at'] },
      // Index composés pour requêtes business
      { fields: ['type', 'status', 'created_at'] },
      { fields: ['user_id', 'type', 'status'] },
      { fields: ['association_id', 'type', 'month_year'] },
      { fields: ['tontine_id', 'type', 'status'] }
    ]
  });

  return Transaction;
};