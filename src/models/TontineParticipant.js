'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class TontineParticipant extends Model {
    static associate(models) {
      // Un participant appartient à un utilisateur
      TontineParticipant.belongsTo(models.User, {
        foreignKey: 'userId',
        as: 'user'
      });
      
      // Un participant appartient à une tontine
      TontineParticipant.belongsTo(models.Tontine, {
        foreignKey: 'tontineId',
        as: 'tontine'
      });
      
      // Un participant a plusieurs transactions
      TontineParticipant.hasMany(models.Transaction, {
        foreignKey: 'participantId',
        as: 'transactions'
      });
    }

    // Vérifier si peut échanger sa position
    canExchangePosition() {
      if (this.status !== 'active') return false;
      if (this.hasReceivedPayout) return false;
      if (this.isDefaulted) return false;
      
      const tontine = this.tontine || {};
      return tontine.allowPositionExchange !== false;
    }

    // Calculer montant total cotisé
    async getTotalContributed() {
      const { Transaction } = sequelize.models;
      const result = await Transaction.findOne({
        where: { 
          participantId: this.id,
          type: 'cotisation_tontine',
          status: 'completed'
        },
        attributes: [
          [sequelize.fn('SUM', sequelize.col('amount')), 'total']
        ],
        raw: true
      });
      return parseFloat(result?.total || 0);
    }

    // Calculer nombre de retards
    async getLatePaymentsCount() {
      const { Transaction } = sequelize.models;
      return await Transaction.count({
        where: { 
          participantId: this.id,
          type: 'cotisation_tontine',
          status: 'late'
        }
      });
    }

    // Vérifier si à jour ce mois
    async isCurrentMonthPaid() {
      const { Transaction } = sequelize.models;
      const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const endOfMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);
      
      const payment = await Transaction.findOne({
        where: { 
          participantId: this.id,
          type: 'cotisation_tontine',
          status: 'completed',
          createdAt: {
            [sequelize.Sequelize.Op.between]: [startOfMonth, endOfMonth]
          }
        }
      });
      
      return !!payment;
    }
  }

  TontineParticipant.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    
    // 🔗 RELATIONS
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    
    tontineId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'tontines',
        key: 'id'
      }
    },
    
    // 📊 POSITION & ORDRE
    position: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Position dans l\'ordre de tirage (1, 2, 3...)'
    },
    
    originalPosition: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Position originale avant échanges'
    },
    
    payoutMonth: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Mois où le participant doit recevoir (1-N)'
    },
    
    expectedPayoutDate: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date prévue de réception'
    },
    
    // 📅 DATES PARTICIPATION
    joinDate: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    
    approvedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date approbation par organisateur'
    },
    
    approvedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'ID organisateur qui a approuvé'
    },
    
    // 📋 STATUT PARTICIPANT
    status: {
      type: DataTypes.ENUM(
        'pending',      // En attente approbation
        'approved',     // Approuvé, en attente tirage
        'active',       // Actif (tontine démarrée)
        'completed',    // A terminé sa participation
        'defaulted',    // Défaillant/exclu
        'withdrawn',    // S'est retiré
        'transferred'   // Transféré à quelqu'un d'autre
      ),
      allowNull: false,
      defaultValue: 'pending'
    },
    
    statusReason: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Raison du statut (exclusion, retrait, etc.)'
    },
    
    lastStatusChange: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    // 💳 PAIEMENTS & COTISATIONS
    autoPaymentEnabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Prélèvement automatique activé'
    },
    
    paymentMethod: {
      type: DataTypes.ENUM('manual', 'card_auto', 'bank_transfer'),
      allowNull: false,
      defaultValue: 'manual'
    },
    
    lastContributionDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    contributionsCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Nombre de cotisations payées'
    },
    
    totalContributed: {
      type: DataTypes.DECIMAL(8, 2),
      defaultValue: 0.00
    },
    
    // 💰 RECEPTION PAYOUT
    hasReceivedPayout: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    
    payoutAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      comment: 'Montant reçu effectivement'
    },
    
    payoutDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    payoutTransactionId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'ID transaction du versement reçu'
    },
    
    // 🚨 DEFAILLANCES
    isDefaulted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    
    defaultReason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    
    defaultDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    debtAmount: {
      type: DataTypes.DECIMAL(8, 2),
      defaultValue: 0.00,
      comment: 'Montant dû après défaillance'
    },
    
    latePaymentsCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    
    // 🔄 ECHANGES POSITIONS
    positionExchangeHistory: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
      comment: 'Historique des échanges effectués'
    },
    
    lastPositionExchange: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    // 📄 KYC & DOCUMENTS
    kycStatus: {
      type: DataTypes.ENUM('none', 'pending', 'approved', 'rejected'),
      allowNull: false,
      defaultValue: 'none'
    },
    
    documentsProvided: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Documents fournis selon conditions tontine'
    },
    
    documentsValidatedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    // 📞 CONTACT & PREFERENCES
    preferredContactTime: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Créneau contact préféré'
    },
    
    notificationSettings: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {
        paymentReminders: true,
        positionUpdates: true,
        payoutNotifications: true
      }
    },
    
    // ⭐ REPUTATION TONTINE
    reliabilityScore: {
      type: DataTypes.DECIMAL(3, 2),
      defaultValue: 5.00,
      validate: {
        min: 0.00,
        max: 5.00
      },
      comment: 'Score fiabilité dans cette tontine'
    },
    
    punctualityScore: {
      type: DataTypes.DECIMAL(3, 2),
      defaultValue: 5.00,
      validate: {
        min: 0.00,
        max: 5.00
      },
      comment: 'Score ponctualité paiements'
    },
    
    // 📝 EVALUATIONS
    organizerRating: {
      type: DataTypes.DECIMAL(3, 2),
      allowNull: true,
      validate: {
        min: 0.00,
        max: 5.00
      },
      comment: 'Note donnée à l\'organisateur'
    },
    
    organizerComment: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Commentaire sur l\'organisateur'
    },
    
    ratingByOrganizer: {
      type: DataTypes.DECIMAL(3, 2),
      allowNull: true,
      validate: {
        min: 0.00,
        max: 5.00
      },
      comment: 'Note reçue de l\'organisateur'
    },
    
    commentByOrganizer: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Commentaire de l\'organisateur'
    },
    
    // 🔔 COMMUNICATIONS
    lastReminderSent: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    remindersSentCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    
    communicationHistory: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
      comment: 'Historique SMS, emails, appels'
    },
    
    // 📊 STATISTIQUES
    averagePaymentDelay: {
      type: DataTypes.DECIMAL(4, 1),
      defaultValue: 0.0,
      comment: 'Délai moyen paiement en jours'
    },
    
    longestPaymentDelay: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Plus long retard en jours'
    },
    
    // 👥 PARRAINAGE & RELATIONS
    invitedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'Qui a invité ce participant'
    },
    
    referralBonus: {
      type: DataTypes.DECIMAL(6, 2),
      defaultValue: 0.00,
      comment: 'Bonus reçu pour parrainage'
    },
    
    // ⚙️ METADATA
    joinMethod: {
      type: DataTypes.ENUM('invitation', 'public_search', 'referral', 'organizer_added'),
      allowNull: false,
      defaultValue: 'invitation'
    },
    
    deviceInfo: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Info device utilisé lors inscription'
    },
    
    ipAddress: {
      type: DataTypes.STRING,
      allowNull: true
    },
    
    // 🔄 ACTIVITE
    lastActivityAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    lastLoginAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
    
  }, {
    sequelize,
    modelName: 'TontineParticipant',
    tableName: 'tontine_participants',
    underscored: true,
    timestamps: true,
    paranoid: true, // Soft delete
    
    hooks: {
      beforeCreate: (participant) => {
        // Date de dernière activité
        participant.lastActivityAt = new Date();
      },
      
      beforeUpdate: (participant) => {
        // Mettre à jour date dernière activité
        participant.lastActivityAt = new Date();
        
        // Mettre à jour date changement statut
        if (participant.changed('status')) {
          participant.lastStatusChange = new Date();
        }
        
        // Marquer comme défaillant si nécessaire
        if (participant.changed('status') && participant.status === 'defaulted') {
          participant.isDefaulted = true;
          participant.defaultDate = new Date();
        }
      },
      
      afterCreate: async (participant) => {
        console.log(`💰 Nouveau participant tontine: User ${participant.userId} → Tontine ${participant.tontineId}`);
        
        // Mettre à jour compteur participants tontine
        const tontine = await participant.getTontine();
        if (tontine && participant.status === 'approved') {
          await tontine.increment('currentParticipants');
          
          // Vérifier si tontine est complète
          if (tontine.currentParticipants >= tontine.maxParticipants) {
            await tontine.update({ status: 'ready_to_start' });
            console.log(`🎲 Tontine ${tontine.id} prête pour le tirage !`);
          }
        }
      },
      
      afterUpdate: async (participant) => {
        // Mettre à jour compteurs tontine si changement statut
        if (participant.changed('status')) {
          const tontine = await participant.getTontine();
          
          if (participant.status === 'approved' && participant._previousDataValues.status === 'pending') {
            // Nouveau participant approuvé
            if (tontine) {
              await tontine.increment('currentParticipants');
              
              // Vérifier si complet
              if (tontine.currentParticipants >= tontine.maxParticipants) {
                await tontine.update({ status: 'ready_to_start' });
              }
            }
          } else if (participant.status === 'defaulted' || participant.status === 'withdrawn') {
            // Participant retiré
            if (tontine && tontine.currentParticipants > 0) {
              await tontine.decrement('currentParticipants');
              
              // Recalculer montants si défaillance
              if (participant.status === 'defaulted') {
                const newPayoutAmount = (tontine.monthlyContribution * (tontine.currentParticipants - 1)) - tontine.getMonthlyCommission();
                await tontine.update({ 
                  payoutAmount: newPayoutAmount,
                  status: 'active' // Continuer avec moins de participants
                });
              }
            }
          }
        }
        
        // Mettre à jour scores réputation si cotisation
        if (participant.changed('contributionsCount')) {
          const lateRatio = participant.latePaymentsCount / Math.max(participant.contributionsCount, 1);
          const newPunctualityScore = Math.max(1.00, 5.00 - (lateRatio * 4));
          participant.punctualityScore = parseFloat(newPunctualityScore.toFixed(2));
        }
      }
    },
    
    indexes: [
      { fields: ['user_id'] },
      { fields: ['tontine_id'] },
      { fields: ['position'] },
      { fields: ['status'] },
      { fields: ['payout_month'] },
      { fields: ['has_received_payout'] },
      { fields: ['is_defaulted'] },
      { fields: ['kyc_status'] },
      { fields: ['join_date'] },
      { fields: ['last_contribution_date'] },
      // Index composé pour éviter doublons user/tontine
      { fields: ['user_id', 'tontine_id'], unique: true }
    ]
  });

  return TontineParticipant;
};