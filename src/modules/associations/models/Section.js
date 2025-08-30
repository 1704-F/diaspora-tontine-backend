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
      
      // Une section peut avoir des événements spécifiques
      Section.hasMany(models.Event, {
        foreignKey: 'sectionId',
        as: 'events'
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

    // Calculer cotisations collectées ce mois
    async getMonthlyContributions() {
      const { Transaction } = sequelize.models;
      const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const endOfMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);
      
      const result = await Transaction.findOne({
        where: {
          sectionId: this.id,
          type: 'cotisation',
          status: 'completed',
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

    // Vérifier si bureau section est complet
    hasBureauComplete() {
      const bureau = this.bureauSection || {};
      return !!(bureau.responsable && bureau.secretaire && bureau.tresorier);
    }
  }

  Section.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    
    // 🏛️ ASSOCIATION PARENTE
    associationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'associations',
        key: 'id'
      },
      comment: 'Association dont dépend cette section'
    },
    
    // 📍 IDENTIFICATION SECTION
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: 'Nom de la section (ex: "Diama France", "Une vie pour tous - Italie")'
    },
    
    code: {
      type: DataTypes.STRING(10),
      allowNull: true,
      comment: 'Code court pour identification (ex: "FR", "IT", "ES")'
    },
    
    country: {
      type: DataTypes.STRING(3),
      allowNull: false,
      comment: 'Code pays ISO 3166 (ex: "FR", "IT", "ES")'
    },
    
    city: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Ville principale de la section'
    },
    
    region: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Région ou département'
    },
    
    // 💰 CONFIGURATION FINANCIÈRE
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'EUR',
      comment: 'Devise utilisée par cette section'
    },
    
    cotisationRates: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Montants cotisations par type membre (JSON configurable)'
    },
    
    // 🏛️ BUREAU SECTION
    bureauSection: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Membres du bureau section: responsable, secrétaire, trésorier'
    },
    
    // 🌐 LOCALISATION
    language: {
      type: DataTypes.STRING(2),
      allowNull: false,
      defaultValue: 'fr',
      comment: 'Langue principale section (fr, it, es, en)'
    },
    
    timezone: {
      type: DataTypes.STRING(50),
      allowNull: true,
      defaultValue: 'Europe/Paris',
      comment: 'Fuseau horaire section'
    },
    
    // 📞 CONTACT
    contactPhone: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: 'Numéro contact responsable section'
    },
    
    contactEmail: {
      type: DataTypes.STRING(255),
      allowNull: true,
      validate: {
        isEmail: true
      },
      comment: 'Email contact section'
    },
    
    // 📊 STATISTIQUES
    membersCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: 'Nombre membres actuels (mis à jour automatiquement)'
    },
    
    activeMembersCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: 'Nombre membres actifs (cotisations à jour)'
    },
    
    // 🔧 PARAMÈTRES
    settings: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Configuration spécifique section (règles, permissions)'
    },
    
    // ✅ STATUS
    status: {
      type: DataTypes.ENUM('active', 'inactive', 'suspended'),
      allowNull: false,
      defaultValue: 'active',
      comment: 'Statut de la section'
    },
    
    // 📅 DATES
    foundedDate: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date de création de la section'
    },
    
    lastActivityAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Dernière activité enregistrée'
    }
  }, {
    sequelize,
    modelName: 'Section',
    tableName: 'sections',
    underscored: true,
    timestamps: true,
    
    indexes: [
      {
        fields: ['association_id']
      },
      {
        fields: ['country']
      },
      {
        fields: ['status']
      },
      {
        unique: true,
        fields: ['association_id', 'name'],
        name: 'unique_section_per_association'
      }
    ]
  });

  return Section;
};