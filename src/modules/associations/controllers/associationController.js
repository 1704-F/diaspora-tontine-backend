//src/modules/association/controllers/associationController.js
const {
  Association,
  AssociationMember,
  Section,
  User,
  Transaction,
} = require("../../../models");
const { Op } = require("sequelize");

// ✅ NOUVEAU : Import système RBAC moderne
const {
  hasPermission,
  getEffectivePermissions,
} = require("../../../core/middleware/checkPermission");
const {
  availablePermissions,
} = require("../../../config/association/defaultPermissions");
// ❌ SUPPRIMÉ : Anciennes fonctions legacy (lignes 14-61)
// Ces fonctions utilisaient l'ancien système membership.roles
// Maintenant on utilise directement hasPermission() du middleware

class AssociationController {
  // 📋 OBTENIR DÉTAILS ASSOCIATION - VERSION CORRIGÉE
  async createAssociation(req, res) {
  try {
    const {
      name,
      description,
      legalStatus,
      domiciliationCountry,
      domiciliationCity,
      registrationNumber,
      primaryCurrency,
      memberTypes,
      settings, // ✅ Déjà déstructuré
    } = req.body;

    // ✅ AJOUTER CE LOG
    console.log('📦 Données reçues:', {
      name,
      primaryCurrency,
      settings
    });

    // Vérifier que l'utilisateur n'a pas déjà trop d'associations
    const userAssociations = await AssociationMember.count({
      where: {
        userId: req.user.id,
        status: "active",
      },
    });

    const maxAssociations = req.user.role === "super_admin" ? 100 : 5;
    if (userAssociations >= maxAssociations) {
      return res.status(400).json({
        error: "Limite d'associations atteinte",
        code: "MAX_ASSOCIATIONS_REACHED",
        current: userAssociations,
        max: maxAssociations,
      });
    }

    const defaultMemberTypes = memberTypes || [];

    // Générer slug unique à partir du nom
    const generateSlug = (name) => {
      return name
        .toLowerCase()
        .replace(/[àáäâ]/g, "a")
        .replace(/[èéëê]/g, "e")
        .replace(/[ìíïî]/g, "i")
        .replace(/[òóöô]/g, "o")
        .replace(/[ùúüû]/g, "u")
        .replace(/[ç]/g, "c")
        .replace(/[^a-z0-9 -]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .trim("-");
    };

    let slug = generateSlug(name);

    // Vérifier unicité du slug
    let slugExists = await Association.findOne({ where: { slug } });
    let counter = 1;
    while (slugExists) {
      slug = `${generateSlug(name)}-${counter}`;
      slugExists = await Association.findOne({ where: { slug } });
      counter++;
    }

    // ✅ Créer l'association avec RBAC moderne
    const association = await Association.create({
      name,
      slug,
      description,
      legalStatus,
      domiciliationCountry,
      domiciliationCity, 
      registrationNumber,
      primaryCurrency: primaryCurrency || 'EUR',
      memberTypes: defaultMemberTypes,
      customRoles: [],
      settings: settings || {},
      founderId: req.user.id,
      status: "pending_validation",
      
      // ✅ AJOUTER CETTE LIGNE
      isMultiSection: settings?.isMultiSection || false,

      // Initialiser rolesConfiguration
      rolesConfiguration: {
        version: "1.0",
        roles: [],
        availablePermissions: availablePermissions,
      },
    });

     // ✅ AJOUTER CE LOG
    console.log('✅ Association créée:', {
      id: association.id,
      primaryCurrency: association.primaryCurrency,
      isMultiSection: association.isMultiSection
    });

    // Créer membership admin
  // Si l'admin est INTERNE (membre), le frontend mettra à jour ce membership
const adminMembership = await AssociationMember.create({
  userId: req.user.id,
  associationId: association.id,
  memberType: null, // Sera renseigné si admin interne
  isAdmin: true,
  status: "active",
  assignedRoles: [], // Sera renseigné si admin interne
  customPermissions: { granted: [], revoked: [] },
  isMemberOfAssociation: false, // ✅ Par défaut EXTERNE (gestionnaire uniquement)
  cotisationAmount: 0, // Pas de cotisation pour admin externe
});

console.log(`✅ Membership admin créé (ID: ${adminMembership.id}) - Gestionnaire externe par défaut`);

    // Charger association complète
    const associationComplete = await Association.findByPk(association.id, {
      include: [
        {
          model: AssociationMember,
          as: "memberships",
          include: [
            {
              model: User,
              as: "user",
              attributes: ["id", "firstName", "lastName", "phoneNumber"],
            },
          ],
        },
        {
          model: Section,
          as: "sections",
        },
      ],
    });

    res.status(201).json({
      success: true,
      message: "Association créée avec succès",
      data: {
        association: associationComplete,
        nextSteps: [
          "Télécharger documents KYB",
          "Créer des rôles dans /settings/roles",
          "Configurer types membres avec rôles par défaut",
          "Inviter premiers membres",
        ],
      },
    });
  } catch (error) {
    console.error("Erreur création association:", error);
    res.status(500).json({
      error: "Erreur création association",
      code: "ASSOCIATION_CREATION_ERROR",
      details: error.message,
    });
  }
}

  // 📝 MODIFIER ASSOCIATION
  async updateAssociation(req, res) {
    try {
      const { id } = req.params;
      const { customRoles, isMultiSection } = req.body;

      const updates = {};

      // ============================================
      // GESTION CUSTOM ROLES (Rôles organisationnels)
      // ============================================
      if (customRoles) {
        if (!Array.isArray(customRoles)) {
          return res.status(400).json({
            error: "customRoles doit être un tableau",
            code: "INVALID_CUSTOM_ROLES_FORMAT",
          });
        }

        const processedRoles = [];

        for (const role of customRoles) {
          // Validation des champs obligatoires
          if (!role.id || !role.name || !role.description) {
            return res.status(400).json({
              error: "Chaque rôle doit avoir: id, name, description",
              code: "INVALID_CUSTOM_ROLE",
            });
          }

          // Si un membre est assigné, vérifier qu'il existe
          if (role.assignedTo) {
            // Vérifier si c'est un objet avec firstName/lastName/phoneNumber (nouveau membre)
            if (
              role.assignedTo.firstName &&
              role.assignedTo.lastName &&
              role.assignedTo.phoneNumber
            ) {
              // Formater le numéro de téléphone
              let formattedPhone = role.assignedTo.phoneNumber;
              if (!formattedPhone.startsWith("+")) {
                formattedPhone = "+" + formattedPhone.replace(/^0+/, "");
              }

              // Chercher utilisateur existant
              let user = await User.findOne({
                where: { phoneNumber: formattedPhone },
              });

              // Si pas trouvé, créer le compte
              if (!user) {
                user = await User.create({
                  firstName: role.assignedTo.firstName,
                  lastName: role.assignedTo.lastName,
                  phoneNumber: formattedPhone,
                  status: "pending_verification",
                });

                console.log(
                  `✅ Compte créé pour ${role.assignedTo.firstName} ${role.assignedTo.lastName} (${formattedPhone})`
                );

                // Créer membership si pas encore membre
                const existingMember = await AssociationMember.findOne({
                  where: {
                    userId: user.id,
                    associationId: id,
                  },
                });

                if (!existingMember) {
                  await AssociationMember.create({
                    userId: user.id,
                    associationId: id,
                    memberType: null, // Sera défini plus tard
                    status: "pending",
                    isAdmin: false,
                    assignedRoles: [],
                    customPermissions: { granted: [], revoked: [] },
                    joinDate: new Date(),
                  });

                  console.log(`✅ Membership créé pour userId ${user.id}`);
                }
              }

              // Ajouter le rôle avec l'userId
              processedRoles.push({
                id: role.id,
                name: role.name,
                description: role.description,
                assignedTo: user.id,
                assignedAt: new Date(),
              });
            } else if (typeof role.assignedTo === "number") {
              // C'est déjà un userId, vérifier qu'il existe
              const memberExists = await AssociationMember.findOne({
                where: {
                  userId: role.assignedTo,
                  associationId: id,
                  status: "active",
                },
              });

              if (!memberExists) {
                return res.status(400).json({
                  error: `Le membre (userId: ${role.assignedTo}) n'existe pas ou n'est pas actif`,
                  code: "MEMBER_NOT_FOUND",
                  role: role.name,
                });
              }

              processedRoles.push({
                id: role.id,
                name: role.name,
                description: role.description,
                assignedTo: role.assignedTo,
                assignedAt: role.assignedAt || new Date(),
              });
            } else {
              return res.status(400).json({
                error: `assignedTo invalide pour le rôle "${role.name}"`,
                code: "INVALID_ASSIGNED_TO",
                hint: "Doit être un userId (number) ou un objet {firstName, lastName, phoneNumber}",
              });
            }
          } else {
            // Rôle non assigné
            processedRoles.push({
              id: role.id,
              name: role.name,
              description: role.description,
              assignedTo: null,
            });
          }
        }

        updates.customRoles = processedRoles;
        console.log(
          "✅ Rôles organisationnels traités:",
          processedRoles.map(
            (r) =>
              `${r.name} ${
                r.assignedTo ? `(userId: ${r.assignedTo})` : "(libre)"
              }`
          )
        );
      }

      // ============================================
      // GESTION TYPE D'ASSOCIATION
      // ============================================
      if (typeof isMultiSection === "boolean") {
        updates.isMultiSection = isMultiSection;
      }

      // ============================================
      // SAUVEGARDE
      // ============================================
      if (Object.keys(updates).length > 0) {
        await Association.update(updates, { where: { id } });
        console.log(`✅ Association ${id} mise à jour:`, Object.keys(updates));
      }

      res.json({
        success: true,
        message: "Association mise à jour avec succès",
        updated: Object.keys(updates),
      });
    } catch (error) {
      console.error("❌ Erreur mise à jour association:", error);
      res.status(500).json({
        error: "Erreur mise à jour association",
        code: "ASSOCIATION_UPDATE_ERROR",
        details: error.message,
      });
    }
  }

  // 📋 LISTER ASSOCIATIONS DE L'UTILISATEUR
  async listUserAssociations(req, res) {
    try {
      const { page = 1, limit = 20, status = "active" } = req.query;
      const offset = (page - 1) * limit;

      // Récupérer associations de l'utilisateur
      const { rows: memberships, count } =
        await AssociationMember.findAndCountAll({
          where: {
            userId: req.user.id,
            ...(status !== "all" && { status }),
          },
          include: [
            {
              model: Association,
              as: "association",
              include: [{ model: Section, as: "sections" }],
            },
            {
              model: Section,
              as: "section",
            },
          ],
          limit: parseInt(limit),
          offset: parseInt(offset),
          order: [["created_at", "DESC"]],
        });

      // Formater réponse avec stats
      const associations = memberships.map((membership) => {
        const assoc = membership.association;
        return {
          id: assoc.id,
          name: assoc.name,
          description: assoc.description,
          country: assoc.country,
          status: assoc.status,
          sectionsCount: assoc.sections?.length || 0,
          membersCount: assoc.membersCount || 0,
          userMembership: {
            memberType: membership.memberType,
            // ✅ NOUVEAU : Retourner RBAC moderne
            isAdmin: membership.isAdmin,
            assignedRoles: membership.assignedRoles || [],
            status: membership.status,
            seniority: membership.getTotalSeniority(),
            section: membership.section,
          },
          createdAt: assoc.createdAt,
        };
      });

      res.json({
        success: true,
        data: {
          associations,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: count,
            pages: Math.ceil(count / limit),
          },
        },
      });
    } catch (error) {
      console.error("Erreur liste associations:", error);
      res.status(500).json({
        error: "Erreur récupération associations",
        code: "ASSOCIATIONS_FETCH_ERROR",
        details: error.message,
      });
    }
  }

