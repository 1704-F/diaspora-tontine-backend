const {
  Association,
  Section,
  AssociationMember,
  User,
  Transaction,
} = require("../../../models");
const { Op } = require("sequelize");

class SectionController {
  // 🏗️ CRÉER SECTION
  async createSection(req, res) {
    try {
      const { associationId } = req.params;
      const {
        name,
        code,
        country,
        city,
        region,
        currency,
        language,
        timezone,
        contactPhone,
        contactEmail,
        cotisationRates,
        bureauSection,
      } = req.body;

      // Vérifier que l'association existe et que l'utilisateur a les droits
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
        include: [{ model: Association, as: "association" }],
      });

      const canCreateSection =
        membership &&
        (["admin_association", "central_board"].includes(
          membership.roles?.[0]
        ) ||
          req.user.role === "super_admin");

      if (!canCreateSection) {
        return res.status(403).json({
          error: "Seul l'admin ou le bureau central peut créer une section",
          code: "ADMIN_OR_CENTRAL_BOARD_ONLY",
        });
      }

      // Vérifier unicité nom section dans association
      const existingSection = await Section.findOne({
        where: {
          associationId,
          name,
        },
      });

      if (existingSection) {
        return res.status(400).json({
          error: "Une section avec ce nom existe déjà",
          code: "SECTION_NAME_EXISTS",
        });
      }

      // Créer la section
      const section = await Section.create({
        associationId,
        name,
        code,
        country,
        city,
        region,
        currency: currency || "EUR",
        language: language || "fr",
        timezone: timezone || "Europe/Paris",
        contactPhone,
        contactEmail,
        cotisationRates: cotisationRates || {},
        bureauSection: bureauSection || {},
        foundedDate: new Date(),
      });

      // Si bureau section fourni, créer les relations membres
      if (bureauSection && Object.keys(bureauSection).length > 0) {
        await this.assignBureauSection(section.id, bureauSection);
      }

