'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Section extends Model {
    static associate(models) {
      // Une section appartient à une association
      Section.belongsTo(models.Association, {
        foreignKey: 'associationId',
        as: 'association'
      });
      
      // Une section a plusieurs membres
      Section.hasMany(models.AssociationMember, {
        foreignKey: 'sectionId',
        as: 'members'
      });
      
      // Une section a plusieurs transactions
      Section.hasMany(models.Transaction, {
        foreignKey: 'sectionId',
        as: 'transactions'
      });
    }

    // Calculer nombre de membres actifs
    async getActiveMembersCount() {
      const { AssociationMember } = sequelize.models;
      return await AssociationMember.count({
        where: { 
          sectionId: this.id,
          status: 'active'
        }
      });
    }

    // Calculer montant collecté ce mois
    async getCurrentMonthRevenue() {
      const { Transaction } = sequelize.models;
      const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const endOfMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);
      
      const result = await Transaction.findOne({
        where: { 
          sectionId: this.id,
          type: 'cotisation',
          createdAt: {
            [sequelize.Sequelize.Op.between]: [startOfMonth, endOfMonth]
          }
        },
        attributes: [
          [sequelize.fn('SUM', sequelize.col('amount')), 'total']
        ],
        raw: true
      });
      return parseFloat(result?.total || 0);
    }
  }

  Section.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    
    // 🔗 RELATION ASSOCIATION
    associationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'associations',
        key: 'id'
      }
    },
    
    // 🏷️ IDENTIFICATION
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        len: [2, 100]
      },
      comment: 'Nom de la section ex: "Section France", "Section Italie"'
    },
    
    slug: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isLowercase: true,
        is: /^[a-z0-9-]+$/
      },
      comment: 'URL-friendly: "section-france"'
    },
    
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    
    // 🌍 LOCALISATION
    country: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        len: [2, 2]
      },
      comment: 'Code pays ISO: FR, IT, US, etc.'
    },
    
    region: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Région/État: Île-de-France, California, etc.'
    },
    
    city: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Ville principale: Paris, Milan, New York'
    },
    
    timezone: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'Europe/Paris',
      comment: 'Fuseau horaire pour les activités locales'
    },
    
    // 💰 CONFIGURATION FINANCIERE
    currency: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'EUR',
      validate: {
        isIn: [['EUR', 'USD', 'XOF', 'GBP', 'CAD']]
      }
    },
    
    // Montants des cotisations par type de membre (spécifiques à la section)
    memberTypeRates: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {
        'etudiant': 15.00,
        'cdi': 45.00,
        'cdd': 30.00,
        'non_actif': 0.00,
        'retraite': 20.00
      },
      comment: 'Montants cotisations adaptés au coût de la vie local'
    },
    
    // 👥 BUREAU SECTION
    localBoard: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {},
      comment: 'Responsable, Secrétaire, Trésorier section + contacts'
    },
    
    // 📞 CONTACT LOCAL
    contactInfo: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Email, téléphone, adresse bureau section'
    },
    
    meetingAddress: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Adresse habituelle des réunions'
    },
    
    // 🌐 LANGUE & CULTURE
    primaryLanguage: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'fr',
      validate: {
        isIn: [['fr', 'en', 'it', 'es']]
      }
    },
    
    supportedLanguages: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: ['fr'],
      comment: 'Langues supportées par la section'
    },
    
    culturalSettings: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {
        holidays: [],
        events: [],
        traditions: []
      }
    },
    
    // 📊 STATUT & ACTIVITE
    status: {
      type: DataTypes.ENUM('active', 'suspended', 'dissolved'),
      allowNull: false,
      defaultValue: 'active'
    },
    
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    
    activatedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    // 📈 STATISTIQUES
    totalMembers: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    
    activeMembers: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    
    monthlyRevenue: {
      type: DataTypes.DECIMAL(8, 2),
      defaultValue: 0.00,
      comment: 'Revenue mensuel moyen de la section'
    },
    
    totalFundsRaised: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0.00
    },
    
    totalAidsGiven: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0.00
    },
    
    // ⚙️ CONFIGURATION LOCALE
    localSettings: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {
        cotisationDay: 5,
        meetingDay: 'first_saturday',
        fiscalYearStart: 'january',
        autoReminders: true
      }
    },
    
    // 🎨 PERSONNALISATION
    theme: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Couleurs, logo spécifiques à la section'
    },
    
    // 📱 COMMUNICATION
    communicationChannels: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {
        whatsapp: null,
        telegram: null,
        discord: null,
        slack: null
      }
    },
    
    // 📅 EVENEMENTS
    upcomingEvents: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: []
    },
    
    lastAssemblyDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    nextAssemblyDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    // 🔄 ACTIVITE
    lastActivityAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    // 📊 PERFORMANCE
    performanceMetrics: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {
        memberRetentionRate: 0,
        averageContributionDelay: 0,
        eventAttendanceRate: 0
      }
    }
    
  }, {
    sequelize,
    modelName: 'Section',
    tableName: 'sections',
    underscored: true,
    timestamps: true,
    paranoid: true, // Soft delete
    
    hooks: {
      beforeCreate: (section) => {
        // Générer slug automatiquement
        if (!section.slug) {
          section.slug = section.name
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .substring(0, 50);
        }
        
        // Date d'activation
        if (section.isActive && !section.activatedAt) {
          section.activatedAt = new Date();
        }
      },
      
      beforeUpdate: (section) => {
        // Mettre à jour lastActivityAt
        section.lastActivityAt = new Date();
        
        // Date d'activation si changement de statut
        if (section.changed('isActive') && section.isActive && !section.activatedAt) {
          section.activatedAt = new Date();
        }
      },
      
      afterCreate: (section) => {
        console.log(`🌍 Nouvelle section créée: ${section.name} (${section.country})`);
      }
    },
    
    indexes: [
      { fields: ['association_id'] },
      { fields: ['country'] },
      { fields: ['status'] },
      { fields: ['is_active'] },
      { fields: ['primary_language'] },
      { fields: ['currency'] },
      { fields: ['slug'] },
      { fields: ['created_at'] }
    ]
  });

  return Section;
};