  // 🗑️ SUPPRIMER ASSOCIATION (soft delete)
  async deleteAssociation(req, res) {
    try {
      const { id } = req.params;

      // Charger membership avec association pour RBAC
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId: id,
          status: "active",
        },
        include: [
          {
            model: Association,
            as: "association",
            attributes: ["rolesConfiguration"],
          },
        ],
      });

      // ✅ NOUVEAU : Vérifier avec isAdmin au lieu de rôle hardcodé
      const canDelete = membership?.isAdmin || req.user.role === "super_admin";

      if (!canDelete) {
        return res.status(403).json({
          error: "Seul l'administrateur peut supprimer l'association",
          code: "ADMIN_ONLY_DELETE",
        });
      }

      // Vérifier s'il y a des transactions en cours
      const pendingTransactions = await Transaction.count({
        where: {
          associationId: id,
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

      // Soft delete
      await Association.update({ status: "deleted" }, { where: { id } });

      // Désactiver tous les membres
      await AssociationMember.update(
        { status: "inactive" },
        { where: { associationId: id } }
      );

      res.json({
        success: true,
        message: "Association supprimée avec succès",
      });
    } catch (error) {
      console.error("Erreur suppression association:", error);
      res.status(500).json({
        error: "Erreur suppression association",
        code: "ASSOCIATION_DELETE_ERROR",
        details: error.message,
      });
    }
  }

  // 📊 STATISTIQUES ASSOCIATION
  async getAssociationStats(req, res) {
    try {
      const { id } = req.params;

      // Vérifier accès
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId: id,
          status: "active",
        },
      });

      if (!membership && req.user.role !== "super_admin") {
        return res.status(403).json({
          error: "Accès non autorisé",
          code: "ACCESS_DENIED",
        });
      }

      // Calculer statistiques
      const [
        totalMembers,
        activeMembers,
        monthlyRevenue,
        totalTransactions,
        sectionsCount,
      ] = await Promise.all([
        AssociationMember.count({ where: { associationId: id } }),
        AssociationMember.count({
          where: { associationId: id, status: "active" },
        }),
        Transaction.sum("amount", {
          where: {
            associationId: id,
            type: "cotisation",
            status: "completed",
            createdAt: {
              [Op.gte]: new Date(
                new Date().getFullYear(),
                new Date().getMonth(),
                1
              ),
            },
          },
        }),
        Transaction.count({
          where: {
            associationId: id,
            status: "completed",
          },
        }),
        Section.count({ where: { associationId: id } }),
      ]);

      res.json({
        success: true,
        data: {
          members: {
            total: totalMembers,
            active: activeMembers,
            inactive: totalMembers - activeMembers,
          },
          finances: {
            monthlyRevenue: parseFloat(monthlyRevenue || 0),
            totalTransactions,
          },
          structure: {
            sectionsCount,
            type: sectionsCount > 0 ? "multi-sections" : "simple",
          },
          lastUpdated: new Date(),
        },
      });
    } catch (error) {
      console.error("Erreur statistiques association:", error);
      res.status(500).json({
        error: "Erreur récupération statistiques",
        code: "STATS_FETCH_ERROR",
        details: error.message,
      });
    }
  }

  // 🔍 RECHERCHER ASSOCIATIONS PUBLIQUES
  async searchPublicAssociations(req, res) {
    try {
      const { q, country, city, page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      const whereClause = {
        status: "active",
        isPublic: true,
      };

      if (q) {
        whereClause[Op.or] = [
          { name: { [Op.iLike]: `%${q}%` } },
          { description: { [Op.iLike]: `%${q}%` } },
        ];
      }

      if (country) whereClause.country = country;
      if (city) whereClause.city = { [Op.iLike]: `%${city}%` };

      const { rows: associations, count } = await Association.findAndCountAll({
        where: whereClause,
        attributes: [
          "id",
          "name",
          "description",
          "country",
          "city",
          "membersCount",
          "createdAt",
        ],
        include: [
          {
            model: Section,
            as: "sections",
            attributes: ["id", "name", "country", "city"],
          },
        ],
        limit: parseInt(limit),
        offset: parseInt(offset),
        order: [
          ["membersCount", "DESC"],
          ["createdAt", "DESC"],
        ],
      });

      res.json({
        success: true,
        data: {
          associations,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: count,
            pages: Math.ceil(count / limit),
          },
        },
      });
    } catch (error) {
      console.error("Erreur recherche associations:", error);
      res.status(500).json({
        error: "Erreur recherche associations",
        code: "SEARCH_ERROR",
        details: error.message,
      });
    }
  }

  // 🔄 Mettre à jour cotisations suite changement types membres
  async updateMemberCotisations(associationId, newMemberTypes) {
    try {
      const members = await AssociationMember.findAll({
        where: { associationId, status: "active" },
      });

      for (const member of members) {
        const memberTypeConfig = newMemberTypes.find(
          (type) => type.name === member.memberType
        );

        if (memberTypeConfig) {
          await member.update({
            cotisationAmount: memberTypeConfig.cotisationAmount,
          });
        }
      }
    } catch (error) {
      console.error("Erreur mise à jour cotisations membres:", error);
      throw error;
    }
  }

  // 📁 UPLOAD DOCUMENT KYB
  async uploadDocument(req, res) {
    try {
      const { id: associationId } = req.params;
      const { type } = req.body;
      const file = req.file;

      if (!file) {
        return res.status(400).json({
          error: "Aucun fichier fourni",
          code: "NO_FILE_PROVIDED",
        });
      }

      // Vérifier que l'association existe
      const association = await Association.findByPk(associationId);
      if (!association) {
        return res.status(404).json({
          error: "Association introuvable",
          code: "ASSOCIATION_NOT_FOUND",
        });
      }

      // Mapping des types frontend vers types backend
      const documentTypeMapping = {
        statuts: "association_statuts",
        receipisse: "association_receipt",
        rib: "iban_proof",
        pv_creation: "meeting_minutes",
      };

      const mappedType = documentTypeMapping[type] || type;

      // TODO: Upload vers Cloudinary ou S3
      // Pour l'instant, stockage temporaire local
      const fileUrl = `uploads/documents/${file.filename}`;

      // Créer document en DB
      const { Document } = require("../../../models");
      const document = await Document.create({
        userId: req.user.id,
        associationId: associationId,
        type: mappedType,
        title: `Document ${type}`,
        fileName: file.originalname,
        fileUrl: fileUrl,
        fileSize: file.size,
        mimeType: file.mimetype,
        status: "pending",
        uploadedFrom: "web",
      });

      // Mettre à jour le documents_status de l'association
      const currentDocumentsStatus = { ...association.documentsStatus };

      console.log("Type document:", type);
      console.log("Documents status avant:", association.documentsStatus);

      // Utiliser la clé frontend (statuts, receipisse, rib, pv_creation)
      currentDocumentsStatus[type] = {
        uploaded: true,
        validated: false,
        expiresAt: null,
      };

      console.log("Documents status après:", currentDocumentsStatus);

      // Force Sequelize à détecter le changement avec 'changed'
      association.documentsStatus = currentDocumentsStatus;
      association.changed("documentsStatus", true);

      await association.save();

      // DEBUG: Vérifier si l'update a marché
      const updatedAssoc = await Association.findByPk(associationId);
      console.log(
        "documents_status après update:",
        updatedAssoc.documentsStatus
      );

      console.log(`Document ${type} uploadé et association mise à jour`);

      res.json({
        success: true,
        message: "Document uploadé avec succès",
        data: {
          document: {
            id: document.id,
            type: document.type,
            fileName: document.fileName,
            status: document.status,
          },
        },
      });
    } catch (error) {
      console.error("Erreur upload document:", error);
      res.status(500).json({
        error: "Erreur upload document",
        code: "DOCUMENT_UPLOAD_ERROR",
        details: error.message,
      });
    }
  }


  // 📋 OBTENIR DÉTAILS ASSOCIATION - VERSION RBAC COMPLÈTE
