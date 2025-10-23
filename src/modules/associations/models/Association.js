//src/modules/associations/models/Association.js
"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Association extends Model {
    static associate(models) {
      // Une association a plusieurs sections
      Association.hasMany(models.Section, {
        foreignKey: "associationId",
        as: "sections",
      });

      // Une association a plusieurs membres (via AssociationMember)
      Association.hasMany(models.AssociationMember, {
        foreignKey: "associationId",
        as: "memberships",
      });

      // Une association a plusieurs transactions
      Association.hasMany(models.Transaction, {
        foreignKey: "associationId",
        as: "transactions",
      });

      // Documents légaux
      Association.hasMany(models.Document, {
        foreignKey: "associationId",
        as: "documents",
      });
    }

    // Calculer le nombre de membres actifs
    async getActiveMembersCount() {
      const { AssociationMember } = sequelize.models;
      return await AssociationMember.count({
        where: {
          associationId: this.id,
          status: "active",
        },
      });
    }

    // Calculer le montant total en caisse
    async getTotalBalance() {
      const { Transaction } = sequelize.models;
      const result = await Transaction.findOne({
        where: { associationId: this.id },
        attributes: [
          [sequelize.fn("SUM", sequelize.col("net_amount")), "total"],
        ],
        raw: true,
      });
      return parseFloat(result?.total || 0);
    }
  }

  Association.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },


      // 🏢 INFORMATIONS DE BASE
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          len: [3, 100],
        },
        comment: 'Nom de l\'association ex: "Diaspora Malienne Europe"',
      },

      slug: {
        type: DataTypes.STRING(255),
        allowNull: false,
        field: "slug",
        validate: {
          isLowercase: true,
          is: /^[a-z0-9-]+$/,
        },
        comment: 'URL-friendly: "diaspora-malienne-europe"',
      },

      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },

      // 🏛️ STATUT LEGAL
      legalStatus: {
        type: DataTypes.ENUM(
          "association_1901",
          "asbl",
          "nonprofit_501c3",
          "other"
        ),
        allowNull: false,
        defaultValue: "association_1901",
      },

      registrationNumber: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: "Numéro RNA/SIREN en France, etc.",
      },

      registrationDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },

      // 📍 DOMICILIATION
      domiciliationCountry: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "FR",
      },

      domiciliationCity: {
        type: DataTypes.STRING,
        allowNull: true,
      },

      headquartersAddress: {
        type: DataTypes.TEXT,
        allowNull: true,
      },

      // 💰 INFORMATIONS FINANCIERES
      primaryCurrency: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "EUR",
        validate: {
          isIn: [["EUR", "USD", "XOF", "GBP", "CAD"]],
        },
      },

      bankDetails: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: "RIB principal: {iban, bic, bankName, accountHolder}",
      },

      // 🔐 SYSTÈME RBAC DYNAMIQUE - RÔLES & PERMISSIONS
      rolesConfiguration: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {
          version: "1.0",
          roles: [],
          availablePermissions: [],
        },
        comment:
          "Configuration complète des rôles et permissions (RBAC dynamique)",
      },

      // ⚙️ CONFIGURATION FLEXIBLE
      memberTypes: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {}, // ← VIDE - Admin configure
        comment: "Types de membres 100% configurables par l'admin",
      },

      cotisationSettings: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {
          dueDay: 5,
          gracePeriodDays: 5,
          lateFeesEnabled: false,
          lateFeesAmount: 0,
          inactivityThresholdMonths: 3,
        },
      },

      // 📋 STATUTS & VALIDATION
      status: {
        type: DataTypes.ENUM(
          "pending_validation",
          "active",
          "suspended",
          "dissolved"
        ),
        allowNull: false,
        defaultValue: "pending_validation",
      },

      validatedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      validatedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: "ID admin platform qui a validé",
      },

      // 📄 DOCUMENTS LEGAUX
      documentsStatus: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {
          statuts: { uploaded: false, validated: false, expiresAt: null },
          receipisse: { uploaded: false, validated: false, expiresAt: null },
          rib: { uploaded: false, validated: false, expiresAt: null },
          pv_creation: { uploaded: false, validated: false, expiresAt: null },
        },
      },

      // 🌍 MULTI-SECTIONS
      isMultiSection: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: "true si association avec sections géographiques",
      },

      sectionsCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: "Nombre de sections (cache)",
      },

      // 📊 STATISTIQUES
      totalMembers: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },

      activeMembers: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
      },

      totalFundsRaised: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0.0,
      },

      totalAidsGiven: {
        type: DataTypes.DECIMAL(12, 2),
        defaultValue: 0.0,
      },

      // 🎨 PERSONNALISATION
      theme: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {
          primaryColor: "#2c5530",
          secondaryColor: "#4a7c59",
          logo: null,
        },
      },

      // 📱 CONTACT & COMMUNICATION
      contactInfo: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: "Email, téléphone, réseaux sociaux",
      },

      website: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
          isUrl: true,
        },
      },

      // ⚙️ CONFIGURATION AVANCEE
      subscriptionPlan: {
        type: DataTypes.ENUM("free", "standard", "premium", "enterprise"),
        allowNull: false,
        defaultValue: "standard",
      },

      subscriptionExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      features: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: {
          maxMembers: 500,
          maxSections: 3,
          customTypes: true,
          advancedReports: false,
          apiAccess: false,
        },
      },

      incomeTypes: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: {},
        field: "income_types",
        comment: "Types d'entrées d'argent configurables",
      },

      // 📈 BUSINESS METRICS
      monthlyRevenue: {
        type: DataTypes.DECIMAL(8, 2),
        defaultValue: 0.0,
        comment: "Revenue généré pour la plateforme (10€ + commissions)",
      },

      lastActivityAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "Association",
      tableName: "associations",
      underscored: true,
      timestamps: true,
      paranoid: true,

      hooks: {
        beforeCreate: async (association) => {
          // Générer slug automatiquement
          if (!association.slug) {
            association.slug = association.name
              .toLowerCase()
              .replace(/[^a-z0-9\s-]/g, "")
              .replace(/\s+/g, "-")
              .substring(0, 50);
          }

          // ✅ NOUVEAU : Initialiser rolesConfiguration avec permissions de base
          if (
            !association.rolesConfiguration ||
            !association.rolesConfiguration.availablePermissions ||
            association.rolesConfiguration.availablePermissions.length === 0
          ) {
            association.rolesConfiguration = {
              version: "1.0",
              roles: [], // Vide - admin créera les rôles
              availablePermissions: [
                // 📊 FINANCES
                {
                  id: "view_finances",
                  name: "Consulter les finances",
                  category: "finances",
                  description: "Voir soldes, transactions, rapports",
                },
                {
                  id: "validate_expenses",
                  name: "Valider les dépenses",
                  category: "finances",
                  description: "Approuver/rejeter demandes de dépenses",
                },
                {
                  id: "export_financial_data",
                  name: "Exporter données financières",
                  category: "finances",
                  description: "Télécharger rapports CSV, Excel",
                },
                {
                  id: "manage_transactions",
                  name: "Gérer les transactions",
                  category: "finances",
                  description: "Créer, modifier, annuler transactions",
                },
                {
                  id: "manage_cotisations",
                  name: "Gérer les cotisations",
                  category: "finances",
                  description: "Créer, modifier, importer cotisations",
                },
                {
                  id: "view_balance",
                  name: "Consulter les soldes",
                  category: "finances",
                  description: "Voir solde association et sections",
                },

                // 👥 MEMBRES
                {
                  id: "manage_members",
                  name: "Gérer les membres",
                  category: "membres",
                  description: "Ajouter, modifier, supprimer membres",
                },
                {
                  id: "view_members",
                  name: "Consulter les membres",
                  category: "membres",
                  description: "Voir liste et détails membres",
                },
                {
                  id: "assign_roles",
                  name: "Attribuer des rôles",
                  category: "membres",
                  description: "Changer les rôles des membres",
                },
                {
                  id: "manage_cotisations",
                  name: "Gérer les cotisations",
                  category: "membres",
                  description: "Modifier montants cotisations",
                },

                // 🏗️ SECTIONS
                {
                  id: "manage_sections",
                  name: "Gérer les sections",
                  category: "sections",
                  description: "Créer, modifier, supprimer sections",
                },
                {
                  id: "view_sections",
                  name: "Consulter les sections",
                  category: "sections",
                  description: "Voir détails des sections",
                },

                // 📢 COMMUNICATION
                {
                  id: "send_notifications",
                  name: "Envoyer des notifications",
                  category: "communication",
                  description: "SMS, emails aux membres",
                },
                {
                  id: "manage_announcements",
                  name: "Gérer les annonces",
                  category: "communication",
                  description: "Publier communications",
                },

                // 📄 DOCUMENTS
                {
                  id: "view_documents",
                  name: "Consulter les documents",
                  category: "documents",
                  description: "Accéder aux documents",
                },
                {
                  id: "upload_documents",
                  name: "Téléverser des documents",
                  category: "documents",
                  description: "Ajouter nouveaux documents",
                },
                {
                  id: "manage_documents",
                  name: "Gérer les documents",
                  category: "documents",
                  description: "Modifier, supprimer documents",
                },

                // 📅 ÉVÉNEMENTS
                {
                  id: "manage_events",
                  name: "Gérer les événements",
                  category: "evenements",
                  description: "Créer, modifier événements",
                },
                {
                  id: "view_events",
                  name: "Consulter les événements",
                  category: "evenements",
                  description: "Voir calendrier événements",
                },

                // ⚙️ ADMINISTRATION
                {
                  id: "modify_settings",
                  name: "Modifier les paramètres",
                  category: "administration",
                  description: "Changer configuration association",
                },
                {
                  id: "manage_roles",
                  name: "Gérer les rôles",
                  category: "administration",
                  description: "Créer, modifier, supprimer rôles",
                },
                {
                  id: "export_data",
                  name: "Exporter toutes les données",
                  category: "administration",
                  description: "Export complet sauvegarde",
                },
                {
                  id: "view_audit_logs",
                  name: "Consulter les logs",
                  category: "administration",
                  description: "Voir historique actions",
                },
              ],
            };
          }
        },

        afterCreate: (association) => {
          console.log(`🏛️ Nouvelle association créée: ${association.name}`);
        },

        beforeUpdate: (association) => {
          association.lastActivityAt = new Date();
        },
      },

      indexes: [
        {
          fields: ["slug"],
          unique: true,
          name: "associations_slug_unique",
        },
        { fields: ["status"] },
        { fields: ["domiciliation_country"] },
        { fields: ["is_multi_section"] },
        { fields: ["subscription_plan"] },
        { fields: ["created_at"] },
      ],
    }
  );

  return Association;
};
