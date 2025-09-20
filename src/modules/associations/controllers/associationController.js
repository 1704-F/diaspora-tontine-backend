//src/modules/association/controllers/associationController.js
const {
  Association,
  AssociationMember,
  Section,
  User,
  Transaction,
} = require("../../../models");
const { Op } = require("sequelize");

// Fonction utilitaire pour vérifier permissions (flexible par association)
function checkPermission(membership, action) {
  if (!membership || !membership.association) return false;

  const permissions = membership.association.permissionsMatrix || {};
  const actionConfig = permissions[action];

  if (!actionConfig) return false;

  const userRoles = membership.roles || [];
  const allowedRoles = actionConfig.allowed_roles || [];

  return userRoles.some((role) => allowedRoles.includes(role));
}

// Fonction utilitaire pour calculer permissions utilisateur
async function getUserPermissions(userId, associationId) {
  try {
    const membership = await AssociationMember.findOne({
      where: { userId, associationId, status: "active" },
      include: [{ model: Association, as: "association" }],
    });

    if (!membership) return {};

    const permissionsMatrix = membership.association.permissionsMatrix || {};
    const userRoles = membership.roles || [];
    const userPermissions = {};

    // Calculer permissions effectives
    Object.keys(permissionsMatrix).forEach((action) => {
      const config = permissionsMatrix[action];
      const allowedRoles = config.allowed_roles || [];
      userPermissions[action] = userRoles.some((role) =>
        allowedRoles.includes(role)
      );
    });

    return userPermissions;
  } catch (error) {
    console.error("Erreur calcul permissions:", error);
    return {};
  }
}

class AssociationController {
  // 🏛️ CRÉER ASSOCIATION (avec KYB)
  async createAssociation(req, res) {
    try {
      const {
        name,
        description,
        legalStatus,
        country,
        city,
        registrationNumber,
        memberTypes,
        bureauCentral,
        permissionsMatrix,
        settings,
      } = req.body;

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

      // Configuration par défaut des types membres si non fournie
      const defaultMemberTypes = memberTypes || [
        {
          name: "membre_simple",
          cotisationAmount: 10.0,
          permissions: ["view_profile", "participate_events"],
          description: "Membre standard",
        },
        {
          name: "membre_actif",
          cotisationAmount: 15.0,
          permissions: ["view_profile", "participate_events", "vote"],
          description: "Membre avec droit de vote",
        },
      ];

      // Configuration bureau par défaut
      const defaultBureau = bureauCentral || {
        president: {
          userId: req.user.id,
          name:
            req.user.firstName && req.user.lastName
              ? `${req.user.firstName} ${req.user.lastName}`.trim()
              : req.user.firstName || "Utilisateur",
        },
        secretaire: { userId: null, name: null },
        tresorier: { userId: null, name: null },
      };

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

      // Créer l'association
      const association = await Association.create({
        name,
        slug,
        description,
        legalStatus,
        country,
        city,
        registrationNumber,
        memberTypes: defaultMemberTypes,
        bureauCentral: defaultBureau,
        permissionsMatrix: permissionsMatrix || {},
        settings: settings || {},
        founderId: req.user.id,
        status: "pending_validation", // En attente validation KYB
      });

      // Ajouter le créateur comme membre fondateur
      await AssociationMember.create({
        userId: req.user.id,
        associationId: association.id,
        memberType: "membre_actif", // ✅ Utilise un type existant dans defaultMemberTypes
        status: "active",
        // 🎯 FIX: Donner les rôles de président ET admin
        roles: [
          "admin_association", // ✅ Rôle technique (accès à tout)
        ],
        joinDate: new Date(),
        approvedDate: new Date(),
        approvedBy: req.user.id,
      });

      // Charger association complète pour retour
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
            "Compléter bureau association",
            "Configurer types membres",
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

  // 📋 OBTENIR DÉTAILS ASSOCIATION
  async getAssociation(req, res) {
    try {
      const { id } = req.params;
      const { includeMembers = false, includeFinances = false } = req.query;

      // Vérifier accès à l'association
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId: id,
          status: "active",
        },
      });

      if (!membership && req.user.role !== "super_admin") {
        return res.status(403).json({
          error: "Accès association non autorisé",
          code: "ASSOCIATION_ACCESS_DENIED",
        });
      }

      // Construire includes selon permissions
      const includes = [
        {
          model: Section,
          as: "sections",
          attributes: ["id", "name", "country", "city", "membersCount"],
        },
      ];

      // ✅ CORRECTION : Utiliser le bon alias 'memberships' au lieu de 'members'
      if (includeMembers === "true") {
        const canViewMembers = checkPermission(membership, "view_member_list");
        if (canViewMembers || req.user.role === "super_admin") {
          includes.push({
            model: AssociationMember,
            as: "memberships", // ✅ Changé de 'members' à 'memberships'
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

      const association = await Association.findByPk(id, { include: includes });

      if (!association) {
        return res.status(404).json({
          error: "Association introuvable",
          code: "ASSOCIATION_NOT_FOUND",
        });
      }

      // Masquer informations sensibles selon permissions
      const response = association.toJSON();

      if (
        !checkPermission(membership, "view_finances") &&
        req.user.role !== "super_admin"
      ) {
        delete response.totalBalance;
        delete response.monthlyRevenue;
        delete response.iban;
      }

      res.json({
        success: true,
        data: {
          association: response,
          userMembership: membership,
          userPermissions: await getUserPermissions(req.user.id, id),
        },
      });
    } catch (error) {
      console.error("Erreur récupération association:", error);
      res.status(500).json({
        error: "Erreur récupération association",
        code: "ASSOCIATION_FETCH_ERROR",
        details: error.message,
      });
    }
  }

  // 📝 MODIFIER ASSOCIATION
  async updateAssociation(req, res) {
    try {
      const { id } = req.params;
      const { bureauCentral, isMultiSection } = req.body;

      const updates = {};

      // Traiter le bureau central si fourni
      if (bureauCentral) {
        const processedBureau = {};

        for (const [role, roleData] of Object.entries(bureauCentral)) {
          if (roleData.firstName && roleData.lastName && roleData.phoneNumber) {
            // Formater le numéro de téléphone
            let formattedPhone = roleData.phoneNumber;
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
                firstName: roleData.firstName,
                lastName: roleData.lastName,
                phoneNumber: formattedPhone,
                status: "pending_verification",
              });

              console.log(
                `Compte créé pour ${roleData.firstName} ${roleData.lastName} (${formattedPhone})`
              );
            }

            // Ajouter au bureau avec la structure attendue
            processedBureau[role] = {
              userId: user.id,
              name: `${user.firstName} ${user.lastName}`,
              role: roleData.role,
            };
          }
        }

        updates.bureauCentral = processedBureau;
      }

      // Traiter le type d'association si fourni
      if (typeof isMultiSection === "boolean") {
        updates.isMultiSection = isMultiSection;
      }

      // Mettre à jour l'association
      if (Object.keys(updates).length > 0) {
        await Association.update(updates, { where: { id } });
      }

      res.json({
        success: true,
        message: "Association mise à jour avec succès",
        updated: Object.keys(updates),
      });
    } catch (error) {
      console.error("Erreur mise à jour association:", error);
      res.status(500).json({
        error: "Erreur mise à jour association",
        details: error.message,
      });
    }
  }

