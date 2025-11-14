//src/modules/associations/models/AssociationMember.js
"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class AssociationMember extends Model {
    static associate(models) {
      // Un membre appartient à un utilisateur
      AssociationMember.belongsTo(models.User, {
        foreignKey: "userId",
        as: "user",
      });

      // Un membre appartient à une association
      AssociationMember.belongsTo(models.Association, {
        foreignKey: "associationId",
        as: "association",
      });

      // Un membre peut appartenir à une section (optionnel)
      AssociationMember.belongsTo(models.Section, {
        foreignKey: "sectionId",
        as: "section",
      });

      // Un membre a plusieurs transactions (cotisations, aides)
      AssociationMember.hasMany(models.Transaction, {
        foreignKey: "memberId",
        as: "transactions",
      });
    }

    // ✅ NOUVEAU - Vérifier si a une permission spécifique
    hasPermission(permission) {
      // 1. Si admin, toutes permissions
      if (this.isAdmin) {
        return true;
      }

      // 2. Vérifier customPermissions granted
      if (this.customPermissions?.granted?.includes(permission)) {
        return true;
      }

      // 3. Vérifier customPermissions revoked
      if (this.customPermissions?.revoked?.includes(permission)) {
        return false;
      }

      // 4. Vérifier dans les rôles attribués
      if (!this.association?.rolesConfiguration) return false;

      const assignedRoles = this.assignedRoles || [];
      const rolesConfig = this.association.rolesConfiguration.roles || [];

      for (const roleId of assignedRoles) {
        const role = rolesConfig.find((r) => r.id === roleId);
        if (role?.permissions?.includes(permission)) {
          return true;
        }
      }

      return false;
    }

    // ✅ NOUVEAU - Récupérer toutes les permissions effectives
    getEffectivePermissions() {
      // Admin a toutes permissions
      if (this.isAdmin) {
        return (
          this.association?.rolesConfiguration?.availablePermissions?.map(
            (p) => p.id
          ) || []
        );
      }

      const permissions = new Set();

      // Permissions des rôles
      const assignedRoles = this.assignedRoles || [];
      const rolesConfig = this.association?.rolesConfiguration?.roles || [];

      for (const roleId of assignedRoles) {
        const role = rolesConfig.find((r) => r.id === roleId);
        if (role?.permissions) {
          role.permissions.forEach((p) => permissions.add(p));
        }
      }

      // Ajouter customPermissions granted
      (this.customPermissions?.granted || []).forEach((p) =>
        permissions.add(p)
      );

      // Retirer customPermissions revoked
      (this.customPermissions?.revoked || []).forEach((p) =>
        permissions.delete(p)
      );

      return Array.from(permissions);
    }

    // Calculer ancienneté totale (import + app)
    getTotalSeniority() {
      const imported = this.ancienneteImported || 0;
      const app = this.getAppSeniority();
      return imported + app;
    }

    // Calculer ancienneté dans l'app
    getAppSeniority() {
      if (!this.joinDate) return 0;
      const now = new Date();
      const join = new Date(this.joinDate);
      const diffTime = Math.abs(now - join);
      return Math.floor(diffTime / (1000 * 60 * 60 * 24 * 30));
    }

    // Vérifier si cotisation à jour ce mois
    async isCurrentMonthPaid() {
      const { Transaction } = sequelize.models;
      const startOfMonth = new Date(
        new Date().getFullYear(),
        new Date().getMonth(),
        1
      );
      const endOfMonth = new Date(
        new Date().getFullYear(),
        new Date().getMonth() + 1,
        0
      );

      const payment = await Transaction.findOne({
        where: {
          memberId: this.id,
          type: "cotisation",
          status: "completed",
          createdAt: {
            [sequelize.Sequelize.Op.between]: [startOfMonth, endOfMonth],
          },
        },
      });

      return !!payment;
    }

    // Calculer total cotisations versées
    async getTotalContributions() {
      const { Transaction } = sequelize.models;
      const result = await Transaction.findOne({
        where: {
          memberId: this.id,
          type: "cotisation",
          status: "completed",
        },
        attributes: [[sequelize.fn("SUM", sequelize.col("amount")), "total"]],
        raw: true,
      });
      return parseFloat(result?.total || 0);
    }

    // Calculer total aides reçues
    async getTotalAidsReceived() {
      const { Transaction } = sequelize.models;
      const result = await Transaction.findOne({
        where: {
          memberId: this.id,
          type: "aide",
          status: "completed",
        },
        attributes: [[sequelize.fn("SUM", sequelize.col("amount")), "total"]],
        raw: true,
      });
      return parseFloat(result?.total || 0);
    }

    // Vérifier éligibilité aide selon règles
    isEligibleForAid(aidAmount) {
      if (this.status !== "active") return false;

      const settings = this.association?.settings || {};
      const aidRules = settings.aidRules || {};

      // Vérifier ancienneté minimum
      if (
        aidRules.minSeniority &&
        this.getTotalSeniority() < aidRules.minSeniority
      ) {
        return false;
      }

      // Vérifier cotisations à jour
      if (aidRules.requireCurrentPayments && !this.isCurrentMonthPaid()) {
        return false;
      }

      return true;
    }
  }

  AssociationMember.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },

      // 🔗 RELATIONS PRINCIPALES
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
        comment: "Utilisateur membre",
      },

      associationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "associations",
          key: "id",
        },
        comment: "Association dont il est membre",
      },

      sectionId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "sections",
          key: "id",
        },
        comment: "Section géographique (optionnel)",
      },

      // 🔐 ADMIN ASSOCIATION (créateur)
      isAdmin: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment:
          "Admin de l'association (créateur qui peut gérer rôles et paramètres)",
      },

      isMemberOfAssociation: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment:
          "Si false, c'est un admin externe (gestionnaire) qui n'apparaît PAS dans les membres",
      },

      // 🎯 SYSTÈME RBAC - Rôles attribués
      assignedRoles: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
        comment:
          'IDs des rôles attribués (ex: ["president_role", "tresorier_role"])',
      },

      // 🔐 PERMISSIONS PERSONNALISÉES (override)
      customPermissions: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: { granted: [], revoked: [] },
        comment:
          "Permissions ajoutées/retirées en plus des rôles: {granted: [...], revoked: [...]}",
      },

      // 🏷️ TYPE & STATUT MEMBRE (CONFIGURABLE)
      memberType: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment:
          'Type membre configurable par association (ex: "actif", "fondateur", "ancien")',
      },

      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "pending",
        validate: {
          isIn: [["pending", "active", "suspended", "excluded", "inactive"]],
        },
        comment: "Statut actuel du membre",
      },

      // 📅 DATES IMPORTANTES
      joinDate: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment: "Date d'adhésion à l'association",
      },

      approvedDate: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "Date d'approbation par le bureau",
      },

      approvedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "users",
          key: "id",
        },
        comment: "Membre bureau qui a approuvé",
      },

      // ⏰ ANCIENNETÉ (DIFFÉRENCIATEUR CLÉ)
      ancienneteImported: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: "Ancienneté avant app (mois) - import historique",
      },

      // 💰 CONFIGURATION COTISATIONS
      cotisationAmount: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        comment: "Montant cotisation personnalisée (si différent du type)",
      },

      autoPaymentEnabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: "Prélèvement automatique activé",
      },

      paymentMethod: {
        type: DataTypes.STRING(20),
        allowNull: true,
        comment: "Méthode paiement préférée (card, iban)",
      },

      paymentMethodId: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "ID méthode paiement (Stripe/Square)",
      },

      // 📊 STATISTIQUES FINANCIÈRES
      totalContributed: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.0,
        comment: "Total cotisations versées (mis à jour automatiquement)",
      },

      totalAidsReceived: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.0,
        comment: "Total aides reçues (mis à jour automatiquement)",
      },

      lastContributionDate: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "Date dernière cotisation",
      },

      contributionStatus: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "uptodate",
        validate: {
          isIn: [["uptodate", "late", "very_late"]],
        },
        comment: "Statut cotisations",
      },

      // 📋 INFORMATIONS ADDITIONNELLES
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "Notes internes bureau association",
      },

      profession: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: "Profession ou domaine d'activité du membre",
      },
      emergencyContact: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: "Numéro de téléphone contact d'urgence",
      },

      socialProfileVisible: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
        comment: "Profil visible autres membres",
      },

      // 📱 PREFERENCES COMMUNICATION
      notificationPreferences: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: "Préférences notifications (SMS, email, push)",
      },

      // 🔄 HISTORIQUE TRANSFERTS
      transferHistory: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: "Historique transferts inter-sections",
      },

      // 📅 DATES AUDIT
      lastActiveDate: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: "Dernière activité dans association",
      },

      suspensionReason: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: "Raison suspension/exclusion",
      },
    },
    {
      sequelize,
      modelName: "AssociationMember",
      tableName: "association_members",
      underscored: true,
      timestamps: true,

      hooks: {
        afterCreate: async (member) => {
          // ✅ NOUVEAU : Si premier membre, le rendre admin automatiquement
          const { AssociationMember } = sequelize.models;
          const membersCount = await AssociationMember.count({
            where: { associationId: member.associationId },
          });

          if (membersCount === 1 && !member.isAdmin) {
            await member.update({
              isAdmin: true,
              customPermissions: {
                granted: ["manage_roles", "manage_association_settings"],
                revoked: [],
              },
            });
            console.log(
              `✅ Premier membre ${member.userId} défini comme admin de l'association ${member.associationId}`
            );
          }
        },
      },

      indexes: [
        {
          fields: ["user_id"],
        },
        {
          fields: ["association_id"],
        },
        {
          fields: ["section_id"],
        },
        {
          fields: ["status"],
        },
        {
          fields: ["member_type"],
        },
        {
          unique: true,
          fields: ["user_id", "association_id"],
          name: "unique_user_per_association",
        },
        {
          fields: ["contribution_status"],
        },
        {
          fields: ["is_admin"], // ← Nouvel index
        },
      ],
    }
  );

  return AssociationMember;
};
