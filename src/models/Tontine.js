'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Tontine extends Model {
    static associate(models) {
      // Tontine appartient à un organisateur
      Tontine.belongsTo(models.User, {
        foreignKey: 'organizerId',
        as: 'organizer'
      });
      
      // Une tontine a plusieurs participants
      Tontine.hasMany(models.TontineParticipant, {
        foreignKey: 'tontineId',
        as: 'participants'
      });
      
      // Une tontine a plusieurs transactions
      Tontine.hasMany(models.Transaction, {
        foreignKey: 'tontineId',
        as: 'transactions'
      });
      
      // Documents et attestations
      Tontine.hasMany(models.Document, {
        foreignKey: 'tontineId',
        as: 'documents'
      });
    }

    // Calculer commission mensuelle totale
    getMonthlyCommission() {
      const baseCommission = this.monthlyContribution * this.maxParticipants * 0.025; // 2.5%
      const fixedFees = this.maxParticipants * 0.25; // 0.25€ par participant
      return parseFloat((baseCommission + fixedFees).toFixed(2));
    }

    // Calculer montant net versé
    getNetPayout() {
      const totalCollected = this.monthlyContribution * this.maxParticipants;
      const commission = this.getMonthlyCommission();
      return parseFloat((totalCollected - commission).toFixed(2));
    }

    // Vérifier si peut démarrer
    canStart() {
      return this.status === 'recruiting' && 
             this.currentParticipants >= this.maxParticipants &&
             this.organizerKycStatus === 'validated';
    }

    // Calculer progression
    getProgress() {
      if (this.status === 'completed') return 100;
      if (this.status === 'active') {
        return Math.round((this.currentRound / this.maxParticipants) * 100);
      }
      return Math.round((this.currentParticipants / this.maxParticipants) * 100);
    }
  }

  Tontine.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    
    // 👤 ORGANISATEUR
    organizerId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    
    // 🏷️ INFORMATIONS DE BASE
    title: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        len: [5, 100]
      },
      comment: 'Titre de la tontine ex: "Tontine Épargne Auto 2025"'
    },
    
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    
    type: {
      type: DataTypes.ENUM('private', 'public'),
      allowNull: false,
      defaultValue: 'private'
    },
    
    // 💰 PARAMETRES FINANCIERS
    monthlyContribution: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: false,
      validate: {
        min: 10.00,
        max: 10000.00
      },
      comment: 'Montant cotisation mensuelle par participant'
    },
    
    managementFees: {
      type: DataTypes.DECIMAL(6, 2),
      allowNull: false,
      defaultValue: 0.00,
      comment: 'Frais de gestion ajoutés (calculés automatiquement)'
    },
    
    totalMonthlyPayment: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: false,
      comment: 'monthlyContribution + managementFees'
    },
    
    payoutAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      comment: 'Montant net versé au bénéficiaire'
    },
    
    currency: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'EUR',
      validate: {
        isIn: [['EUR', 'USD', 'XOF', 'GBP', 'CAD']]
      }
    },
    
    // 👥 PARTICIPANTS
    maxParticipants: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 3,
        max: 50
      }
    },
    
    currentParticipants: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      comment: 'Organisateur inclus automatiquement'
    },
    
    // ⏰ CALENDRIER
    durationMonths: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'Durée = maxParticipants (un tour par mois)'
    },
    
    contributionDay: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 5,
      validate: {
        min: 1,
        max: 28
      },
      comment: 'Jour du mois pour cotisations (5 = 5 de chaque mois)'
    },
    
    payoutDay: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 10,
      validate: {
        min: 1,
        max: 28
      },
      comment: 'Jour du mois pour versements'
    },
    
    startDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: 'Date de démarrage effective'
    },
    
    endDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: 'Date de fin prévue'
    },
    
    // 🎲 TIRAGE AU SORT
    drawOrder: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Ordre tirage: [userId1, userId2, ...] après tirage'
    },
    
    drawDate: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date du tirage au sort'
    },
    
    drawAlgorithm: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: 'secure_random',
      comment: 'Algorithme utilisé pour traçabilité'
    },
    
    drawSeed: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Seed pour reproductibilité du tirage'
    },
    
    // 📋 CONDITIONS PARTICIPATION
    participationConditions: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {
        identityDocumentRequired: false,
        incomeProofRequired: false,
        residenceProofRequired: false,
        residencePermitRequired: false,
        customConditions: []
      }
    },
    
    // 📊 STATUT & PROGRESSION
    status: {
      type: DataTypes.ENUM(
        'draft',           // Brouillon (en création)
        'recruiting',      // En recrutement
        'ready_to_start',  // Complet, prêt pour tirage
        'active',          // En cours d'exécution
        'paused',          // Suspendue temporairement
        'completed',       // Terminée avec succès
        'cancelled',       // Annulée
        'failed'           // Échec (trop de défaillances)
      ),
      allowNull: false,
      defaultValue: 'draft'
    },
    
    currentRound: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Round en cours (0 = pas encore démarré)'
    },
    
    nextPayoutUserId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'ID du prochain bénéficiaire'
    },
    
    nextPayoutDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    // ✅ KYC ORGANISATEUR
    organizerKycStatus: {
      type: DataTypes.ENUM('pending', 'validated', 'rejected'),
      allowNull: false,
      defaultValue: 'pending'
    },
    
    organizerKycValidatedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    // 🔒 ACCES & SECURITE
    accessCode: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Code d\'accès pour tontines privées'
    },
    
    inviteOnly: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Tontine sur invitation uniquement'
    },
    
    // 🚨 GESTION INCIDENTS
    defaultedParticipants: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
      comment: 'Liste des participants défaillants exclus'
    },
    
    totalDefaultedAmount: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0.00,
      comment: 'Montant total des défaillances'
    },
    
    incidentHistory: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
      comment: 'Historique des incidents et résolutions'
    },
    
    // 🔄 ECHANGES DE POSITIONS
    positionExchanges: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
      comment: 'Historique des échanges de positions'
    },
    
    // 💳 PAIEMENTS
    autoPaymentEnabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Versements automatiques activés'
    },
    
    paymentMethod: {
      type: DataTypes.ENUM('manual', 'automatic'),
      allowNull: false,
      defaultValue: 'manual'
    },
    
    // 📈 STATISTIQUES
    totalAmountCollected: {
      type: DataTypes.DECIMAL(12, 2),
      defaultValue: 0.00
    },
    
    totalAmountPaidOut: {
      type: DataTypes.DECIMAL(12, 2),
      defaultValue: 0.00
    },
    
    totalCommissionsGenerated: {
      type: DataTypes.DECIMAL(8, 2),
      defaultValue: 0.00
    },
    
    averagePaymentDelay: {
      type: DataTypes.DECIMAL(4, 2),
      defaultValue: 0.00,
      comment: 'Délai moyen de paiement en jours'
    },
    
    // ⭐ REPUTATION & NOTES
    organizerRating: {
      type: DataTypes.DECIMAL(3, 2),
      allowNull: true,
      validate: {
        min: 0.00,
        max: 5.00
      }
    },
    
    participantsSatisfaction: {
      type: DataTypes.DECIMAL(3, 2),
      allowNull: true,
      validate: {
        min: 0.00,
        max: 5.00
      }
    },
    
    // 📝 NOTES & COMMENTAIRES
    organizerNotes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Notes privées de l\'organisateur'
    },
    
    publicDescription: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Description publique pour tontines ouvertes'
    },
    
    // 🏷️ TAGS & CATEGORIES
    tags: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
      comment: 'Tags: ["epargne", "auto", "etudiants"]'
    },
    
    category: {
      type: DataTypes.ENUM(
        'epargne_generale',
        'achat_vehicule', 
        'logement',
        'education',
        'mariage',
        'voyage',
        'investissement',
        'urgence',
        'autre'
      ),
      allowNull: true
    },
    
    // 📱 VISIBILITE & RECHERCHE
    isPubliclyVisible: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: 'Visible dans la recherche publique'
    },
    
    searchKeywords: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Mots-clés pour recherche'
    },
    
    // ⚙️ CONFIGURATION AVANCEE
    allowPositionExchange: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: 'Autoriser échanges de positions'
    },
    
    maxLatePaymentDays: {
      type: DataTypes.INTEGER,
      defaultValue: 7,
      comment: 'Délai max avant considérer défaillant'
    },
    
    automaticExclusionEnabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    
    // 🌍 LOCALISATION
    targetRegion: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Région cible: "Europe", "Afrique de l\'Ouest"'
    },
    
    language: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'fr',
      validate: {
        isIn: [['fr', 'en', 'it', 'es']]
      }
    },
    
    timezone: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'Europe/Paris'
    },
    
    // 📊 METADATA
    completionRate: {
      type: DataTypes.DECIMAL(5, 2),
      defaultValue: 0.00,
      comment: 'Pourcentage d\'avancement (0-100)'
    },
    
    estimatedEndDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: 'Date de fin estimée (calculée)'
    },
    
    lastActivityAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
    
  }, {
    sequelize,
    modelName: 'Tontine',
    tableName: 'tontines',
    underscored: true,
    timestamps: true,
    paranoid: true, // Soft delete
    
    hooks: {
      beforeCreate: (tontine) => {
        // Calculer frais de gestion et montant total
        const baseCommission = tontine.monthlyContribution * tontine.maxParticipants * 0.025;
        const fixedFees = tontine.maxParticipants * 0.25;
        tontine.managementFees = parseFloat((baseCommission + fixedFees).toFixed(2)) / tontine.maxParticipants;
        
        tontine.totalMonthlyPayment = parseFloat((tontine.monthlyContribution + tontine.managementFees).toFixed(2));
        
        // Calculer montant net versé
        const totalCollected = tontine.monthlyContribution * tontine.maxParticipants;
        const totalCommission = baseCommission + fixedFees;
        tontine.payoutAmount = parseFloat((totalCollected - totalCommission).toFixed(2));
        
        // Durée = nombre de participants
        tontine.durationMonths = tontine.maxParticipants;
        
        // Générer code d'accès pour tontines privées
        if (tontine.type === 'private' && !tontine.accessCode) {
          tontine.accessCode = Math.random().toString(36).substring(2, 10).toUpperCase();
        }
        
        // Mots-clés de recherche automatiques
        if (!tontine.searchKeywords) {
          tontine.searchKeywords = `${tontine.title} ${tontine.monthlyContribution}€ ${tontine.maxParticipants}participants`;
        }
      },
      
      beforeUpdate: (tontine) => {
        // Mettre à jour lastActivityAt
        tontine.lastActivityAt = new Date();
        
        // Recalculer le taux de complétion
        if (tontine.status === 'completed') {
          tontine.completionRate = 100.00;
        } else if (tontine.status === 'active') {
          tontine.completionRate = parseFloat(((tontine.currentRound / tontine.maxParticipants) * 100).toFixed(2));
        } else if (tontine.status === 'recruiting') {
          tontine.completionRate = parseFloat(((tontine.currentParticipants / tontine.maxParticipants) * 100).toFixed(2));
        }
      },
      
      afterCreate: (tontine) => {
        console.log(`💰 Nouvelle tontine créée: ${tontine.title} (${tontine.maxParticipants}×${tontine.monthlyContribution}€)`);
      }
    },
    
    indexes: [
      { fields: ['organizer_id'] },
      { fields: ['status'] },
      { fields: ['type'] },
      { fields: ['currency'] },
      { fields: ['start_date'] },
      { fields: ['is_publicly_visible'] },
      { fields: ['category'] },
      { fields: ['target_region'] },
      { fields: ['created_at'] }
    ]
  });

  return Tontine;
};
