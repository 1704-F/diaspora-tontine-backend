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
      
      // Un membre a plusieurs transactions
      AssociationMember.hasMany(models.Transaction, {
        foreignKey: 'membershipId',
        as: 'transactions'
      });
    }

    // Calculer l'ancienneté en mois
    getAnciennetyMonths() {
      const joinDate = this.joinDate || this.createdAt;
      const now = new Date();
      const diffTime = Math.abs(now - joinDate);
      const diffMonths = Math.ceil(diffTime / (1000 * 60 * 60 * 24 * 30.44)); // 30.44 jours/mois en moyenne
      return diffMonths;
    }

    // Vérifier si à jour des cotisations
    async isUpToDate() {
      if (this.memberType === 'non_actif') return true;
      
      const currentMonth = new Date().getMonth();
      const currentYear = new Date().getFullYear();
      
      const { Transaction } = sequelize.models;
      const lastPayment = await Transaction.findOne({
        where: { 
          membershipId: this.id,
          type: 'cotisation'
        },
        order: [['createdAt', 'DESC']]
      });
      
      if (!lastPayment) return false;
      
      const paymentMonth = lastPayment.createdAt.getMonth();
      const paymentYear = lastPayment.createdAt.getFullYear();
      
      return paymentYear === currentYear && paymentMonth >= currentMonth - 1;
    }

    // Calculer montant cotisation selon type
    getMonthlyCotisation() {
      if (this.memberType === 'non_actif') return 0;
      
      const rates = this.customRates || {};
      return rates[this.memberType] || 0;
    }
  }

  AssociationMember.init({
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
      comment: 'NULL pour associations mono-géographiques'
    },
    
    // 👤 INFORMATIONS MEMBRE
    memberNumber: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Numéro membre unique dans l\'association'
    },
    
    memberType: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'cdi',
      comment: 'Type configurable: etudiant, cdi, cdd, non_actif, retraite, etc.'
    },
    
    // 📅 DATES IMPORTANTES
    joinDate: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    
    validatedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date validation par le bureau'
    },
    
    validatedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'ID du membre du bureau qui a validé'
    },
    
    // 📊 STATUT MEMBRE
    status: {
      type: DataTypes.ENUM(
        'pending',        // En attente validation
        'active',         // Actif
        'inactive',       // Inactif (retard cotisations)
        'suspended',      // Suspendu temporairement
        'excluded',       // Exclu définitivement
        'departed',       // Parti (déménagement, etc.)
        'deceased'        // Décédé
      ),
      allowNull: false,
      defaultValue: 'pending'
    },
    
    statusReason: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Raison du statut (exclusion, suspension, etc.)'
    },
    
    lastStatusChange: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    // 💰 COTISATIONS
    monthlyContribution: {
      type: DataTypes.DECIMAL(6, 2),
      allowNull: false,
      defaultValue: 0.00,
      comment: 'Montant cotisation mensuelle selon type membre'
    },
    
    customRates: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Taux personnalisés si différents des taux section/association'
    },
    
    lastCotisationDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    cotisationStatus: {
      type: DataTypes.ENUM('up_to_date', 'late', 'very_late', 'defaulted'),
      allowNull: false,
      defaultValue: 'up_to_date'
    },
    
    monthsBehind: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Nombre de mois de retard'
    },
    
    totalOwed: {
      type: DataTypes.DECIMAL(8, 2),
      defaultValue: 0.00,
      comment: 'Montant total dû'
    },
    
    // 🎯 ROLES & PERMISSIONS
    role: {
      type: DataTypes.ENUM(
        'member',           // Membre simple
        'active_member',    // Membre actif (votes)
        'delegate',         // Délégué section
        'board_member',     // Membre bureau section
        'treasurer',        // Trésorier section
        'secretary',        // Secrétaire section
        'president',        // Président section
        'central_board',    // Bureau central
        'founder'           // Membre fondateur
      ),
      allowNull: false,
      defaultValue: 'member'
    },
    
    permissions: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {
        canVote: false,
        canViewFinances: false,
        canManageMembers: false,
        canOrganizeEvents: false,
        canApproveAids: false
      }
    },
    
    // 🏆 ENGAGEMENT & PARTICIPATION
    attendanceRate: {
      type: DataTypes.DECIMAL(5, 2),
      defaultValue: 0.00,
      comment: 'Taux présence événements (%)'
    },
    
    eventsAttended: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    
    volunteerHours: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    
    // 💝 AIDES REÇUES/DONNÉES
    totalAidsReceived: {
      type: DataTypes.DECIMAL(8, 2),
      defaultValue: 0.00
    },
    
    aidsReceivedCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    
    lastAidDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    // 📱 PREFERENCES COMMUNICATION
    preferredContactMethod: {
      type: DataTypes.ENUM('sms', 'email', 'whatsapp', 'phone', 'postal'),
      allowNull: false,
      defaultValue: 'sms'
    },
    
    notificationSettings: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {
        cotisationReminders: true,
        eventNotifications: true,
        aidApprovals: true,
        generalAnnouncements: true
      }
    },
    
    // 🔄 TRANSFERTS
    transferHistory: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
      comment: 'Historique transferts entre sections'
    },
    
    transferredFrom: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'sections',
        key: 'id'
      }
    },
    
    transferDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    // 👨‍👩‍👧‍👦 FAMILLE & PARRAINAGE
    sponsor: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'association_members',
        key: 'id'
      },
      comment: 'Membre qui a parrainé'
    },
    
    familyMembers: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
      comment: 'Autres membres famille dans association'
    },
    
    emergencyContact: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Contact urgence: nom, téléphone, relation'
    },
    
    // 📊 STATISTIQUES FINANCIERES
    totalContributed: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0.00
    },
    
    averageMonthlyPayment: {
      type: DataTypes.DECIMAL(6, 2),
      defaultValue: 0.00
    },
    
    paymentReliabilityScore: {
      type: DataTypes.DECIMAL(3, 2),
      defaultValue: 5.00,
      validate: {
        min: 0.00,
        max: 5.00
      },
      comment: 'Score fiabilité paiements (0-5)'
    },
    
    // 📝 NOTES & COMMENTAIRES
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Notes privées bureau sur le membre'
    },
    
    publicProfile: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Infos publiques visibles autres membres'
    },
    
    // ⚙️ METADATA
    dataImported: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Données importées historique ou saisie manuelle'
    },
    
    importedFromSystem: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Système origine si importé'
    },
    
    lastActivityAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
    
  }, {
    sequelize,
    modelName: 'AssociationMember',
    tableName: 'association_members',
    underscored: true,
    timestamps: true,
    paranoid: true, // Soft delete
    
    hooks: {
      beforeCreate: (member) => {
        // Générer numéro membre automatiquement
        if (!member.memberNumber) {
          const year = new Date().getFullYear().toString().slice(-2);
          const timestamp = Date.now().toString().slice(-6);
          member.memberNumber = `M${year}${timestamp}`;
        }
        
        // Date de dernière activité
        member.lastActivityAt = new Date();
      },
      
      beforeUpdate: (member) => {
        // Mettre à jour date dernière activité
        member.lastActivityAt = new Date();
        
        // Mettre à jour date changement statut
        if (member.changed('status')) {
          member.lastStatusChange = new Date();
        }
      },
      
      afterCreate: async (member) => {
        console.log(`👤 Nouveau membre: ${member.memberNumber} (Association ID: ${member.associationId})`);
        
        // Mettre à jour compteur membres association
        const association = await member.getAssociation();
        if (association) {
          await association.increment('totalMembers');
          if (member.status === 'active') {
            await association.increment('activeMembers');
          }
        }
        
        // Mettre à jour compteur section si applicable
        if (member.sectionId) {
          const section = await member.getSection();
          if (section) {
            await section.increment('totalMembers');
            if (member.status === 'active') {
              await section.increment('activeMembers');
            }
          }
        }
      },
      
      afterUpdate: async (member) => {
        // Mettre à jour compteurs si changement statut
        if (member.changed('status')) {
          const association = await member.getAssociation();
          const section = member.sectionId ? await member.getSection() : null;
          
          if (member.status === 'active' && member._previousDataValues.status !== 'active') {
            // Nouveau membre actif
            if (association) await association.increment('activeMembers');
            if (section) await section.increment('activeMembers');
          } else if (member.status !== 'active' && member._previousDataValues.status === 'active') {
            // Plus membre actif
            if (association) await association.decrement('activeMembers');
            if (section) await section.decrement('activeMembers');
          }
        }
      }
    },
    
    indexes: [
      { fields: ['user_id'] },
      { fields: ['association_id'] },
      { fields: ['section_id'] },
      { fields: ['member_number'], unique: true },
      { fields: ['status'] },
      { fields: ['member_type'] },
      { fields: ['role'] },
      { fields: ['cotisation_status'] },
      { fields: ['join_date'] },
      { fields: ['last_cotisation_date'] },
      // Index composé pour éviter doublons user/association
      { fields: ['user_id', 'association_id'], unique: true }
    ]
  });

  return AssociationMember;
};