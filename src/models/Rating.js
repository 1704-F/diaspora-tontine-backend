'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Rating extends Model {
    static associate(models) {
      // Une notation appartient à un utilisateur qui note
      Rating.belongsTo(models.User, {
        foreignKey: 'raterUserId',
        as: 'rater'
      });
      
      // Une notation concerne un utilisateur noté
      Rating.belongsTo(models.User, {
        foreignKey: 'ratedUserId',
        as: 'ratedUser'
      });
      
      // Une notation concerne une tontine
      Rating.belongsTo(models.Tontine, {
        foreignKey: 'tontineId',
        as: 'tontine'
      });
      
      // Une notation peut concerner une participation spécifique
      Rating.belongsTo(models.TontineParticipant, {
        foreignKey: 'participantId',
        as: 'participant'
      });
    }

    // Vérifier si notation peut être modifiée
    canBeModified() {
      if (this.isLocked) return false;
      
      const daysSinceCreated = Math.floor((new Date() - this.createdAt) / (1000 * 60 * 60 * 24));
      return daysSinceCreated <= 30; // 30 jours pour modifier
    }

    // Calculer score global de la notation
    getOverallScore() {
      const scores = [];
      
      if (this.punctualityScore !== null) scores.push(this.punctualityScore);
      if (this.communicationScore !== null) scores.push(this.communicationScore);
      if (this.reliabilityScore !== null) scores.push(this.reliabilityScore);
      if (this.collaborationScore !== null) scores.push(this.collaborationScore);
      
      if (scores.length === 0) return null;
      
      const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
      return Math.round(average * 100) / 100;
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
        'participant_to_participant',  // Participant note autre participant
        'mutual_rating'               // Notation mutuelle
      ),
      allowNull: false
    },
    
    context: {
      type: DataTypes.ENUM(
        'tontine_completion',         // À la fin de la tontine
        'monthly_evaluation',         // Évaluation mensuelle
        'incident_related',          // Suite à un incident
        'mid_term_review',           // Révision mi-parcours
        'voluntary'                  // Notation volontaire
      ),
      allowNull: false,
      defaultValue: 'tontine_completion'
    },
    
    // ⭐ SCORES DÉTAILLÉS (0.0 - 5.0)
    overallScore: {
      type: DataTypes.DECIMAL(3, 2),
      allowNull: true,
      validate: {
        min: 0.00,
        max: 5.00
      },
      comment: 'Note globale générale'
    },
    
    punctualityScore: {
      type: DataTypes.DECIMAL(3, 2),
      allowNull: true,
      validate: {
        min: 0.00,
        max: 5.00
      },
      comment: 'Ponctualité des paiements/participation'
    },
    
    communicationScore: {
      type: DataTypes.DECIMAL(3, 2),
      allowNull: true,
      validate: {
        min: 0.00,
        max: 5.00
      },
      comment: 'Qualité de la communication'
    },
    
    reliabilityScore: {
      type: DataTypes.DECIMAL(3, 2),
      allowNull: true,
      validate: {
        min: 0.00,
        max: 5.00
      },
      comment: 'Fiabilité générale'
    },
    
    collaborationScore: {
      type: DataTypes.DECIMAL(3, 2),
      allowNull: true,
      validate: {
        min: 0.00,
        max: 5.00
      },
      comment: 'Esprit de collaboration'
    },
    
    organizationScore: {
      type: DataTypes.DECIMAL(3, 2),
      allowNull: true,
      validate: {
        min: 0.00,
        max: 5.00
      },
      comment: 'Capacité d\'organisation (pour organisateurs)'
    },
    
    transparencyScore: {
      type: DataTypes.DECIMAL(3, 2),
      allowNull: true,
      validate: {
        min: 0.00,
        max: 5.00
      },
      comment: 'Transparence financière (pour organisateurs)'
    },
    
    fairnessScore: {
      type: DataTypes.DECIMAL(3, 2),
      allowNull: true,
      validate: {
        min: 0.00,
        max: 5.00
      },
      comment: 'Équité dans les décisions'
    },
    
    // 📝 COMMENTAIRES
    positiveComment: {
      type: DataTypes.TEXT,
      allowNull: true,
      validate: {
        len: [0, 1000]
      },
      comment: 'Commentaire positif'
    },
    
    negativeComment: {
      type: DataTypes.TEXT,
      allowNull: true,
      validate: {
        len: [0, 1000]
      },
      comment: 'Points d\'amélioration'
    },
    
    privateComment: {
      type: DataTypes.TEXT,
      allowNull: true,
      validate: {
        len: [0, 500]
      },
      comment: 'Commentaire privé (admin uniquement)'
    },
    
    // 🏷️ TAGS & CATÉGORIES
    strengths: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
      comment: 'Points forts identifiés'
    },
    
    weaknesses: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
      comment: 'Points faibles identifiés'
    },
    
    recommendedActions: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
      comment: 'Actions recommandées'
    },
    
    // 📊 ÉVALUATION DÉTAILLÉE
    criteriaEvaluation: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Évaluation détaillée par critères personnalisés'
    },
    
    behaviorMetrics: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Métriques comportementales (retards, absences, etc.)'
    },
    
    // 🤝 RECOMMANDATION
    wouldRecommend: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      comment: 'Recommanderait cette personne à d\'autres'
    },
    
    wouldParticipateAgain: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      comment: 'Participerait à nouveau avec cette personne'
    },
    
    recommendationLevel: {
      type: DataTypes.ENUM('strongly_recommend', 'recommend', 'neutral', 'not_recommend', 'strongly_against'),
      allowNull: true
    },
    
    // 📅 PÉRIODE ÉVALUÉE
    evaluationPeriodStart: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Début de la période évaluée'
    },
    
    evaluationPeriodEnd: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Fin de la période évaluée'
    },
    
    // 🔒 STATUT & VISIBILITÉ
    status: {
      type: DataTypes.ENUM('draft', 'submitted', 'published', 'disputed', 'archived'),
      allowNull: false,
      defaultValue: 'draft'
    },
    
    visibility: {
      type: DataTypes.ENUM('private', 'tontine_members', 'public', 'platform_admin'),
      allowNull: false,
      defaultValue: 'tontine_members'
    },
    
    isAnonymous: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Notation anonyme'
    },
    
    isLocked: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Verrouillée contre modifications'
    },
    
    // 🚨 INCIDENTS & LITIGES
    hasIncidents: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    
    incidentDetails: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Détails des incidents rapportés'
    },
    
    isDisputed: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    
    disputeReason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    
    disputeResolution: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    
    // ⚖️ MODÉRATION
    flaggedForReview: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    
    moderationNotes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Notes équipe modération'
    },
    
    reviewedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    reviewedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    
    // 📈 IMPACT
    impactOnReputation: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: true,
      comment: 'Impact calculé sur réputation (-10.00 à +10.00)'
    },
    
    weightFactor: {
      type: DataTypes.DECIMAL(3, 2),
      defaultValue: 1.00,
      comment: 'Poids de cette notation (0.1 à 2.0)'
    },
    
    // 🔄 SUIVI
    hasFollowUp: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    
    followUpDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    followUpActions: {
      type: DataTypes.JSON,
      allowNull: true
    },
    
    // 📱 TECHNICAL METADATA
   deviceInfo: {
     type: DataTypes.JSON,
     allowNull: true,
     comment: 'Device utilisé pour la notation'
   },
   
   ipAddress: {
     type: DataTypes.STRING,
     allowNull: true
   },
   
   userAgent: {
     type: DataTypes.TEXT,
     allowNull: true
   },
   
   // 📊 ANALYTICS
   viewCount: {
     type: DataTypes.INTEGER,
     defaultValue: 0,
     comment: 'Nombre de fois consultée'
   },
   
   helpfulVotes: {
     type: DataTypes.INTEGER,
     defaultValue: 0,
     comment: 'Votes "utile" reçus'
   },
   
   // ⏰ TIMING
   submittedAt: {
     type: DataTypes.DATE,
     allowNull: true
   },
   
   publishedAt: {
     type: DataTypes.DATE,
     allowNull: true
   },
   
   lastModifiedAt: {
     type: DataTypes.DATE,
     allowNull: true
   },
   
   expiresAt: {
     type: DataTypes.DATE,
     allowNull: true,
     comment: 'Date expiration de la notation'
   }
   
 }, {
   sequelize,
   modelName: 'Rating',
   tableName: 'ratings',
   underscored: true,
   timestamps: true,
   paranoid: true, // Soft delete
   
   hooks: {
     beforeCreate: (rating) => {
       // Calculer score global automatiquement
       if (!rating.overallScore) {
         rating.overallScore = rating.getOverallScore();
       }
       
       // Date de soumission
       if (rating.status === 'submitted' && !rating.submittedAt) {
         rating.submittedAt = new Date();
       }
       
       // Calculer impact sur réputation
       if (rating.overallScore) {
         const impact = (rating.overallScore - 2.5) * 2; // Scale -5 to +5
         rating.impactOnReputation = Math.round(impact * 100) / 100;
       }
     },
     
     beforeUpdate: (rating) => {
       // Recalculer score global si scores individuels changent
       const scoreFields = ['punctualityScore', 'communicationScore', 'reliabilityScore', 'collaborationScore'];
       if (scoreFields.some(field => rating.changed(field))) {
         rating.overallScore = rating.getOverallScore();
       }
       
       // Date de soumission
       if (rating.changed('status') && rating.status === 'submitted' && !rating.submittedAt) {
         rating.submittedAt = new Date();
       }
       
       // Date de publication
       if (rating.changed('status') && rating.status === 'published' && !rating.publishedAt) {
         rating.publishedAt = new Date();
       }
       
       // Date dernière modification
       rating.lastModifiedAt = new Date();
       
       // Verrouiller automatiquement après publication
       if (rating.changed('status') && rating.status === 'published') {
         rating.isLocked = true;
       }
     },
     
     afterCreate: async (rating) => {
       console.log(`⭐ Nouvelle notation: ${rating.raterUserId} → ${rating.ratedUserId} (Tontine ${rating.tontineId})`);
       
       // Mettre à jour score réputation utilisateur noté
       const ratedUser = await rating.getRatedUser();
       if (ratedUser && rating.overallScore) {
         // TODO: Recalculer moyenne réputation tontines
       }
     },
     
     afterUpdate: async (rating) => {
       // Recalculer réputation si score modifié
       if (rating.changed('overallScore') && rating.status === 'published') {
         const ratedUser = await rating.getRatedUser();
         if (ratedUser) {
           console.log(`📊 Mise à jour réputation User ${ratedUser.id}`);
           // TODO: Recalculer score réputation
         }
       }
       
       // Log si notation contestée
       if (rating.changed('isDisputed') && rating.isDisputed) {
         console.log(`🚨 Notation contestée: Rating ${rating.id} - Raison: ${rating.disputeReason}`);
       }
     }
   },
   
   indexes: [
     { fields: ['rater_user_id'] },
     { fields: ['rated_user_id'] },
     { fields: ['tontine_id'] },
     { fields: ['participant_id'] },
     { fields: ['rating_type'] },
     { fields: ['status'] },
     { fields: ['overall_score'] },
     { fields: ['is_disputed'] },
     { fields: ['flagged_for_review'] },
     { fields: ['submitted_at'] },
     { fields: ['published_at'] },
     // Index composé pour éviter doublons
     { fields: ['rater_user_id', 'rated_user_id', 'tontine_id'], unique: true },
     // Index pour recherche notations utilisateur
     { fields: ['rated_user_id', 'status', 'published_at'] },
     { fields: ['tontine_id', 'rating_type', 'status'] }
   ],
   
   validate: {
     // Validation: ne peut pas se noter soi-même
     cannotSelfRate() {
       if (this.raterUserId === this.ratedUserId) {
         throw new Error('Un utilisateur ne peut pas se noter lui-même');
       }
     },
     
     // Validation: scores cohérents
     scoresConsistency() {
       const scores = [this.punctualityScore, this.communicationScore, this.reliabilityScore, this.collaborationScore].filter(s => s !== null);
       if (scores.length > 0 && this.overallScore) {
         const calculatedAverage = scores.reduce((sum, score) => sum + score, 0) / scores.length;
         const difference = Math.abs(calculatedAverage - this.overallScore);
         if (difference > 1.0) {
           throw new Error('Le score global doit être cohérent avec les scores détaillés');
         }
       }
     }
   }
 });

 return Rating;
};