//src/modules/association/models/association.js
'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Association extends Model {
    static associate(models) {
      // Une association a plusieurs sections
      Association.hasMany(models.Section, {
        foreignKey: 'associationId',
        as: 'sections'
      });
      
      // Une association a plusieurs membres (via AssociationMember)
      Association.hasMany(models.AssociationMember, {
        foreignKey: 'associationId',
        as: 'memberships'
      });
      
      // Une association a plusieurs transactions
      Association.hasMany(models.Transaction, {
        foreignKey: 'associationId',
        as: 'transactions'
      });
      
      // Documents légaux
      Association.hasMany(models.Document, {
        foreignKey: 'associationId',
        as: 'documents'
      });
    }

    // Calculer le nombre de membres actifs
    async getActiveMembersCount() {
      const { AssociationMember } = sequelize.models;
      return await AssociationMember.count({
        where: { 
          associationId: this.id,
          status: 'active'
        }
      });
    }

    // Calculer le montant total en caisse
    async getTotalBalance() {
      const { Transaction } = sequelize.models;
      const result = await Transaction.findOne({
        where: { associationId: this.id },
        attributes: [
          [sequelize.fn('SUM', sequelize.col('net_amount')), 'total']
        ],
        raw: true
      });
      return parseFloat(result?.total || 0);
    }
  }

  Association.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    
    // 🏢 INFORMATIONS DE BASE
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        len: [3, 100]
      },
      comment: 'Nom de l\'association ex: "Diaspora Malienne Europe"'
    },
    
    slug: {
  type: DataTypes.STRING(255),
  allowNull: false,
  field: 'slug', // Mapping explicite
  validate: {
    isLowercase: true,
    is: /^[a-z0-9-]+$/
  },
  comment: 'URL-friendly: "diaspora-malienne-europe"'
},
    
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    
    // 🏛️ STATUT LEGAL
    legalStatus: {
      type: DataTypes.ENUM('association_1901', 'asbl', 'nonprofit_501c3', 'other'),
      allowNull: false,
      defaultValue: 'association_1901'
    },
    
    registrationNumber: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Numéro RNA/SIREN en France, etc.'
    },
    
    registrationDate: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },
    
    // 📍 DOMICILIATION
    domiciliationCountry: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'FR',
      validate: {
        len: [2, 2]
      }
    },
    
    domiciliationCity: {
      type: DataTypes.STRING,
      allowNull: true
    },
    
    headquartersAddress: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    
    // 💰 INFORMATIONS FINANCIERES
    primaryCurrency: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'EUR',
      validate: {
        isIn: [['EUR', 'USD', 'XOF', 'GBP', 'CAD']]
      }
    },
    
    bankDetails: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'RIB principal: {iban, bic, bankName, accountHolder}'
    },
    
    // 👥 BUREAU CENTRAL (Direction)
    centralBoard: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {},
      comment: 'Président, Secrétaire, Trésorier + rôles custom'
    },
    
    // ⚙️ CONFIGURATION FLEXIBLE
    memberTypes: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {
        'etudiant': { label: 'Étudiant', monthlyAmount: 20 },
        'cdi': { label: 'CDI', monthlyAmount: 50 },
        'cdd': { label: 'CDD', monthlyAmount: 35 },
        'non_actif': { label: 'Non actif', monthlyAmount: 0 },
        'retraite': { label: 'Retraité', monthlyAmount: 25 }
      },
      comment: 'Types de membres configurables avec montants'
    },
    
    accessRights: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {
        finances: 'central_board_only',
        membersList: 'all_members', 
        statistics: 'all_members',
        calendar: 'all_members',
        expenses: 'central_board_only'
      },
      comment: 'Droits d\'accès configurables par type de contenu'
    },
    
    cotisationSettings: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {
        dueDay: 5, // 5 de chaque mois
        gracePeriodDays: 5,
        lateFeesEnabled: false,
        lateFeesAmount: 0,
        inactivityThresholdMonths: 3
      }
    },
    
    // 📋 STATUTS & VALIDATION
    status: {
      type: DataTypes.ENUM('pending_validation', 'active', 'suspended', 'dissolved'),
      allowNull: false,
      defaultValue: 'pending_validation'
    },
    
    validatedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    validatedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'ID admin platform qui a validé'
    },
    
    // 📄 DOCUMENTS LEGAUX
    documentsStatus: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {
        statuts: { uploaded: false, validated: false, expiresAt: null },
        receipisse: { uploaded: false, validated: false, expiresAt: null },
        rib: { uploaded: false, validated: false, expiresAt: null },
        pv_creation: { uploaded: false, validated: false, expiresAt: null }
      }
    },
    
    // 🌍 MULTI-SECTIONS
    isMultiSection: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'true si association avec sections géographiques'
    },
    
    sectionsCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Nombre de sections (cache)'
    },
    
    // 📊 STATISTIQUES
    totalMembers: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    
    activeMembers: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    
    totalFundsRaised: {
      type: DataTypes.DECIMAL(12, 2),
      defaultValue: 0.00
    },
    
    totalAidsGiven: {
      type: DataTypes.DECIMAL(12, 2),
      defaultValue: 0.00
    },
    
    // 🎨 PERSONNALISATION
    theme: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {
        primaryColor: '#2c5530',
        secondaryColor: '#4a7c59',
        logo: null
      }
    },
    
    // 📱 CONTACT & COMMUNICATION
    contactInfo: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Email, téléphone, réseaux sociaux'
    },
    
    website: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isUrl: true
      }
    },
    permissionsMatrix: {
  type: DataTypes.JSON,
  allowNull: true,
  defaultValue: {},
  comment: 'Matrice des permissions configurables par association'
},


    
    // ⚙️ CONFIGURATION AVANCEE
    subscriptionPlan: {
      type: DataTypes.ENUM('free', 'standard', 'premium', 'enterprise'),
      allowNull: false,
      defaultValue: 'standard'
    },
    
    subscriptionExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    features: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {
        maxMembers: 500,
        maxSections: 3,
        customTypes: true,
        advancedReports: false,
        apiAccess: false
      }
    },
    
    // 📈 BUSINESS METRICS
    monthlyRevenue: {
      type: DataTypes.DECIMAL(8, 2),
      defaultValue: 0.00,
      comment: 'Revenue généré pour la plateforme (10€ + commissions)'
    },
    
    lastActivityAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
    
  }, {
    sequelize,
    modelName: 'Association',
    tableName: 'associations',
    underscored: true,
    timestamps: true,
    paranoid: true, // Soft delete
    
    hooks: {
      beforeCreate: (association) => {
        // Générer slug automatiquement
        if (!association.slug) {
          association.slug = association.name
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .substring(0, 50);
        }
      },
      
      afterCreate: (association) => {
        console.log(`🏛️ Nouvelle association créée: ${association.name}`);
      },
      
      beforeUpdate: (association) => {
        // Mettre à jour lastActivityAt
        association.lastActivityAt = new Date();
      }
    },
    
    indexes: [
  { 
    fields: ['slug'], 
    unique: true,
    name: 'associations_slug_unique'
  },
  { fields: ['status'] },
  { fields: ['domiciliation_country'] },
  { fields: ['is_multi_section'] },
  { fields: ['subscription_plan'] },
  { fields: ['created_at'] }
] 
  });

  return Association;
};