async getAssociation(req, res) {
  try {
    const { id } = req.params;
    const { includeMembers = false, includeFinances = false } = req.query;

    // ✅ Charger membership avec champs RBAC explicites
    const membership = await AssociationMember.findOne({
      where: {
        userId: req.user.id,
        associationId: id,
        status: "active",
      },
      attributes: [
        'id',
        'userId',
        'associationId',
        'sectionId',
        'isAdmin',
        'assignedRoles',        // ✅ JSONB - explicite
        'customPermissions',    // ✅ JSONB - explicite
        'memberType',
        'status',
        'joinDate',
        'approvedDate',
        'approvedBy',
        'cotisationAmount',
        'autoPaymentEnabled',
        'paymentMethod',
        'paymentMethodId',
        'totalContributed',
        'totalAidsReceived',
        'lastContributionDate',
        'contributionStatus',
        'created_at',
        'updated_at'
      ],
      include: [
        {
          model: Association,
          as: "association",
          attributes: ['rolesConfiguration']
        }
      ]
    });

    // Vérifier accès
    if (!membership && req.user.role !== "super_admin") {
      return res.status(403).json({
        error: "Accès association non autorisé",
        code: "ASSOCIATION_ACCESS_DENIED",
      });
    }

    // ============================================
    // CONSTRUIRE INCLUDES SELON PERMISSIONS
    // ============================================
    const includes = [
      {
        model: Section,
        as: "sections",
        attributes: ["id", "name", "country", "city", "membersCount"],
      },
    ];

    // Inclure membres si demandé et autorisé
    if (includeMembers === "true") {
      const canViewMembers = membership?.isAdmin || 
                             hasPermission(membership, "view_member_list") ||
                             req.user.role === "super_admin";
                             
      if (canViewMembers) {
        includes.push({
          model: AssociationMember,
          as: "memberships",
          where: { status: 'active' },
          required: false,
          include: [
            {
              model: User,
              as: "user",
              attributes: [
                "id",
                "firstName",
                "lastName",
                "phoneNumber",
                "profilePicture",
              ],
            },
          ],
        });
      }
    }

    // ============================================
    // CHARGER ASSOCIATION
    // ============================================
    const association = await Association.findByPk(id, { include: includes });

    if (!association) {
      return res.status(404).json({
        error: "Association introuvable",
        code: "ASSOCIATION_NOT_FOUND",
      });
    }

    // Convertir en objet JSON
    const response = association.toJSON();

    // ============================================
    // MASQUER INFOS SENSIBLES SELON PERMISSIONS
    // ============================================
    const canViewFinances = membership?.isAdmin ||
                           hasPermission(membership, "view_finances") ||
                           req.user.role === "super_admin";

    if (!canViewFinances) {
      delete response.totalBalance;
      delete response.monthlyRevenue;
      delete response.iban;
    }

    // ============================================
    // FORMATER USER MEMBERSHIP
    // ============================================
    const userMembership = membership ? {
      id: membership.id,
      userId: membership.userId,
      associationId: membership.associationId,
      sectionId: membership.sectionId,
      isAdmin: membership.isAdmin,
      assignedRoles: membership.assignedRoles || [],           // ✅ Garantir tableau
      customPermissions: membership.customPermissions || {      // ✅ Garantir objet
        granted: [],
        revoked: []
      },
      memberType: membership.memberType,
      status: membership.status,
      joinDate: membership.joinDate,
      approvedDate: membership.approvedDate,
      approvedBy: membership.approvedBy,
      cotisationAmount: membership.cotisationAmount,
      autoPaymentEnabled: membership.autoPaymentEnabled,
      paymentMethod: membership.paymentMethod,
      paymentMethodId: membership.paymentMethodId,
      totalContributed: membership.totalContributed,
      totalAidsReceived: membership.totalAidsReceived,
      lastContributionDate: membership.lastContributionDate,
      contributionStatus: membership.contributionStatus,
      created_at: membership.created_at,
      updated_at: membership.updated_at,
      // ✅ Inclure association pour RBAC
      association: membership.association ? {
        rolesConfiguration: membership.association.rolesConfiguration
      } : undefined
    } : null;

    // ============================================
    // CALCULER PERMISSIONS EFFECTIVES
    // ============================================
    const effectivePermissions = membership ? 
      getEffectivePermissions(membership) : 
      [];

    console.log('✅ getAssociation - userMembership:', {
      userId: userMembership?.userId,
      isAdmin: userMembership?.isAdmin,
      assignedRoles: userMembership?.assignedRoles,
      effectivePermissionsCount: effectivePermissions.length
    });

    // ============================================
    // RÉPONSE
    // ============================================
    res.json({
      success: true,
      data: {
        association: response,
        userMembership: userMembership,
        userPermissions: effectivePermissions,
      },
    });
  } catch (error) {
    console.error("❌ Erreur récupération association:", error);
    res.status(500).json({
      error: "Erreur récupération association",
      code: "ASSOCIATION_FETCH_ERROR",
      details: error.message,
    });
  }
}

  // 📄 LISTER DOCUMENTS ASSOCIATION
  async getDocuments(req, res) {
    try {
      const { id: associationId } = req.params;

      const { Document } = require("../../../models");
      const documents = await Document.findAll({
        where: {
          associationId: associationId,
        },
        attributes: ["id", "type", "title", "fileName", "status", "created_at"],
        order: [["created_at", "DESC"]],
      });

      res.json({
        success: true,
        data: { documents },
      });
    } catch (error) {
      console.error("Erreur récupération documents:", error);
      res.status(500).json({
        error: "Erreur récupération documents",
        code: "DOCUMENTS_FETCH_ERROR",
      });
    }
  }



  // 📄 TÉLÉCHARGER DOCUMENT SPÉCIFIQUE
  async downloadDocument(req, res) {
    try {
      const { id: associationId, documentId } = req.params;

      const { Document } = require("../../../models");
      const document = await Document.findOne({
        where: {
          id: documentId,
          associationId: associationId,
        },
      });

      if (!document) {
        return res.status(404).json({
          error: "Document introuvable",
          code: "DOCUMENT_NOT_FOUND",
        });
      }

      // Vérifier que le document est téléchargeable
      if (!document.isDownloadable()) {
        return res.status(403).json({
          error: "Document non accessible",
          code: "DOCUMENT_NOT_ACCESSIBLE",
          status: document.status,
        });
      }

      // Mettre à jour compteur d'accès
      await document.update({
        accessCount: document.accessCount + 1,
        lastAccessedAt: new Date(),
      });

      // TODO: Pour l'instant, redirection vers l'URL du fichier
      // Dans une version production, il faudrait :
      // 1. Vérifier les permissions détaillées
      // 2. Générer une URL signée temporaire
      // 3. Servir le fichier via un proxy sécurisé

      res.json({
        success: true,
        data: {
          downloadUrl: document.fileUrl,
          fileName: document.fileName,
          fileSize: document.fileSize,
          mimeType: document.mimeType,
          viewUrl: `${document.fileUrl}?type=application/pdf`,
        },
      });
    } catch (error) {
      console.error("Erreur téléchargement document:", error);
      res.status(500).json({
        error: "Erreur téléchargement document",
        code: "DOCUMENT_DOWNLOAD_ERROR",
        details: error.message,
      });
    }
  }

  // 🗑️ SUPPRIMER DOCUMENT
  async deleteDocument(req, res) {
    try {
      const { id: associationId, documentId } = req.params;

      const { Document } = require("../../../models");
      const document = await Document.findOne({
        where: {
          id: documentId,
          associationId: associationId,
        },
      });

      if (!document) {
        return res.status(404).json({
          error: "Document introuvable",
          code: "DOCUMENT_NOT_FOUND",
        });
      }

      // TODO: Supprimer le fichier physique du stockage (Cloudinary/S3)

      await document.destroy();

      res.json({
        success: true,
        message: "Document supprimé avec succès",
      });
    } catch (error) {
      console.error("Erreur suppression document:", error);
      res.status(500).json({
        error: "Erreur suppression document",
        code: "DOCUMENT_DELETE_ERROR",
        details: error.message,
      });
    }
  }

  async updateConfiguration(req, res) {
  try {
    const { id: associationId } = req.params;
    const { memberTypes, customRoles, accessRights, cotisationSettings } =
      req.body;

    console.log("🔧 Mise à jour configuration association:", {
      associationId,
      memberTypes: memberTypes?.length || 0,
      customRoles: customRoles?.length || 0,
      accessRights: Object.keys(accessRights || {}).length,
      cotisationSettings: Object.keys(cotisationSettings || {}).length,
    });

    // Récupérer l'association
    const association = await Association.findByPk(associationId);
    if (!association) {
      return res.status(404).json({
        error: "Association introuvable",
        code: "ASSOCIATION_NOT_FOUND",
      });
    }

    // Charger membership avec association pour RBAC
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
          attributes: ["rolesConfiguration"],
        },
      ],
    });

    // ✅ Vérifier permissions RBAC
    const canUpdate =
      req.user.role === "super_admin" ||
      membership?.isAdmin ||
      hasPermission(membership, "modify_settings");

    if (!canUpdate) {
      return res.status(403).json({
        error: "Permissions insuffisantes pour modifier la configuration",
        code: "INSUFFICIENT_PERMISSIONS",
      });
    }

    // Préparer les données de mise à jour
    const updateData = {};

    // ============================================
    // GESTION MEMBER TYPES
    // ============================================
    if (memberTypes !== undefined) {
      if (!Array.isArray(memberTypes)) {
        return res.status(400).json({
          error: "memberTypes doit être un tableau",
          code: "INVALID_MEMBER_TYPES_FORMAT",
        });
      }

      // Validation de chaque type
      for (const type of memberTypes) {
        // Champs obligatoires
        if (
          !type.name ||
          !type.description ||
          typeof type.cotisationAmount !== "number"
        ) {
          return res.status(400).json({
            error:
              "Chaque type doit avoir: name, description, cotisationAmount",
            code: "INVALID_MEMBER_TYPE",
          });
        }

        // ✅ NOUVEAU : defaultRole n'est PLUS obligatoire
        // Les rôles sont maintenant assignés au membre, pas au type
        
        // Validation montant cotisation
        if (type.cotisationAmount < 0) {
          return res.status(400).json({
            error: `Le montant de cotisation doit être positif pour le type "${type.name}"`,
            code: "INVALID_COTISATION_AMOUNT",
            type: type.name,
          });
        }

        console.log(`✅ Type "${type.name}" validé: ${type.cotisationAmount}€/mois`);
      }

      updateData.memberTypes = memberTypes;
      console.log(
        "✅ Types membres validés:",
        memberTypes.map((t) => `${t.name} (${t.cotisationAmount}€)`)
      );
    }

    // ============================================
    // GESTION CUSTOM ROLES (Rôles organisationnels)
    // ============================================
    if (customRoles !== undefined) {
      if (!Array.isArray(customRoles)) {
        return res.status(400).json({
          error: "customRoles doit être un tableau",
          code: "INVALID_CUSTOM_ROLES_FORMAT",
        });
      }

      // Validation de chaque rôle organisationnel
      for (const role of customRoles) {
        if (!role.id || !role.name || !role.description) {
          return res.status(400).json({
            error: "Chaque rôle doit avoir: id, name, description",
            code: "INVALID_CUSTOM_ROLE",
          });
        }

        // Vérifier assignedTo
        if (role.assignedTo !== null && role.assignedTo !== undefined) {
          if (typeof role.assignedTo !== "number") {
            return res.status(400).json({
              error: `assignedTo doit être un userId (number) ou null pour le rôle "${role.name}"`,
              code: "INVALID_ASSIGNED_TO",
              role: role.name,
            });
          }

          // Vérifier que le membre existe
          const memberExists = await AssociationMember.findOne({
            where: {
              userId: role.assignedTo,
              associationId,
              status: "active",
            },
          });

          if (!memberExists) {
            return res.status(400).json({
              error: `Le membre (userId: ${role.assignedTo}) n'existe pas ou n'est pas actif`,
              code: "MEMBER_NOT_FOUND",
              role: role.name,
              userId: role.assignedTo,
            });
          }
        }
      }

      updateData.customRoles = customRoles;
      console.log(
        "✅ Rôles organisationnels mis à jour:",
        customRoles.map(
          (r) =>
            `${r.name} ${
              r.assignedTo ? `(assigné à ${r.assignedTo})` : "(libre)"
            }`
        )
      );
    }

    // ============================================
    // GESTION ACCESS RIGHTS
    // ============================================
    if (accessRights !== undefined) {
      if (typeof accessRights !== "object") {
        return res.status(400).json({
          error: "accessRights doit être un objet",
          code: "INVALID_ACCESS_RIGHTS_FORMAT",
        });
      }

      const currentRights = association.accessRights || {};
      const mergedRights = { ...currentRights, ...accessRights };

      updateData.accessRights = mergedRights;
      console.log("✅ Droits d'accès mis à jour:", Object.keys(mergedRights));
    }

    // ============================================
    // GESTION COTISATION SETTINGS
    // ============================================
    if (cotisationSettings !== undefined) {
      if (typeof cotisationSettings !== "object") {
        return res.status(400).json({
          error: "cotisationSettings doit être un objet",
          code: "INVALID_COTISATION_SETTINGS_FORMAT",
        });
      }

      const currentSettings = association.cotisationSettings || {};
      const mergedSettings = { ...currentSettings, ...cotisationSettings };

      updateData.cotisationSettings = mergedSettings;
      console.log(
        "✅ Paramètres cotisations mis à jour:",
        Object.keys(mergedSettings)
      );
    }

    // ============================================
    // SAUVEGARDE
    // ============================================
    console.log("💾 Données complètes à sauvegarder:", updateData);

    // Mettre à jour l'association
    await association.update(updateData);
    console.log(
      `🏛️ Configuration association ${associationId} mise à jour par utilisateur ${req.user.id}`
    );

    // ============================================
    // VÉRIFICATION POST-UPDATE
    // ============================================
    const verificationAssoc = await Association.findByPk(associationId);

    console.log(
      "🔍 Vérification - Types membres sauvegardés:",
      verificationAssoc.memberTypes?.map(
        (t) => `${t.name} (${t.cotisationAmount}€)`
      )
    );
    console.log(
      "🔍 Vérification - Rôles organisationnels:",
      verificationAssoc.customRoles?.map(
        (r) => `${r.name} ${r.assignedTo ? "(assigné)" : "(libre)"}`
      )
    );

    // ============================================
    // RÉPONSE
    // ============================================
    res.json({
      success: true,
      message: "Configuration mise à jour avec succès",
      data: {
        association: {
          id: verificationAssoc.id,
          name: verificationAssoc.name,
          memberTypes: verificationAssoc.memberTypes,
          customRoles: verificationAssoc.customRoles,
          accessRights: verificationAssoc.accessRights,
          cotisationSettings: verificationAssoc.cotisationSettings,
          rolesConfiguration: verificationAssoc.rolesConfiguration,
          updatedAt: verificationAssoc.updatedAt,
        },
      },
    });
  } catch (error) {
    console.error("❌ Erreur mise à jour configuration:", error);
    res.status(500).json({
      error: "Erreur serveur lors de la mise à jour de la configuration",
      code: "CONFIGURATION_UPDATE_ERROR",
      details: error.message,
    });
  }
}


}

module.exports = new AssociationController();