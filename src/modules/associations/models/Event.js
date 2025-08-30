'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Event extends Model {
    static associate(models) {
      // Un événement appartient à une association
      Event.belongsTo(models.Association, {
        foreignKey: 'associationId',
        as: 'association'
      });
      
      // Un événement peut appartenir à une section
      Event.belongsTo(models.Section, {
        foreignKey: 'sectionId',
        as: 'section'
      });
      
      // Un événement est créé par un utilisateur
      Event.belongsTo(models.User, {
        foreignKey: 'createdBy',
        as: 'creator'
      });
    }

    // Vérifier si événement est passé
    isPast() {
      return new Date() > new Date(this.endDate || this.startDate);
    }

    // Vérifier si événement est en cours
    isOngoing() {
      const now = new Date();
      const start = new Date(this.startDate);
      const end = new Date(this.endDate || this.startDate);
      return now >= start && now <= end;
    }

    // Vérifier si événement est à venir
    isUpcoming() {
      return new Date() < new Date(this.startDate);
    }

    // Calculer nombre participants confirmés
    getConfirmedParticipantsCount() {
      const responses = this.participantResponses || {};
      return Object.values(responses).filter(response => response === 'confirmed').length;
    }

    // Calculer nombre participants "peut-être"
    getMaybeParticipantsCount() {
      const responses = this.participantResponses || {};
      return Object.values(responses).filter(response => response === 'maybe').length;
    }

    // Calculer taux participation
    getParticipationRate() {
      const responses = this.participantResponses || {};
      const totalResponses = Object.keys(responses).length;
      if (totalResponses === 0) return 0;
      
      const confirmed = this.getConfirmedParticipantsCount();
      return Math.round((confirmed / totalResponses) * 100);
    }

    // Vérifier si utilisateur a répondu
    hasUserResponded(userId) {
      const responses = this.participantResponses || {};
      return responses.hasOwnProperty(userId.toString());
    }

    // Obtenir réponse utilisateur
    getUserResponse(userId) {
      const responses = this.participantResponses || {};
      return responses[userId.toString()] || null;
    }

    // Formater date pour affichage
    getFormattedDate() {
      const start = new Date(this.startDate);
      const end = this.endDate ? new Date(this.endDate) : null;
      
      const options = { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      };
      
      if (end && start.toDateString() !== end.toDateString()) {
        return `Du ${start.toLocaleDateString('fr-FR', options)} au ${end.toLocaleDateString('fr-FR', options)}`;
      }
      
      return start.toLocaleDateString('fr-FR', options);
    }
  }

  Event.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    
    // 🔗 RELATIONS PRINCIPALES
    associationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'associations',
        key: 'id'
      },
      comment: 'Association organisatrice'
    },
    
    sectionId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'sections',
        key: 'id'
      },
      comment: 'Section organisatrice (optionnel)'
    },
    
    createdBy: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'Créateur de l\'événement'
    },
    
    // 📋 INFORMATIONS ÉVÉNEMENT
    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: 'Titre de l\'événement'
    },
    
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Description détaillée'
    },
    
    type: {
      type: DataTypes.ENUM(
        'meeting',           // Réunion
        'general_assembly',  // Assemblée générale
        'cultural',          // Événement culturel
        'social',           // Événement social
        'fundraising',      // Collecte fonds
        'conference',       // Conférence
        'workshop',         // Atelier
        'celebration',      // Célébration
        'other'            // Autre
      ),
      allowNull: false,
      defaultValue: 'meeting',
      comment: 'Type d\'événement'
    },
    
    // 📅 DATES & HORAIRES
    startDate: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: 'Date/heure début'
    },
    
    endDate: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date/heure fin (optionnel pour événements courts)'
    },
    
    timezone: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'Europe/Paris',
      comment: 'Fuseau horaire événement'
    },
    
    isAllDay: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Événement toute la journée'
    },
    
    // 📍 LIEU
    location: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Lieu de l\'événement'
    },
    
    address: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Adresse complète'
    },
    
    isOnline: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Événement en ligne'
    },
    
    onlineLink: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: 'Lien visioconférence (Zoom, Teams, etc.)'
    },
    
    onlineAccessCode: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Code accès réunion en ligne'
    },
    
    // 🎯 PARTICIPANTS & ACCÈS
    visibility: {
      type: DataTypes.ENUM('public', 'association', 'section', 'bureau', 'invited_only'),
      allowNull: false,
      defaultValue: 'association',
      comment: 'Niveau visibilité événement'
    },
    
    maxParticipants: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Nombre max participants (null = illimité)'
    },
    
    requiresRegistration: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: 'Inscription obligatoire'
    },
    
    registrationDeadline: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date limite inscription'
    },
    
    // 📝 RÉPONSES PARTICIPANTS
    participantResponses: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Réponses participants: { userId: "confirmed|maybe|declined" }'
    },
    
    participantNotes: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Notes/commentaires participants: { userId: "note" }'
    },
    
    invitedUsers: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Liste utilisateurs invités spécifiquement'
    },
    
    // 📋 AGENDA & DOCUMENTS
    agenda: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Ordre du jour structuré'
    },
    
    documents: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Documents attachés (IDs, URLs)'
    },
    
    // 🔔 NOTIFICATIONS
    notificationsSent: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Historique notifications envoyées'
    },
    
    sendReminders: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: 'Envoyer rappels automatiques'
    },
    
    reminderTimes: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [48, 2], // 48h et 2h avant
      comment: 'Heures avant événement pour rappels'
    },
    
    // 💰 ASPECT FINANCIER
    isFree: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: 'Événement gratuit'
    },
    
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      comment: 'Prix participation (si payant)'
    },
    
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'EUR',
      comment: 'Devise prix'
    },
    
    // 🎯 STATUT ÉVÉNEMENT
    status: {
      type: DataTypes.ENUM('draft', 'published', 'cancelled', 'postponed', 'completed'),
      allowNull: false,
      defaultValue: 'draft',
      comment: 'Statut événement'
    },
    
    cancellationReason: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Raison annulation/report'
    },
    
    // 🔄 RÉCURRENCE
    isRecurring: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Événement récurrent'
    },
    
    recurrencePattern: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Modèle récurrence: { type: "weekly|monthly", interval: 1, until: date }'
    },
    
    parentEventId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'events',
        key: 'id'
      },
      comment: 'Événement parent (pour récurrences)'
    },
    
    // 📊 SUIVI & ANALYTICS
    viewCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: 'Nombre vues événement'
    },
    
    lastViewedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Dernière vue'
    },
    
    // 📱 MÉTADONNÉES
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Données additionnelles événement'
    },
    
    tags: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Tags pour classification/recherche'
    },
    
    // 🔧 CONFIGURATION
    settings: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Paramètres spécifiques événement'
    }
  }, {
    sequelize,
    modelName: 'Event',
    tableName: 'events',
    underscored: true,
    timestamps: true,
    
    indexes: [
      {
        fields: ['association_id']
      },
      {
        fields: ['section_id']
      },
      {
        fields: ['created_by']
      },
      {
        fields: ['type']
      },
      {
        fields: ['status']
      },
      {
        fields: ['start_date']
      },
      {
        fields: ['end_date']
      },
      {
        fields: ['visibility']
      },
      {
        fields: ['is_recurring']
      },
      {
        fields: ['parent_event_id']
      }
    ]
  });

  return Event;
};