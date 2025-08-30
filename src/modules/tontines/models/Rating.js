'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Rating extends Model {
    static associate(models) {
      // Un rating est donné par un utilisateur
      Rating.belongsTo(models.User, {
        foreignKey: 'raterUserId',
        as: 'rater'
      });
      
      // Un rating est reçu par un utilisateur
      Rating.belongsTo(models.User, {
        foreignKey: 'ratedUserId',
        as: 'ratedUser'
      });
      
      // Un rating concerne une tontine
      Rating.belongsTo(models.Tontine, {
        foreignKey: 'tontineId',
        as: 'tontine'
      });
      
      // Un rating peut concerner une participation spécifique
      Rating.belongsTo(models.TontineParticipant, {
        foreignKey: 'participantId',
        as: 'participant'
      });
    }

    // Calculer score global basé sur les scores individuels
    getOverallScore() {
      if (this.overallScore) return this.overallScore;
      
      // Si pas de score global, calculer moyenne des scores détaillés
      const scores = [];
      if (this.punctualityScore) scores.push(this.punctualityScore);
      if (this.reliabilityScore) scores.push(this.reliabilityScore);
      if (this.communicationScore) scores.push(this.communicationScore);
      if (this.organizationScore) scores.push(this.organizationScore);
      
      if (scores.length === 0) return null;
      
      const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
      return Math.round(average * 2) / 2; // Arrondir au 0.5 près
    }

    // Vérifier si notation est complète
    isComplete() {
      return this.overallScore !== null && 
             this.punctualityScore !== null &&
             this.reliabilityScore !== null;
    }

    // Obtenir le niveau de la notation
    getRatingLevel() {
      const score = this.overallScore || this.getOverallScore();
      if (!score) return 'unrated';
      
      if (score >= 4.5) return 'excellent';
      if (score >= 3.5) return 'good';
      if (score >= 2.5) return 'average';
      if (score >= 1.5) return 'poor';
      return 'very_poor';
    }

    // Obtenir badge correspondant
    getBadge() {
      const level = this.getRatingLevel();
      const badges = {
        'excellent': '⭐⭐⭐⭐⭐',
        'good': '⭐⭐⭐⭐',
        'average': '⭐⭐⭐',
        'poor': '⭐⭐',
        'very_poor': '⭐',
        'unrated': '⚪'
      };
      
      return badges[level] || '⚪';
    }

    // Vérifier si peut être modifiée
    canBeEdited() {
      if (this.isLocked) return false;
      
      // Limite temps modification (ex: 7 jours après création)
      const editDeadline = new Date(this.createdAt);
      editDeadline.setDate(editDeadline.getDate() + 7);
      
      return new Date() <= editDeadline;
    }

    // Formater commentaire pour affichage
    getFormattedComment() {
      if (!this.comment) return '';
      
      // Limiter longueur affichage
      if (this.comment.length <= 150) return this.comment;
      return this.comment.substring(0, 147) + '...';
    }
  }

  Rating.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    
    // 🔗 RELATIONS PRINCIPALES
    raterUserId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'Utilisateur qui donne la note'
    },
    
    ratedUserId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'Utilisateur qui reçoit la note'
    },
    
    tontineId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'tontines',
        key: 'id'
      },
      comment: 'Tontine dans laquelle la notation a lieu'
    },
    
    participantId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'tontine_participants',
        key: 'id'
      },
      comment: 'Participation spécifique notée (optionnel)'
    },
    
    // 🎯 TYPE DE NOTATION
    ratingType: {
      type: DataTypes.ENUM(
        'participant_to_organizer',    // Participant note organisateur
        'organizer_to_participant',    // Organisateur note participant
        'participant_to_participant',  // Participant note autre participant (rare)
        'mutual'                       // Notation mutuelle
      ),
      allowNull: false,
      comment: 'Type de relation dans la notation'
    },
    
    // ⭐ SCORES DÉTAILLÉS (1-5 étoiles)
    overallScore: {
      type: DataTypes.DECIMAL(2, 1),
      allowNull: true,
      validate: {
        min: 1.0,
        max: 5.0
      },
      comment: 'Note globale (1.0 à 5.0)'
    },
    
    punctualityScore: {
      type: DataTypes.DECIMAL(2, 1),
      allowNull: true,
      validate: {
        min: 1.0,
        max: 5.0
      },
      comment: 'Ponctualité paiements/présence'
    },
    
    reliabilityScore: {
      type: DataTypes.DECIMAL(2, 1),
      allowNull: true,
      validate: {
        min: 1.0,
        max: 5.0
      },
      comment: 'Fiabilité générale'
    },
    
    communicationScore: {
      type: DataTypes.DECIMAL(2, 1),
      allowNull: true,
      validate: {
        min: 1.0,
        max: 5.0
      },
      comment: 'Qualité communication'
    },
    
    // 🏛️ SCORES SPÉCIFIQUES ORGANISATEUR
    organizationScore: {
      type: DataTypes.DECIMAL(2, 1),
      allowNull: true,
      validate: {
        min: 1.0,
        max: 5.0
      },
      comment: 'Capacité organisation (organisateurs)'
    },
    
    transparencyScore: {
      type: DataTypes.DECIMAL(2, 1),
      allowNull: true,
      validate: {
        min: 1.0,
        max: 5.0
      },
      comment: 'Transparence gestion (organisateurs)'
    },
    
    conflictManagementScore: {
      type: DataTypes.DECIMAL(2, 1),
      allowNull: true,
      validate: {
        min: 1.0,
        max: 5.0
      },
      comment: 'Gestion conflits/incidents (organisateurs)'
    },
    
    // 💬 COMMENTAIRES
    comment: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Commentaire détaillé'
    },
    
    privateNotes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Notes privées (non visibles par le noté)'
    },
    
    // 🔍 CATÉGORIES DÉTAILLÉES
    categories: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Évaluations par catégories spécifiques'
    },
    
    // 🎯 CONTEXTE NOTATION
    contextTags: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Tags contextuels: ["defaillance", "echange_position", "fin_normale"]'
    },
    
    incidentRelated: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Notation liée à un incident'
    },
    
    incidentDescription: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Description incident ayant motivé la notation'
    },
    
    // 👁️ VISIBILITÉ & MODÉRATION
    isPublic: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: 'Notation visible publiquement'
    },
    
    isAnonymous: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Notation anonyme (masquer identité noteur)'
    },
    
    // 🔒 STATUT & CONTRÔLE
    status: {
      type: DataTypes.ENUM('draft', 'published', 'disputed', 'moderated', 'archived'),
      allowNull: false,
      defaultValue: 'draft',
      comment: 'Statut de la notation'
    },
    
    isLocked: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Notation verrouillée (non modifiable)'
    },
    
    // 🔄 RÉPONSE DU NOTÉ
    hasResponse: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Le noté a répondu'
    },
    
    responseComment: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Réponse du noté'
    },
    
    responseDate: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date réponse du noté'
    },
    
    // ⚖️ MODÉRATION
    isDisputed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Notation contestée'
    },
    
    disputeReason: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Motif contestation'
    },
    
    moderatedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'Modérateur ayant traité'
    },
    
    moderationNotes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Notes modération'
    },
    
    // 📊 UTILITÉ & ENGAGEMENT
    helpfulVotes: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: 'Votes "utile" sur cette notation'
    },
    
    reportedCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: 'Nombre signalements'
    },
    
    // 📅 DATES IMPORTANTES
    ratingPeriodStart: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Début période évaluée'
    },
    
    ratingPeriodEnd: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Fin période évaluée'
    },
    
    publishedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date publication notation'
    },
    
    // 🔍 MÉTADONNÉES
    source: {
      type: DataTypes.ENUM('manual', 'automatic', 'imported'),
      allowNull: false,
      defaultValue: 'manual',
      comment: 'Source de la notation'
    },
    
    deviceInfo: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Info appareil (debugging)'
    },
    
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Métadonnées additionnelles'
    }
  }, {
    sequelize,
    modelName: 'Rating',
    tableName: 'ratings',
    underscored: true,
    timestamps: true,
    
    indexes: [
      {
        fields: ['rater_user_id']
      },
      {
        fields: ['rated_user_id']
      },
      {
        fields: ['tontine_id']
      },
      {
        fields: ['rating_type']
      },
      {
        fields: ['overall_score']
      },
      {
        fields: ['status']
      },
      {
        fields: ['is_public']
      },
      {
        fields: ['published_at']
      },
      {
        unique: true,
        fields: ['rater_user_id', 'rated_user_id', 'tontine_id'],
        name: 'unique_rating_per_tontine'
      }
    ],
    
    // Validation métier
    validate: {
      // Au moins un score doit être fourni
      hasAtLeastOneScore() {
        if (!this.overallScore && !this.punctualityScore && !this.reliabilityScore) {
          throw new Error('Au moins un score doit être fourni');
        }
      },
      
      // Pas d'auto-notation
      noSelfRating() {
        if (this.raterUserId === this.ratedUserId) {
          throw new Error('Impossible de se noter soi-même');
        }
      },
      
      // Scores organisateur uniquement pour type approprié
      organizerScoresValidation() {
        const isOrganizerRating = this.ratingType === 'participant_to_organizer';
        const hasOrganizerScores = this.organizationScore || this.transparencyScore || this.conflictManagementScore;
        
        if (hasOrganizerScores && !isOrganizerRating) {
          throw new Error('Scores organisateur réservés aux notations d\'organisateurs');
        }
      }
    }
  });

  return Rating;
};