  // Fonction utilitaire pour formater les numéros
  formatPhoneNumber(phone) {
    // Nettoyer le numéro (supprimer espaces, tirets, etc.)
    const cleaned = phone.replace(/[\s\-\(\)]/g, "");

    // Si commence par 0, remplacer selon contexte européen
    if (cleaned.startsWith("0")) {
      // Logique à adapter selon le pays de la section
      return "+33" + cleaned.substring(1); // Exemple France
    }

    // Si déjà au format international
    if (cleaned.startsWith("+")) {
      return cleaned;
    }

    return "+" + cleaned;
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
            roles: membership.roles,
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

      // Seul le président ou super admin peut supprimer
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId: id,
          status: "active",
        },
      });

      const canDelete =
        (membership && membership.roles?.includes("president")) ||
        req.user.role === "super_admin";

      if (!canDelete) {
        return res.status(403).json({
          error: "Seul le président peut supprimer l'association",
          code: "PRESIDENT_ONLY_DELETE",
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
          // ✅ Sans path.basename
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

  // 🔧 SETUP ASSOCIATION (traite firstName/lastName/phoneNumber)
  async updateAssociationSetup(req, res) {
    try {
      const { id } = req.params;
      const { bureauCentral, isMultiSection, firstSection } = req.body;

      console.log("🔍 Données reçues:", {
        bureauCentral,
        isMultiSection,
        firstSection,
      });

      // Récupérer l'association
      const association = await Association.findByPk(id);
      if (!association) {
        return res.status(404).json({
          error: "Association introuvable",
          code: "ASSOCIATION_NOT_FOUND",
        });
      }

      const updates = {};

      // ✅ FIX: Traiter le bureau central avec le bon mapping de champ
      if (bureauCentral) {
        const processedBureau = {};

        for (const [role, roleData] of Object.entries(bureauCentral)) {
          if (
            roleData &&
            roleData.firstName &&
            roleData.lastName &&
            roleData.phoneNumber
          ) {
            // Créer un utilisateur temporaire ou rechercher existant
            const { User } = require("../../../models");

            // Chercher utilisateur existant par téléphone
            let user = await User.findOne({
              where: { phoneNumber: roleData.phoneNumber },
            });

            if (!user) {
              // Créer utilisateur temporaire pour le bureau
              user = await User.create({
                phoneNumber: roleData.phoneNumber,
                firstName: roleData.firstName,
                lastName: roleData.lastName,
                status: "pending_verification",
              });
            }

            // Structurer le bureau avec la structure attendue
            processedBureau[role] = {
              userId: user.id,
              name: `${user.firstName} ${user.lastName}`,
              role: roleData.role,
              phoneNumber: user.phoneNumber,
              assignedAt: new Date(),
            };
          }
        }

        // ✅ FIX CRITIQUE: Utiliser 'centralBoard' au lieu de 'bureauCentral'
        // Car le champ en base s'appelle 'central_board'
        updates.centralBoard = processedBureau;
        console.log("📝 Bureau à sauvegarder:", processedBureau);
      }

      // Traiter le type d'association
      if (typeof isMultiSection === "boolean") {
        updates.isMultiSection = isMultiSection;
      }

      // Traiter la première section si fournie
      if (firstSection && isMultiSection) {
        const { Section } = require("../../../models");
        await Section.create({
          associationId: id,
          name: firstSection.name,
          country: firstSection.country,
          city: firstSection.city,
          currency: firstSection.currency,
          language: firstSection.language,
        });
      }

      console.log("🔄 Updates à appliquer:", updates);

      // Mettre à jour l'association
      if (Object.keys(updates).length > 0) {
        const [updatedRows] = await Association.update(updates, {
          where: { id },
          returning: true,
        });

        console.log("✅ Lignes mises à jour:", updatedRows);
      }

      // Vérification post-update
      const updatedAssociation = await Association.findByPk(id);
      console.log("🔍 Association après update:", {
        id: updatedAssociation.id,
        centralBoard: updatedAssociation.centralBoard,
        isMultiSection: updatedAssociation.isMultiSection,
      });

      res.json({
        success: true,
        message: "Setup association terminé avec succès",
        updated: Object.keys(updates),
        debug: {
          updatedFields: Object.keys(updates),
          centralBoard: updatedAssociation.centralBoard,
        },
      });
    } catch (error) {
      console.error("❌ Erreur setup association:", error);
      res.status(500).json({
        error: "Erreur setup association",
        details: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  }

  async updateConfiguration(req, res) {
    try {
      const { id: associationId } = req.params;
      const {
        memberTypes,
        centralBoard,
        accessRights,
        cotisationSettings,
        permissionsMatrix,
      } = req.body;

      console.log("🔧 Mise à jour configuration association:", {
        associationId,
        memberTypes: memberTypes?.length || 0,
        centralBoard: Object.keys(centralBoard || {}).length,
        accessRights: Object.keys(accessRights || {}).length,
        cotisationSettings: Object.keys(cotisationSettings || {}).length,
        permissionsMatrix: Object.keys(permissionsMatrix || {}).length,
      });

      // Récupérer l'association
      const association = await Association.findByPk(associationId);
      if (!association) {
        return res.status(404).json({
          error: "Association introuvable",
          code: "ASSOCIATION_NOT_FOUND",
        });
      }

      // Vérifier permissions
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
      });

      const canUpdate =
        req.user.role === "super_admin" ||
        (membership &&
          (membership.roles?.includes("admin_association") ||
            membership.roles?.includes("president") ||
            membership.roles?.includes("secretaire") ||
            membership.roles?.includes("tresorier")));

      if (!canUpdate) {
        return res.status(403).json({
          error: "Permissions insuffisantes pour modifier la configuration",
          code: "INSUFFICIENT_PERMISSIONS",
        });
      }

      // Préparer les données de mise à jour
      const updateData = {};

      // GESTION MEMBER TYPES
      if (memberTypes !== undefined) {
        if (!Array.isArray(memberTypes)) {
          return res.status(400).json({
            error: "memberTypes doit être un tableau",
            code: "INVALID_MEMBER_TYPES_FORMAT",
          });
        }

        for (const type of memberTypes) {
          if (
            !type.name ||
            !type.description ||
            typeof type.cotisationAmount !== "number"
          ) {
            return res.status(400).json({
              error:
                "Chaque type de membre doit avoir un nom, une description et un montant de cotisation",
              code: "INVALID_MEMBER_TYPE",
            });
          }
        }

        updateData.memberTypes = memberTypes;
        console.log(
          "✅ Types membres mis à jour:",
          memberTypes.map((t) => t.name)
        );
      }

      // GESTION CENTRAL BOARD
      if (centralBoard !== undefined) {
        if (typeof centralBoard !== "object") {
          return res.status(400).json({
            error: "centralBoard doit être un objet",
            code: "INVALID_CENTRAL_BOARD_FORMAT",
          });
        }

        const currentBoard = association.centralBoard || {};
        console.log("🔍 Bureau actuel en DB:", currentBoard);
        console.log("📥 Bureau reçu du frontend:", centralBoard);

        updateData.centralBoard = centralBoard;

        console.log("💾 Bureau qui sera sauvegardé:", centralBoard);
        console.log("✅ Bureau central mis à jour:", Object.keys(centralBoard));
      }

      // GESTION ACCESS RIGHTS
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
      // GESTION PERMISSIONS MATRIX
      if (permissionsMatrix !== undefined) {
        if (typeof permissionsMatrix !== "object") {
          return res.status(400).json({
            error: "permissionsMatrix doit être un objet",
            code: "INVALID_PERMISSIONS_MATRIX_FORMAT",
          });
        }

        // Validation des permissions
        const validActions = [
          "view_finances",
          "manage_members",
          "approve_aids",
          "view_member_list",
          "export_data",
          "manage_events",
        ];

        const validRoles = [
          "admin_association",
          "president",
          "secretaire",
          "tresorier",
          "responsable_section",
          "secretaire_section",
          "tresorier_section",
        ];

        for (const [action, config] of Object.entries(permissionsMatrix)) {
          if (!validActions.includes(action)) {
            return res.status(400).json({
              error: `Action permission inconnue: ${action}`,
              code: "INVALID_PERMISSION_ACTION",
            });
          }

          if (!config.allowed_roles || !Array.isArray(config.allowed_roles)) {
            return res.status(400).json({
              error: `${action}.allowed_roles doit être un tableau`,
              code: "INVALID_PERMISSION_ROLES",
            });
          }

          for (const role of config.allowed_roles) {
            if (!validRoles.includes(role)) {
              return res.status(400).json({
                error: `Rôle inconnu: ${role}`,
                code: "INVALID_ROLE",
              });
            }
          }
        }

        // S'assurer que admin_association est toujours inclus dans toutes les permissions
        Object.keys(permissionsMatrix).forEach((action) => {
          const config = permissionsMatrix[action];
          if (
            config.allowed_roles &&
            !config.allowed_roles.includes("admin_association")
          ) {
            config.allowed_roles.unshift("admin_association"); // Ajouter en premier
          }
        });

        updateData.permissionsMatrix = permissionsMatrix;
        console.log(
          "✅ Matrice de permissions mise à jour (admin protégé):",
          Object.keys(permissionsMatrix)
        );
      }

      // GESTION COTISATION SETTINGS
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

      // DEBUG : Log avant sauvegarde
      console.log("💾 Données complètes à sauvegarder:", updateData);

      // Mettre à jour l'association
      await association.update(updateData);
      console.log(
        `🏛️ Configuration association ${associationId} mise à jour par utilisateur ${req.user.id}`
      );

      // VÉRIFICATION : Relire depuis la DB pour confirmer
      const verificationAssoc = await Association.findByPk(associationId);
      console.log(
        "🔍 Vérification - Bureau sauvegardé en DB:",
        verificationAssoc.centralBoard
      );
      console.log(
        "🔍 Vérification - Permissions sauvegardées en DB:",
        verificationAssoc.permissionsMatrix
      );

      // Réponse avec toutes les données
      res.json({
        success: true,
        message: "Configuration mise à jour avec succès",
        data: {
          association: {
            id: verificationAssoc.id,
            name: verificationAssoc.name,
            memberTypes: verificationAssoc.memberTypes,
            centralBoard: verificationAssoc.centralBoard,
            accessRights: verificationAssoc.accessRights,
            cotisationSettings: verificationAssoc.cotisationSettings,
            permissionsMatrix: verificationAssoc.permissionsMatrix,
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
