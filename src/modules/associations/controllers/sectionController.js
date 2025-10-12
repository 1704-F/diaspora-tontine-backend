//src\modules\associations\controllers\sectionController.js
const {
  Association,
  Section,
  AssociationMember,
  User,
  Transaction
} = require("../../../models");
const { Op } = require("sequelize");

// ✅ NOUVEAU : Import système RBAC moderne
const { hasPermission, getEffectivePermissions } = require('../../../core/middleware/checkPermission');

// Ajouter cette fonction AVANT la classe SectionController
async function updateMemberRoles(associationId, sectionId, newBureau) {
  try {
    console.log('Mise à jour des rôles membres...');
    
    const members = await AssociationMember.findAll({
      where: { associationId, sectionId }
    });

    console.log(`Trouvé ${members.length} membres à mettre à jour`);

    // Réinitialiser tous les rôles bureau de la section
    for (const member of members) {
      let roles = member.roles || [];
      
      const oldRolesCount = roles.length;
      roles = roles.filter(role => 
        !['responsable_section', 'secretaire_section', 'tresorier_section'].includes(role)
      );
      
      if (oldRolesCount !== roles.length) {
        console.log(`Suppression rôles section pour membre ${member.userId}`);
        await member.update({ roles });
      }
    }

    // Assigner nouveaux rôles
    const assignments = [
      { role: "responsable_section", userId: newBureau.responsable?.userId },
      { role: "secretaire_section", userId: newBureau.secretaire?.userId },
      { role: "tresorier_section", userId: newBureau.tresorier?.userId },
    ];

    for (const assignment of assignments) {
      if (assignment.userId) {
        console.log(`Assignation rôle ${assignment.role} à user ${assignment.userId}`);
        
        const member = await AssociationMember.findOne({
          where: { userId: assignment.userId, associationId, sectionId }
        });
        
        if (member) {
          const roles = [...(member.roles || [])];
          if (!roles.includes(assignment.role)) {
            roles.push(assignment.role);
            await member.update({ roles });
            console.log(`Rôle ${assignment.role} assigné avec succès`);
          }
        } else {
          console.warn(`Membre ${assignment.userId} non trouvé dans la section ${sectionId}`);
        }
      }
    }

    console.log('Mise à jour des rôles terminée avec succès');
  } catch (error) {
    console.error("Erreur mise à jour rôles membres:", error);
    throw error;
  }
}

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

      // Vérifier que l'association existe et permissions
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
        include: [
          { 
            model: Association, 
            as: "association",
            attributes: ['rolesConfiguration']
          }
        ],
      });

      // ✅ NOUVEAU : Vérifier permissions avec RBAC moderne
      const canCreateSection =
        membership?.isAdmin ||
        hasPermission(membership, "manage_sections") ||
        req.user.role === "super_admin";

      if (!canCreateSection) {
        return res.status(403).json({
          error: "Permissions insuffisantes pour créer une section",
          code: "INSUFFICIENT_PERMISSIONS",
          required: "manage_sections",
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
          include: [
            {
              model: Association,
              as: "association",
              attributes: ['rolesConfiguration']
            }
          ]
        }),
        AssociationMember.findOne({
          where: {
            userId: req.user.id,
            associationId,
            sectionId,
            status: "active",
          },
          include: [
            {
              model: Association,
              as: "association",
              attributes: ['rolesConfiguration']
            }
          ]
        }),
      ]);

      // ✅ NOUVEAU : Vérifier permissions avec RBAC moderne
      const canModify =
        centralMembership?.isAdmin ||
        hasPermission(centralMembership, "manage_sections") ||
        hasPermission(sectionMembership, "manage_section") ||
        req.user.role === "super_admin";

      if (!canModify) {
        return res.status(403).json({
          error: "Permissions insuffisantes pour modifier la section",
          code: "INSUFFICIENT_SECTION_PERMISSIONS",
          required: "manage_sections",
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
      const { bureauSection } = req.body;

      console.log('Données reçues:', { bureauSection });

      // Vérifier permissions
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
        include: [
          {
            model: Association,
            as: "association",
            attributes: ['rolesConfiguration']
          }
        ]
      });

      // ✅ NOUVEAU : Vérifier permissions avec RBAC moderne
      const canManageBureau =
        membership?.isAdmin ||
        hasPermission(membership, "manage_sections") ||
        req.user.role === "super_admin";

      if (!canManageBureau) {
        return res.status(403).json({
          error: "Permissions insuffisantes pour gérer le bureau section",
          code: "INSUFFICIENT_PERMISSIONS",
          required: "manage_sections",
        });
      }

      // Récupérer la section
      const section = await Section.findOne({
        where: { id: sectionId, associationId }
      });

      if (!section) {
        return res.status(404).json({
          error: "Section introuvable",
          code: "SECTION_NOT_FOUND",
        });
      }

      // Mettre à jour le bureau section
      await section.update({
        bureauSection: {
          ...bureauSection,
          updatedAt: new Date(),
          updatedBy: req.user.id
        }
      });

      // Récupérer la section mise à jour
      const updatedSection = await Section.findByPk(sectionId);

      res.json({
        success: true,
        message: "Bureau section mis à jour avec succès",
        data: { 
          bureau: updatedSection.bureauSection 
        },
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

      // Vérifier permissions
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
        include: [
          {
            model: Association,
            as: "association",
            attributes: ['rolesConfiguration']
          }
        ]
      });

      // ✅ NOUVEAU : Vérifier permissions avec RBAC moderne
      const canDelete =
        membership?.isAdmin ||
        hasPermission(membership, "manage_sections") ||
        req.user.role === "super_admin";

      if (!canDelete) {
        return res.status(403).json({
          error: "Permissions insuffisantes pour supprimer une section",
          code: "INSUFFICIENT_PERMISSIONS",
          required: "manage_sections",
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
        include: [
          {
            model: Association,
            as: "association",
            attributes: ['rolesConfiguration']
          }
        ]
      });

      // ✅ NOUVEAU : Vérifier permissions avec RBAC moderne
      const canTransfer =
        membership?.isAdmin ||
        hasPermission(membership, "manage_members") ||
        req.user.role === "super_admin";

      if (!canTransfer) {
        return res.status(403).json({
          error: "Permissions insuffisantes pour transférer un membre",
          code: "INSUFFICIENT_TRANSFER_PERMISSIONS",
          required: "manage_members",
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
  async assignBureauSection(sectionId, bureauSection) {
    try {
      const roles = ["responsable", "secretaire", "tresorier"];

      for (const role of roles) {
        const assignment = bureauSection[role];
        if (assignment && assignment.userId) {
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

  // 📊 RAPPORT COMPARATIF SECTIONS
  async getSectionsComparison(req, res) {
    try {
      const { associationId } = req.params;

      // Vérifier accès (bureau central)
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
        include: [
          {
            model: Association,
            as: "association",
            attributes: ['rolesConfiguration']
          }
        ]
      });

      // ✅ NOUVEAU : Vérifier permissions avec RBAC moderne
      const canView =
        membership?.isAdmin ||
        hasPermission(membership, "view_finances") ||
        req.user.role === "super_admin";

      if (!canView) {
        return res.status(403).json({
          error: "Permissions insuffisantes pour voir les rapports",
          code: "INSUFFICIENT_PERMISSIONS",
          required: "view_finances",
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

  async getSectionDetails(req, res) {
    try {
      const { associationId, sectionId } = req.params;

      // Vérifier accès association
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: 'active'
        }
      });

      if (!membership && req.user.role !== 'super_admin') {
        return res.status(403).json({
          error: 'Accès association non autorisé',
          code: 'ASSOCIATION_ACCESS_DENIED'
        });
      }

      // Récupérer la section avec statistiques
      const section = await Section.findOne({
        where: { 
          id: sectionId,
          associationId 
        },
        include: [
          {
            model: Association,
            as: 'association',
            attributes: ['id', 'name', 'isMultiSection']
          }
        ]
      });

      if (!section) {
        return res.status(404).json({
          error: 'Section introuvable',
          code: 'SECTION_NOT_FOUND'
        });
      }

      // Calculer statistiques section
      const [membersCount, activeMembers, pendingMembers] = await Promise.all([
        AssociationMember.count({
          where: { 
            associationId,
            sectionId: section.id 
          }
        }),
        AssociationMember.count({
          where: { 
            associationId,
            sectionId: section.id,
            status: 'active'
          }
        }),
        AssociationMember.count({
          where: { 
            associationId,
            sectionId: section.id,
            status: 'pending'
          }
        })
      ]);

      // Calculer revenus mensuels (estimation)
      const association = await Association.findByPk(associationId);
      const memberTypes = association?.memberTypes || {};
      
      let monthlyRevenue = 0;
      if (Object.keys(memberTypes).length > 0) {
        const averageCotisation = Object.values(memberTypes)
          .reduce((sum, type) => sum + (type.monthlyAmount || 0), 0) / Object.keys(memberTypes).length;
        monthlyRevenue = Math.round(activeMembers * averageCotisation);
      }

      // Vérifier si bureau complet
      const bureau = section.bureauSection || {};
      const bureauComplete = !!(bureau.responsable?.name && bureau.secretaire?.name && bureau.tresorier?.name);

      // Mettre à jour le count si différent
      if (section.membersCount !== membersCount) {
        await section.update({ membersCount });
      }

      const sectionWithStats = {
        ...section.toJSON(),
        membersCount,
        stats: {
          activeMembers,
          pendingMembers,
          monthlyRevenue,
          bureauComplete
        }
      };

      res.json({
        success: true,
        data: {
          section: sectionWithStats
        }
      });

    } catch (error) {
      console.error('Erreur récupération section:', error);
      res.status(500).json({
        error: 'Erreur récupération section',
        code: 'SECTION_FETCH_ERROR',
        details: error.message
      });
    }
  }
}

module.exports = new SectionController();