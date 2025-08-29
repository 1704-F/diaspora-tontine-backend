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
      
      // Un événement peut appartenir à une section spécifique
      Event.belongsTo(models.Section, {
        foreignKey: 'sectionId',
        as: 'section'
      });
      
      // Un événement a un créateur
      Event.belongsTo(models.User, {
        foreignKey: 'createdBy',
        as: 'creator'
      });
      
      // Un événement peut avoir des transactions (paiements d'inscription)
      Event.hasMany(models.Transaction, {
        foreignKey: 'eventId',
        as: 'transactions'
      });
    }

    // Vérifier si événement est passé
    isPastEvent() {
      return new Date() > new Date(this.endDate);
    }

    // Vérifier si événement est en cours
    isOngoing() {
      const now = new Date();
      return now >= new Date(this.startDate) && now <= new Date(this.endDate);
    }

    // Calculer nombre d'inscrits
    async getRegisteredCount() {
      if (!this.registrations || !Array.isArray(this.registrations)) return 0;
      return this.registrations.filter(r => r.status === 'confirmed').length;
    }

    // Vérifier si utilisateur peut s'inscrire
    async canUserRegister(userId) {
      if (this.isPastEvent()) return false;
      if (this.maxParticipants && await this.getRegisteredCount() >= this.maxParticipants) return false;
      
      const isAlreadyRegistered = this.registrations?.some(r => 
        r.userId === userId && r.status !== 'cancelled'
      );
      
      return !isAlreadyRegistered;
    }

    // Calculer revenus de l'événement
    getEventRevenue() {
      if (!this.registrations) return 0;
      
      return this.registrations
        .filter(r => r.status === 'confirmed' && r.hasPaid)
        .reduce((total, r) => total + (r.amountPaid || 0), 0);
    }
  }

  Event.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    
    // 🔗 RELATIONS
    associationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'associations',
        key: 'id'
      }
    },
    
    sectionId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'sections',
        key: 'id'
      },
      comment: 'Section organisatrice (null = événement association générale)'
    },
    
    createdBy: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    
    // 🏷️ IDENTIFICATION
    title: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        len: [3, 200]
      }
    },
    
    slug: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isLowercase: true,
        is: /^[a-z0-9-]+$/
      }
    },
    
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    
    shortDescription: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: 'Résumé court pour notifications'
    },
    
    // 📅 PLANNING
    startDate: {
      type: DataTypes.DATE,
      allowNull: false,
      validate: {
        isDate: true,
        isAfter: {
          args: new Date().toISOString(),
          msg: "La date de début doit être dans le futur"
        }
      }
    },
    
    endDate: {
      type: DataTypes.DATE,
      allowNull: false,
      validate: {
        isDate: true,
        isAfterStartDate(value) {
          if (value <= this.startDate) {
            throw new Error('La date de fin doit être après la date de début');
          }
        }
      }
    },
    
    duration: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Durée en minutes (calculée automatiquement)'
    },
    
    timezone: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'Europe/Paris'
    },
    
    // 📍 LOCALISATION
    location: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Adresse, coordonnées, instructions accès'
    },
    
    isOnline: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    
    meetingLink: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isUrl: true
      },
      comment: 'Lien Zoom, Meet, Teams, etc.'
    },
    
    // 🎯 TYPE & CATEGORIE
    type: {
      type: DataTypes.ENUM(
        'assembly',           // Assemblée générale
        'board_meeting',      // Réunion bureau
        'cultural',          // Événement culturel
        'fundraising',       // Collecte de fonds
        'social',            // Événement social
        'community_service', // Service communautaire
        'educational',       // Éducatif/Formation
        'celebration',       // Célébration
        'memorial',          // Commémoratif
        'sports',           // Sportif
        'networking',       // Réseautage
        'other'
      ),
      allowNull: false,
      defaultValue: 'social'
    },
    
    category: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Catégorie personnalisée par association'
    },
    
    tags: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: []
    },
    
    // 👥 PARTICIPATION
    maxParticipants: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        min: 1
      }
    },
    
    minParticipants: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 1
    },
    
    currentParticipants: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    
    targetAudience: {
      type: DataTypes.ENUM('all_members', 'active_members', 'board_only', 'section_members', 'invited_only'),
      allowNull: false,
      defaultValue: 'all_members'
    },
    
    requiresApproval: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Inscription nécessite validation'
    },
    
    // 💰 ASPECT FINANCIER
    isFree: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    
    price: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: true,
      validate: {
        min: 0
      }
    },
    
    memberPrice: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: true,
      comment: 'Prix préférentiel membres'
    },
    
    currency: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'EUR',
      validate: {
        isIn: [['EUR', 'USD', 'XOF', 'GBP', 'CAD']]
      }
    },
    
    budgetAllocated: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      comment: 'Budget alloué par association'
    },
    
    expectedRevenue: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    },
    
    actualRevenue: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0.00
    },
    
    actualCosts: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0.00
    },
    
    // 📋 STATUT
    status: {
      type: DataTypes.ENUM(
        'draft',          // Brouillon
        'published',      // Publié
        'registration_open', // Inscriptions ouvertes
        'registration_closed', // Inscriptions fermées
        'confirmed',      // Confirmé
        'ongoing',        // En cours
        'completed',      // Terminé
        'cancelled',      // Annulé
        'postponed'       // Reporté
      ),
      allowNull: false,
      defaultValue: 'draft'
    },
    
    cancellationReason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    
    // 📝 INSCRIPTIONS
    registrations: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
      comment: 'Liste des inscriptions avec détails'
    },
    
    waitingList: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
      comment: 'Liste d\'attente si complet'
    },
    
    // 📢 COMMUNICATION
    sendReminders: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    
    reminderSchedule: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {
        '7_days': true,
        '1_day': true,
        '1_hour': true
      }
    },
    
    lastReminderSent: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    // 📱 NOTIFICATIONS
    notificationSettings: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {
        newRegistration: true,
        cancellation: true,
        reminder: true
      }
    },
    
    // 📊 FEEDBACK & EVALUATION
    feedbackEnabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    
    feedbackResponses: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: []
    },
    
    averageRating: {
      type: DataTypes.DECIMAL(3, 2),
      allowNull: true,
      validate: {
        min: 0.00,
        max: 5.00
      }
    },
    
    // 📸 MEDIAS
    imageUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isUrl: true
      }
    },
    
    attachments: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
      comment: 'Documents, images, liens utiles'
    },
    
    // 🔄 RÉCURRENCE
    isRecurring: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    
    recurrenceRule: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Règles récurrence (fréquence, fin, exceptions)'
    },
    
    parentEventId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'events',
        key: 'id'
      },
      comment: 'Événement parent si récurrent'
    },
    
    // ⚙️ CONFIGURATION
    allowGuestRegistration: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Autoriser inscription non-membres'
    },
    
    requiresMembershipValidation: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    
    customFields: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Champs personnalisés inscription'
    },
    
    // 📈 ANALYTICS
    viewsCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    
    sharesCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    
    // 📅 DATES IMPORTANTES
    registrationOpenDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    registrationCloseDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    publishedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    lastModifiedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    }
    
  }, {
    sequelize,
    modelName: 'Event',
    tableName: 'events',
    underscored: true,
    timestamps: true,
    paranoid: true, // Soft delete
    
    hooks: {
      beforeCreate: (event) => {
        // Générer slug automatiquement
        if (!event.slug) {
          event.slug = event.title
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .substring(0, 50);
        }
        
        // Calculer durée en minutes
        if (event.startDate && event.endDate) {
          const start = new Date(event.startDate);
          const end = new Date(event.endDate);
          event.duration = Math.round((end - start) / (1000 * 60));
        }
        
        // Date de publication si statut publié
        if (event.status === 'published' && !event.publishedAt) {
          event.publishedAt = new Date();
        }
      },
      
      beforeUpdate: (event) => {
        // Recalculer durée si dates changées
        if (event.changed('startDate') || event.changed('endDate')) {
          if (event.startDate && event.endDate) {
            const start = new Date(event.startDate);
            const end = new Date(event.endDate);
            event.duration = Math.round((end - start) / (1000 * 60));
          }
        }
        
        // Date de publication
        if (event.changed('status') && event.status === 'published' && !event.publishedAt) {
          event.publishedAt = new Date();
        }
        
        // Calculer revenus actuels
        if (event.changed('registrations')) {
          event.actualRevenue = event.getEventRevenue();
        }
      },
      
      afterCreate: (event) => {
        console.log(`📅 Nouvel événement: ${event.title} (${event.startDate})`);
      },
      
      afterUpdate: async (event) => {
        // Notifier changements importants
        if (event.changed('status') && event.status === 'cancelled') {
          console.log(`❌ Événement annulé: ${event.title}`);
          // TODO: Envoyer notifications annulation
        }
        
        if (event.changed('startDate') || event.changed('endDate')) {
          console.log(`📅 Dates modifiées pour: ${event.title}`);
          // TODO: Notifier participants du changement
        }
      }
    },
    
    indexes: [
      { fields: ['association_id'] },
      { fields: ['section_id'] },
      { fields: ['created_by'] },
      { fields: ['status'] },
      { fields: ['type'] },
      { fields: ['start_date'] },
      { fields: ['end_date'] },
      { fields: ['slug'], unique: true },
      { fields: ['is_recurring'] },
      { fields: ['target_audience'] },
      // Index composé pour recherche événements par association/section
      { fields: ['association_id', 'status', 'start_date'] },
      { fields: ['section_id', 'status', 'start_date'] }
    ]
  });

  return Event;
};