      res.status(201).json({
        success: true,
        message: "Section créée avec succès",
        data: { section },
      });
    } catch (error) {
      console.error("Erreur création section:", error);
      res.status(500).json({
        error: "Erreur création section",
        code: "SECTION_CREATION_ERROR",
        details: error.message,
      });
    }
  }

  // 📋 LISTER SECTIONS D'UNE ASSOCIATION
  async listSections(req, res) {
    try {
      const { associationId } = req.params;
      const { includeMembers = false, includeStats = false } = req.query;

      // Vérifier accès association
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
      });

      if (!membership && req.user.role !== "super_admin") {
        return res.status(403).json({
          error: "Accès association non autorisé",
          code: "ASSOCIATION_ACCESS_DENIED",
        });
      }

      // Construire query selon permissions
      const includes = [];

      if (includeMembers === "true") {
        includes.push({
          model: AssociationMember,
          as: "members",
          include: [
            {
              model: User,
              as: "user",
              attributes: ["id", "fullName", "phoneNumber"],
            },
          ],
        });
      }

      const sections = await Section.findAll({
        where: { associationId },
        include: includes,
        order: [["created_at", "ASC"]],
      });

      // Ajouter statistiques si demandées
      let sectionsWithStats = sections;
      if (includeStats === "true") {
        sectionsWithStats = await Promise.all(
          sections.map(async (section) => {
            const [membersCount, monthlyRevenue] = await Promise.all([
              section.getActiveMembersCount(),
              section.getMonthlyContributions(),
            ]);

            return {
              ...section.toJSON(),
              stats: {
                membersCount,
                monthlyRevenue,
                bureauComplete: section.hasBureauComplete(),
              },
            };
          })
        );
      }

      res.json({
        success: true,
        data: { sections: sectionsWithStats },
      });
    } catch (error) {
      console.error("Erreur liste sections:", error);
      res.status(500).json({
        error: "Erreur récupération sections",
        code: "SECTIONS_FETCH_ERROR",
        details: error.message,
      });
    }
  }

  // 📝 MODIFIER SECTION
  async updateSection(req, res) {
    try {
      const { associationId, sectionId } = req.params;
      const updates = req.body;

      // Vérifier permissions (bureau central ou responsable section)
      const [centralMembership, sectionMembership] = await Promise.all([
        AssociationMember.findOne({
          where: {
            userId: req.user.id,
            associationId,
            status: "active",
          },
        }),
        AssociationMember.findOne({
          where: {
            userId: req.user.id,
            associationId,
            sectionId,
            status: "active",
          },
        }),
      ]);

      const canModify =
        (centralMembership &&
          ["president", "central_board"].includes(
            centralMembership.roles?.[0]
          )) ||
        (sectionMembership &&
          ["responsable_section", "secretaire_section"].includes(
            sectionMembership.roles?.[0]
          )) ||
        req.user.role === "super_admin";

      if (!canModify) {
        return res.status(403).json({
          error: "Permissions insuffisantes pour modifier la section",
          code: "INSUFFICIENT_SECTION_PERMISSIONS",
        });
      }

      // Vérifier que la section existe
      const section = await Section.findOne({
        where: { id: sectionId, associationId },
      });

      if (!section) {
        return res.status(404).json({
          error: "Section introuvable",
          code: "SECTION_NOT_FOUND",
        });
      }

      // Mise à jour
      await section.update(updates);

      res.json({
        success: true,
        message: "Section mise à jour avec succès",
        data: { section },
      });
    } catch (error) {
      console.error("Erreur modification section:", error);
      res.status(500).json({
        error: "Erreur modification section",
        code: "SECTION_UPDATE_ERROR",
        details: error.message,
      });
    }
  }

  // 👥 ASSIGNER BUREAU SECTION
  async updateBureauSection(req, res) {
    try {
      const { associationId, sectionId } = req.params;
      const { responsable, secretaire, tresorier } = req.body;

      // Vérifier permissions (président ou bureau central)
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
      });

      const canManageBureau =
        (membership &&
          ["president", "central_board"].includes(membership.roles?.[0])) ||
        req.user.role === "super_admin";

      if (!canManageBureau) {
        return res.status(403).json({
          error: "Seul le bureau central peut gérer le bureau section",
          code: "CENTRAL_BOARD_ONLY",
        });
      }

      // Vérifier que tous les utilisateurs sont membres de la section
      const bureauUserIds = [
        responsable?.userId,
        secretaire?.userId,
        tresorier?.userId,
      ].filter(Boolean);

      if (bureauUserIds.length > 0) {
        const validMembers = await AssociationMember.count({
          where: {
            userId: { [Op.in]: bureauUserIds },
            associationId,
            sectionId,
            status: "active",
          },
        });

        if (validMembers !== bureauUserIds.length) {
          return res.status(400).json({
            error: "Tous les membres bureau doivent appartenir à cette section",
            code: "INVALID_BUREAU_MEMBERS",
          });
        }
      }

      // Mettre à jour bureau section
      const newBureau = {
        responsable: responsable || null,
        secretaire: secretaire || null,
        tresorier: tresorier || null,
        updatedAt: new Date(),
        updatedBy: req.user.id,
      };

      await Section.update(
        { bureauSection: newBureau },
        { where: { id: sectionId, associationId } }
      );

      // Mettre à jour rôles des membres concernés
      await this.updateMemberRoles(associationId, sectionId, newBureau);

      res.json({
        success: true,
        message: "Bureau section mis à jour avec succès",
        data: { bureau: newBureau },
      });
    } catch (error) {
      console.error("Erreur mise à jour bureau section:", error);
      res.status(500).json({
        error: "Erreur mise à jour bureau section",
        code: "BUREAU_UPDATE_ERROR",
        details: error.message,
      });
    }
  }

  // 📊 STATISTIQUES SECTION
  async getSectionStats(req, res) {
    try {
      const { associationId, sectionId } = req.params;

      // Vérifier accès
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
      });

      if (!membership && req.user.role !== "super_admin") {
        return res.status(403).json({
          error: "Accès non autorisé",
          code: "ACCESS_DENIED",
        });
      }

      const section = await Section.findOne({
        where: { id: sectionId, associationId },
      });

      if (!section) {
        return res.status(404).json({
          error: "Section introuvable",
          code: "SECTION_NOT_FOUND",
        });
      }

      // Calculer statistiques détaillées
      const [
        totalMembers,
        activeMembers,
        monthlyRevenue,
        totalTransactions,
        averageCotisation,
      ] = await Promise.all([
        AssociationMember.count({ where: { sectionId } }),
        AssociationMember.count({ where: { sectionId, status: "active" } }),
        section.getMonthlyContributions(),
        Transaction.count({
          where: {
            sectionId,
            status: "completed",
          },
        }),
        Transaction.findOne({
          where: {
            sectionId,
            type: "cotisation",
            status: "completed",
          },
          attributes: [
            [sequelize.fn("AVG", sequelize.col("amount")), "average"],
          ],
          raw: true,
        }),
      ]);

      res.json({
        success: true,
        data: {
          section: {
            id: section.id,
            name: section.name,
            country: section.country,
            city: section.city,
          },
          stats: {
            members: {
              total: totalMembers,
              active: activeMembers,
              inactive: totalMembers - activeMembers,
            },
            finances: {
              monthlyRevenue,
              totalTransactions,
              averageCotisation: parseFloat(averageCotisation?.average || 0),
            },
            bureau: {
              isComplete: section.hasBureauComplete(),
              roles: section.bureauSection || {},
            },
          },
          lastUpdated: new Date(),
        },
      });
    } catch (error) {
      console.error("Erreur statistiques section:", error);
      res.status(500).json({
        error: "Erreur récupération statistiques section",
        code: "SECTION_STATS_ERROR",
        details: error.message,
      });
    }
  }

  // 🗑️ SUPPRIMER SECTION
  async deleteSection(req, res) {
    try {
      const { associationId, sectionId } = req.params;

      // Vérifier permissions (président uniquement)
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
      });

      const canDelete =
        (membership && membership.roles?.includes("president")) ||
        req.user.role === "super_admin";

      if (!canDelete) {
        return res.status(403).json({
          error: "Seul le président peut supprimer une section",
          code: "PRESIDENT_ONLY_DELETE",
        });
      }

      // Vérifier qu'il n'y a pas de membres actifs
      const activeMembers = await AssociationMember.count({
        where: {
          sectionId,
          status: "active",
        },
      });

      if (activeMembers > 0) {
        return res.status(400).json({
          error: "Impossible de supprimer: section contient des membres actifs",
          code: "SECTION_HAS_ACTIVE_MEMBERS",
          count: activeMembers,
        });
      }

      // Vérifier transactions en cours
      const pendingTransactions = await Transaction.count({
        where: {
          sectionId,
          status: ["pending", "processing"],
        },
      });

      if (pendingTransactions > 0) {
        return res.status(400).json({
          error: "Impossible de supprimer: transactions en cours",
          code: "PENDING_TRANSACTIONS",
          count: pendingTransactions,
        });
      }

      // Soft delete de la section
      await Section.update(
        { status: "inactive" },
        { where: { id: sectionId, associationId } }
      );

      res.json({
        success: true,
        message: "Section supprimée avec succès",
      });
    } catch (error) {
      console.error("Erreur suppression section:", error);
      res.status(500).json({
        error: "Erreur suppression section",
        code: "SECTION_DELETE_ERROR",
        details: error.message,
      });
    }
  }

  // 🔄 TRANSFÉRER MEMBRE ENTRE SECTIONS
  async transferMember(req, res) {
    try {
      const { associationId, sectionId } = req.params;
      const { memberId, targetSectionId, reason } = req.body;

      // Vérifier permissions
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
      });

      const canTransfer =
        membership &&
        (["president", "central_board", "responsable_section"].includes(
          membership.roles?.[0]
        ) ||
          req.user.role === "super_admin");

      if (!canTransfer) {
        return res.status(403).json({
          error: "Permissions insuffisantes pour transférer un membre",
          code: "INSUFFICIENT_TRANSFER_PERMISSIONS",
        });
      }

      // Vérifier que membre et sections existent
      const [member, sourceSection, targetSection] = await Promise.all([
        AssociationMember.findOne({
          where: { id: memberId, associationId, sectionId },
          include: [
            { model: User, as: "user", attributes: ["id", "fullName"] },
          ],
        }),
        Section.findByPk(sectionId),
        Section.findByPk(targetSectionId),
      ]);

      if (!member || !sourceSection || !targetSection) {
        return res.status(404).json({
          error: "Membre ou section introuvable",
          code: "TRANSFER_ENTITIES_NOT_FOUND",
        });
      }

      // Vérifier que target section appartient bien à la même association
      if (targetSection.associationId !== parseInt(associationId)) {
        return res.status(400).json({
          error: "Section destination doit appartenir à la même association",
          code: "INVALID_TARGET_SECTION",
        });
      }

      // Effectuer le transfert
      const transferData = {
        fromSection: {
          id: sourceSection.id,
          name: sourceSection.name,
          country: sourceSection.country,
        },
        toSection: {
          id: targetSection.id,
          name: targetSection.name,
          country: targetSection.country,
        },
        transferredAt: new Date(),
        transferredBy: req.user.id,
        reason: reason || "Transfert administratif",
      };

      // Mettre à jour membre
      await member.update({
        sectionId: targetSectionId,
        cotisationAmount:
          targetSection.cotisationRates?.[member.memberType] ||
          member.cotisationAmount,
        transferHistory: [...(member.transferHistory || []), transferData],
      });

      res.json({
        success: true,
        message: "Membre transféré avec succès",
        data: {
          member: await AssociationMember.findByPk(member.id, {
            include: [
              { model: User, as: "user", attributes: ["id", "fullName"] },
              {
                model: Section,
                as: "section",
                attributes: ["id", "name", "country"],
              },
            ],
          }),
          transfer: transferData,
        },
      });
    } catch (error) {
      console.error("Erreur transfert membre:", error);
      res.status(500).json({
        error: "Erreur transfert membre",
        code: "MEMBER_TRANSFER_ERROR",
        details: error.message,
      });
    }
  }

  // 🔧 UTILITAIRES PRIVÉES

  // Assigner membres aux rôles bureau section
  async assignBureauSection(sectionId, bureauSection) {
    try {
      const roles = ["responsable", "secretaire", "tresorier"];

      for (const role of roles) {
        const assignment = bureauSection[role];
        if (assignment && assignment.userId) {
          // Mettre à jour le membre avec le nouveau rôle
          await AssociationMember.update(
            {
              roles: [role + "_section"],
              lastActiveDate: new Date(),
            },
            {
              where: {
                userId: assignment.userId,
                sectionId,
              },
            }
          );
        }
      }
    } catch (error) {
      console.error("Erreur assignation bureau section:", error);
      throw error;
    }
  }

  // Mettre à jour rôles membres suite changement bureau
  async updateMemberRoles(associationId, sectionId, newBureau) {
    try {
      // Réinitialiser tous les rôles bureau de la section
      await AssociationMember.update(
        {
          roles: sequelize.fn(
            "array_remove",
            sequelize.fn(
              "array_remove",
              sequelize.fn(
                "array_remove",
                sequelize.col("roles"),
                "responsable_section"
              ),
              "secretaire_section"
            ),
            "tresorier_section"
          ),
        },
        { where: { associationId, sectionId } }
      );

      // Assigner nouveaux rôles
      const assignments = [
        { role: "responsable_section", userId: newBureau.responsable?.userId },
        { role: "secretaire_section", userId: newBureau.secretaire?.userId },
        { role: "tresorier_section", userId: newBureau.tresorier?.userId },
      ];

      for (const assignment of assignments) {
        if (assignment.userId) {
          await AssociationMember.update(
            {
              roles: sequelize.fn(
                "array_append",
                sequelize.col("roles"),
                assignment.role
              ),
            },
            {
              where: {
                userId: assignment.userId,
                associationId,
                sectionId,
              },
            }
          );
        }
      }
    } catch (error) {
      console.error("Erreur mise à jour rôles membres:", error);
      throw error;
    }
  }

  // 📊 RAPPORT COMPARATIF SECTIONS
  async getSectionsComparison(req, res) {
    try {
      const { associationId } = req.params;

      // Vérifier accès (bureau central uniquement)
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
      });

      const canView =
        (membership &&
          ["president", "central_board", "tresorier"].includes(
            membership.roles?.[0]
          )) ||
        req.user.role === "super_admin";

      if (!canView) {
        return res.status(403).json({
          error: "Accès réservé au bureau central",
          code: "CENTRAL_BOARD_ONLY",
        });
      }

      const sections = await Section.findAll({
        where: { associationId, status: "active" },
      });

      // Calculer stats comparatives
      const comparison = await Promise.all(
        sections.map(async (section) => {
          const [membersCount, monthlyRevenue, averageCotisation] =
            await Promise.all([
              section.getActiveMembersCount(),
              section.getMonthlyContributions(),
              Transaction.findOne({
                where: {
                  sectionId: section.id,
                  type: "cotisation",
                  status: "completed",
                },
                attributes: [
                  [sequelize.fn("AVG", sequelize.col("amount")), "average"],
                ],
                raw: true,
              }),
            ]);

          return {
            section: {
              id: section.id,
              name: section.name,
              country: section.country,
              city: section.city,
            },
            stats: {
              membersCount,
              monthlyRevenue,
              averageCotisation: parseFloat(averageCotisation?.average || 0),
              revenuePerMember:
                membersCount > 0 ? monthlyRevenue / membersCount : 0,
            },
          };
        })
      );

      // Calculer totaux
      const totals = comparison.reduce(
        (acc, item) => {
          acc.totalMembers += item.stats.membersCount;
          acc.totalRevenue += item.stats.monthlyRevenue;
          return acc;
        },
        { totalMembers: 0, totalRevenue: 0 }
      );

      res.json({
        success: true,
        data: {
          comparison,
          totals,
          generatedAt: new Date(),
        },
      });
    } catch (error) {
      console.error("Erreur rapport sections:", error);
      res.status(500).json({
        error: "Erreur génération rapport sections",
        code: "SECTIONS_REPORT_ERROR",
        details: error.message,
      });
    }
  }
}

module.exports = new SectionController();
