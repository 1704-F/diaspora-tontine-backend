const {
  Association,
  AssociationMember,
  Section,
  User,
  Transaction,
} = require("../../../models");
const { Op } = require("sequelize");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

class MemberController {
  // 👥 AJOUTER MEMBRE À ASSOCIATION
  async addMember(req, res) {
    try {
      const { associationId } = req.params;

      console.log("--- DEBUG BACKEND ---");
      console.log("req.body reçu:", req.body);
      console.log("associationId:", associationId);
      const {
        // Soit userId direct (si utilisateur existe déjà)
        userId,
        // Soit données pour créer/trouver utilisateur
        firstName,
        lastName,
        phoneNumber,
        email,
        // Données membership
        memberType,
        sectionId,
        cotisationAmount,
        autoPaymentEnabled = false,
        paymentMethodId,
      } = req.body;

      console.log("Données extraites:", {
        userId,
        firstName,
        lastName,
        phoneNumber,
        email,
        memberType,
      });

      // Vérifier permissions (bureau central ou responsable section)
      const requesterMembership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
      });

      const userRoles = requesterMembership?.roles || [];
      const canAddMember =
        userRoles.includes("admin_association") ||
        userRoles.includes("president") ||
        userRoles.includes("central_board") ||
        userRoles.includes("secretaire") ||
        userRoles.includes("responsable_section") ||
        req.user.role === "super_admin";

      if (!canAddMember) {
        return res.status(403).json({
          error: "Permissions insuffisantes pour ajouter un membre",
          code: "INSUFFICIENT_ADD_MEMBER_PERMISSIONS",
        });
      }

      // NOUVELLE LOGIQUE : Créer ou trouver l'utilisateur
      let targetUser;

      if (userId) {
        // Cas 1 : userId fourni directement
        targetUser = await User.findByPk(userId);
        if (!targetUser) {
          return res.status(404).json({
            error: "Utilisateur introuvable",
            code: "USER_NOT_FOUND",
          });
        }
      } else if (firstName && lastName && phoneNumber) {
        // Cas 2 : Créer/trouver utilisateur par ses données

        // D'abord chercher s'il existe déjà
        targetUser = await User.findOne({
          where: { phoneNumber: phoneNumber.trim() },
        });

        if (!targetUser) {
          // Créer nouvel utilisateur
          targetUser = await User.create({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            phoneNumber: phoneNumber.trim(),
            email: email ? email.trim() : null,
            status: "pending_verification",
          });

          console.log(
            `Nouvel utilisateur créé: ${targetUser.firstName} ${targetUser.lastName} (${targetUser.phoneNumber})`
          );
        } else {
          console.log(
            `Utilisateur existant trouvé: ${targetUser.firstName} ${targetUser.lastName}`
          );
        }
      } else {
        return res.status(400).json({
          error: "userId OU (firstName + lastName + phoneNumber) requis",
          code: "MISSING_USER_DATA",
        });
      }

      // Vérifier qu'il n'est pas déjà membre
      const existingMembership = await AssociationMember.findOne({
        where: {
          userId: targetUser.id, // Utiliser targetUser.id maintenant
          associationId,
        },
      });

      if (existingMembership) {
        return res.status(400).json({
          error: "Utilisateur déjà membre de cette association",
          code: "ALREADY_MEMBER",
          currentStatus: existingMembership.status,
        });
      }

      // Récupérer config association pour validation
      const association = await Association.findByPk(associationId);
      const memberTypesConfig = association.memberTypes || [];
      const memberTypeExists = memberTypesConfig.find(
        (type) => type.name === memberType
      );

      if (!memberTypeExists) {
        return res.status(400).json({
          error: "Type de membre invalide",
          code: "INVALID_MEMBER_TYPE",
          available: memberTypesConfig.map((type) => type.name),
        });
      }

      // Si section spécifiée, vérifier qu'elle existe
      if (sectionId) {
        const section = await Section.findOne({
          where: { id: sectionId, associationId },
        });

        if (!section) {
          return res.status(404).json({
            error: "Section introuvable",
            code: "SECTION_NOT_FOUND",
          });
        }
      }

      // Déterminer montant cotisation
      const finalCotisationAmount =
        cotisationAmount || memberTypeExists.cotisationAmount;

      // Créer le membre
      const member = await AssociationMember.create({
        userId: targetUser.id, // Utiliser targetUser.id
        associationId,
        sectionId,
        memberType,
        status: "active",
        cotisationAmount: finalCotisationAmount,
        autoPaymentEnabled,
        paymentMethodId,
        joinDate: new Date(),
        approvedDate: new Date(),
        approvedBy: req.user.id,
        roles: [],
        permissions: memberTypeExists.permissions || [],
      });

      // Charger membre complet pour retour
      const memberComplete = await AssociationMember.findByPk(member.id, {
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "firstName", "lastName", "phoneNumber", "email"],
          },
          {
            model: Section,
            as: "section",
            attributes: ["id", "name", "country"],
          },
          { model: Association, as: "association", attributes: ["id", "name"] },
        ],
      });

      res.status(201).json({
        success: true,
        message: "Membre ajouté avec succès",
        data: { member: memberComplete },
      });
    } catch (error) {
      console.error("Erreur ajout membre:", error);
      res.status(500).json({
        error: "Erreur ajout membre",
        code: "ADD_MEMBER_ERROR",
        details: error.message,
      });
    }
  }

  async updateMember(req, res) {
  try {
    const { associationId, memberId } = req.params;
    const { memberType, status, sectionId, roles } = req.body;

    // Vérifier accès association avec permissions admin
    const membership = await AssociationMember.findOne({
      where: {
        userId: req.user.id,
        associationId,
        status: "active",
      },
    });

    const canUpdateMember =
      membership?.roles?.includes("admin_association") ||
      membership?.roles?.includes("president") ||
      req.user.role === "super_admin";

    if (!canUpdateMember) {
      return res.status(403).json({
        error: "Permission insuffisante pour modifier un membre",
        code: "UPDATE_MEMBER_DENIED",
      });
    }

    // Récupérer le membre à modifier avec ses infos utilisateur
    const memberToUpdate = await AssociationMember.findOne({
      where: {
        id: memberId,
        associationId,
      },
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "firstName", "lastName", "phoneNumber"],
        },
      ],
    });

    if (!memberToUpdate) {
      return res.status(404).json({
        error: "Membre introuvable",
        code: "MEMBER_NOT_FOUND",
      });
    }

    // Protection admin : vérifier s'il reste d'autres admins si on retire le rôle admin
    if (
      roles &&
      !roles.includes("admin_association") &&
      memberToUpdate.roles?.includes("admin_association")
    ) {
      const otherAdmins = await AssociationMember.count({
        where: {
          associationId,
          status: "active",
          roles: {
            [Op.contains]: ["admin_association"],
          },
          id: {
            [Op.ne]: memberId,
          },
        },
      });

      if (otherAdmins === 0) {
        return res.status(400).json({
          error:
            "Impossible de retirer le rôle admin : aucun autre administrateur",
          code: "LAST_ADMIN_PROTECTION",
        });
      }
    }

    // Vérifier que la section existe si fournie
    if (sectionId) {
      const sectionExists = await Section.findOne({
        where: {
          id: sectionId,
          associationId,
        },
      });

      if (!sectionExists) {
        return res.status(400).json({
          error: "Section introuvable",
          code: "SECTION_NOT_FOUND",
        });
      }
    }

    // Préparer les données de mise à jour
    const updateData = {};
    
    // Gérer le type de membre et sa cotisation automatique
    if (memberType !== undefined) {
      const association = await Association.findByPk(associationId);
      const memberTypeConfig = association?.memberTypes?.find(
        (type) => type.name === memberType
      );

      if (!memberTypeConfig) {
        return res.status(400).json({
          error: "Type de membre invalide",
          code: "INVALID_MEMBER_TYPE",
        });
      }

      updateData.memberType = memberType;
      updateData.cotisationAmount = memberTypeConfig.cotisationAmount;
    }

    if (status !== undefined) updateData.status = status;
    if (sectionId !== undefined) updateData.sectionId = sectionId;
    if (roles !== undefined) updateData.roles = roles;

    // Mettre à jour le membre
    await memberToUpdate.update(updateData);

    // SYNCHRONISATION DU BUREAU CENTRAL
    if (roles && (roles.includes('president') || roles.includes('secretaire') || roles.includes('tresorier'))) {
      
      // Récupérer l'association avec son bureau actuel
      const association = await Association.findByPk(associationId);
      const currentBureau = association.centralBoard || {};
      const updatedBureau = { ...currentBureau };
      
      // Supprimer l'utilisateur des anciens postes de bureau s'il en avait
      Object.keys(updatedBureau).forEach(poste => {
        if (updatedBureau[poste]?.userId === memberToUpdate.userId) {
          delete updatedBureau[poste];
        }
      });
      
      // Assigner aux nouveaux postes
      if (roles.includes('president')) {
        updatedBureau.president = {
          userId: memberToUpdate.userId,
          name: `${memberToUpdate.user.firstName} ${memberToUpdate.user.lastName}`,
          phoneNumber: memberToUpdate.user.phoneNumber,
          role: 'president',
          assignedAt: new Date()
        };
      }
      
      if (roles.includes('secretaire')) {
        updatedBureau.secretaire = {
          userId: memberToUpdate.userId,
          name: `${memberToUpdate.user.firstName} ${memberToUpdate.user.lastName}`,
          phoneNumber: memberToUpdate.user.phoneNumber,
          role: 'secretaire',
          assignedAt: new Date()
        };
      }
      
      if (roles.includes('tresorier')) {
        updatedBureau.tresorier = {
          userId: memberToUpdate.userId,
          name: `${memberToUpdate.user.firstName} ${memberToUpdate.user.lastName}`,
          phoneNumber: memberToUpdate.user.phoneNumber,
          role: 'tresorier',
          assignedAt: new Date()
        };
      }
      
      // Sauvegarder le bureau mis à jour
      await association.update({ centralBoard: updatedBureau });
      console.log('🏛️ Bureau central synchronisé:', updatedBureau);
    }

    // Si on retire tous les rôles de bureau, supprimer du bureau central
    if (roles && !roles.includes('president') && !roles.includes('secretaire') && !roles.includes('tresorier')) {
      
      const association = await Association.findByPk(associationId);
      const currentBureau = association.centralBoard || {};
      const updatedBureau = { ...currentBureau };
      
      // Supprimer l'utilisateur du bureau
      Object.keys(updatedBureau).forEach(poste => {
        if (updatedBureau[poste]?.userId === memberToUpdate.userId) {
          delete updatedBureau[poste];
        }
      });
      
      await association.update({ centralBoard: updatedBureau });
      console.log('🗑️ Membre retiré du bureau central');
    }

    // Récupérer le membre mis à jour avec toutes ses relations
    const updatedMember = await AssociationMember.findOne({
      where: { id: memberId },
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "firstName", "lastName", "phoneNumber", "email"],
        },
        {
          model: Section,
          as: "section",
          attributes: ["id", "name", "country", "city"],
        },
      ],
    });

    res.json({
      success: true,
      message: "Membre mis à jour avec succès",
      data: { member: updatedMember },
    });
  } catch (error) {
    console.error("Erreur mise à jour membre:", error);
    res.status(500).json({
      error: "Erreur mise à jour membre",
      code: "MEMBER_UPDATE_ERROR",
      details: error.message,
    });
  }
}

  

  // 📋 LISTER MEMBRES ASSOCIATION
  async listMembers(req, res) {
    try {
      const { associationId } = req.params;
      const {
        sectionId,
        memberType,
        status = "all",
        page = 1,
        limit = 50,
        search,
      } = req.query;

      // Vérifier accès association
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
        include: [{ model: Association, as: "association" }],
      });

      if (!membership && req.user.role !== "super_admin") {
        return res.status(403).json({
          error: "Accès association non autorisé",
          code: "ASSOCIATION_ACCESS_DENIED",
        });
      }

      // Vérifier permission voir liste membres
      const userRoles = membership?.roles || [];
      const canViewMembers =
        userRoles.includes("admin_association") ||
        userRoles.includes("president") ||
        userRoles.includes("central_board") ||
        userRoles.includes("secretaire") ||
        userRoles.includes("responsable_section") ||
        req.user.role === "super_admin";

      if (!canViewMembers) {
        return res.status(403).json({
          error: "Permission voir membres non accordée",
          code: "VIEW_MEMBERS_DENIED",
        });
      }

      // Construire filtres
      const whereClause = { associationId };
      if (sectionId) whereClause.sectionId = sectionId;
      if (memberType) whereClause.memberType = memberType;
      if (status !== "all") whereClause.status = status;

      // Pagination
      const offset = (page - 1) * limit;

      // Inclusions avec les vrais noms de colonnes
      const includes = [
        {
          model: User,
          as: "user",
          attributes: [
            "id",
            "firstName", // ✅ camelCase - correspond au model
            "lastName", // ✅ camelCase - correspond au model
            "phoneNumber", // ✅ camelCase - correspond au model
            "email",
            "created_at",
          ],
          ...(search && {
            where: {
              [Op.or]: [
                { firstName: { [Op.iLike]: `%${search}%` } }, // ✅ camelCase
                { lastName: { [Op.iLike]: `%${search}%` } }, // ✅ camelCase
                { phoneNumber: { [Op.iLike]: `%${search}%` } }, // ✅ camelCase
              ],
            },
          }),
        },
        {
          model: Section,
          as: "section",
          attributes: ["id", "name", "country", "city"],
        },
      ];

      // Récupérer membres
      const { rows: members, count } = await AssociationMember.findAndCountAll({
        where: whereClause,
        include: includes,
        limit: parseInt(limit),
        offset: parseInt(offset),
        order: [["created_at", "DESC"]],
      });

      // Vérifier permission finances
      const canViewFinances =
        userRoles.includes("admin_association") ||
        userRoles.includes("president") ||
        userRoles.includes("tresorier") ||
        req.user.role === "super_admin";

      // Formater les membres pour le frontend
      const formattedMembers = members.map((member) => {
        const memberData = {
          id: member.id,
          userId: member.userId,
          user: {
            id: member.user.id,
            firstName: member.user.firstName, // ✅ Direct camelCase
            lastName: member.user.lastName, // ✅ Direct camelCase
            phoneNumber: member.user.phoneNumber, // ✅ Direct camelCase
            email: member.user.email,
          },
          memberType: member.memberType,
          status: member.status,
          joinDate: member.joinDate,
          sectionId: member.sectionId,
          section: member.section
            ? {
                id: member.section.id,
                name: member.section.name,
                country: member.section.country,
                city: member.section.city,
              }
            : null,
          roles: member.roles || [],
          cotisationAmount: member.cotisationAmount,
          // Données simulées pour compatibilité frontend
          totalContributed: "0",
          contributionStatus: "uptodate",
          ancienneteTotal: 0,
        };

        // Ajouter calculs si permission finances
        if (canViewFinances) {
          const joinDate = new Date(member.joinDate);
          const monthsActive = Math.max(
            1,
            Math.floor(
              (Date.now() - joinDate.getTime()) / (1000 * 60 * 60 * 24 * 30)
            )
          );
          memberData.totalContributed = (
            monthsActive * (member.cotisationAmount || 0)
          ).toString();
          memberData.ancienneteTotal = monthsActive;

          // Simuler statut contribution basé sur ancienneté
          const daysSinceJoin = Math.floor(
            (Date.now() - joinDate.getTime()) / (1000 * 60 * 60 * 24)
          );
          if (daysSinceJoin > 90) {
            memberData.contributionStatus = "very_late";
          } else if (daysSinceJoin > 60) {
            memberData.contributionStatus = "late";
          } else {
            memberData.contributionStatus = "uptodate";
          }
        }

        return memberData;
      });

      res.json({
        success: true,
        data: {
          members: formattedMembers,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: count,
            pages: Math.ceil(count / limit),
          },
          filters: {
            sectionId,
            memberType,
            status,
            search,
          },
        },
      });
    } catch (error) {
      console.error("Erreur liste membres:", error);
      res.status(500).json({
        error: "Erreur récupération membres",
        code: "MEMBERS_FETCH_ERROR",
        details: error.message,
      });
    }
  }

  // 💰 PAYER COTISATION (CB PRIORITAIRE)
  async payCotisation(req, res) {
    try {
      const {
        associationId,
        amount,
        month,
        year,
        paymentMethodId,
        sectionId,
        description,
      } = req.body;

      // Vérifier membership
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
        include: [{ model: Association, as: "association" }],
      });

      if (!membership) {
        return res.status(403).json({
          error: "Membre non trouvé dans cette association",
          code: "NOT_ASSOCIATION_MEMBER",
        });
      }

      // Vérifier si cotisation déjà payée ce mois
      const existingPayment = await Transaction.findOne({
        where: {
          memberId: membership.id,
          type: "cotisation",
          month,
          year,
          status: "completed",
        },
      });

      if (existingPayment) {
        return res.status(400).json({
          error: "Cotisation déjà payée pour cette période",
          code: "COTISATION_ALREADY_PAID",
          transactionId: existingPayment.id,
        });
      }

      // Calculer commission (2.5% + 0.25€)
      const commissionAmount = parseFloat((amount * 0.025 + 0.25).toFixed(2));
      const netAmount = parseFloat((amount - commissionAmount).toFixed(2));

      // Créer transaction en attente
      const transaction = await Transaction.create({
        userId: req.user.id,
        associationId,
        sectionId,
        memberId: membership.id,
        type: "cotisation",
        amount,
        commissionAmount,
        netAmount,
        currency: membership.association.currency || "EUR",
        month,
        year,
        paymentMethod: "card",
        paymentMethodId,
        status: "pending",
        description: description || `Cotisation ${month}/${year}`,
        source: "app",
      });

      try {
        // Traitement paiement Stripe
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amount * 100),
          currency: "eur",
          payment_method: paymentMethodId,
          confirm: true,
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: "never", // ✅ Pas de redirect = pas de return_url nécessaire
          },
          metadata: {
            associationId: String(associationId),
            memberId: String(membership.id),
            type: "cotisation",
            month: String(month),
            year: String(year),
          },
        });

        // Mettre à jour transaction avec résultat Stripe
        await transaction.update({
          externalTransactionId: paymentIntent.id,
          status:
            paymentIntent.status === "succeeded" ? "completed" : "processing",
          processedAt: new Date(),
        });

        // Si succès, mettre à jour statistiques membre
        if (paymentIntent.status === "succeeded") {
          await membership.update({
            totalContributed: membership.totalContributed + amount,
            lastContributionDate: new Date(),
            contributionStatus: "uptodate",
          });

          await transaction.update({
            completedAt: new Date(),
          });
        }

        res.json({
          success: true,
          message:
            paymentIntent.status === "succeeded"
              ? "Cotisation payée avec succès"
              : "Paiement en cours",
          data: {
            transaction: {
              id: transaction.id,
              amount,
              commissionAmount,
              netAmount,
              status: transaction.status,
              month,
              year,
            },
            paymentIntent: {
              id: paymentIntent.id,
              status: paymentIntent.status,
              requiresAction: paymentIntent.status === "requires_action",
            },
          },
        });
      } catch (stripeError) {
        // Échec paiement Stripe
        await transaction.update({
          status: "failed",
          failureReason: stripeError.message.substring(0, 250), // ✅ Tronqué
        });

        throw stripeError;
      }
    } catch (error) {
      console.error("Erreur paiement cotisation:", error);
      res.status(500).json({
        error: "Erreur traitement paiement",
        code: "PAYMENT_ERROR",
        details: error.message,
      });
    }
  }

  // 📊 HISTORIQUE COTISATIONS MEMBRE
  async getMemberCotisations(req, res) {
    try {
      const { associationId, memberId } = req.params;
      const { year, limit = 12 } = req.query;

      // Vérifier accès (le membre lui-même ou bureau)
      const [targetMember, requesterMembership] = await Promise.all([
        AssociationMember.findOne({
          where: { id: memberId, associationId },
          include: [
            { model: User, as: "user", attributes: ["id", "fullName"] },
          ],
        }),
        AssociationMember.findOne({
          where: {
            userId: req.user.id,
            associationId,
            status: "active",
          },
        }),
      ]);

      if (!targetMember) {
        return res.status(404).json({
          error: "Membre introuvable",
          code: "MEMBER_NOT_FOUND",
        });
      }

      // Vérifier permissions
      const isOwnData = targetMember.userId === req.user.id;
      const canViewFinances =
        requesterMembership &&
        this.checkPermission(requesterMembership, "view_finances");

      if (!isOwnData && !canViewFinances && req.user.role !== "super_admin") {
        return res.status(403).json({
          error: "Accès non autorisé aux données financières",
          code: "FINANCIAL_DATA_ACCESS_DENIED",
        });
      }

      // Construire filtres
      const whereClause = {
        memberId,
        type: "cotisation",
      };

      if (year) {
        whereClause.year = parseInt(year);
      }

      // Récupérer cotisations
      const cotisations = await Transaction.findAll({
        where: whereClause,
        attributes: [
          "id",
          "amount",
          "commissionAmount",
          "netAmount",
          "month",
          "year",
          "status",
          "paymentMethod",
          "created_at",
          "completedAt",
          "source",
        ],
        limit: parseInt(limit),
        order: [
          ["year", "DESC"],
          ["month", "DESC"],
        ],
      });

      // Calculer statistiques
      const stats = {
        totalPaid: cotisations
          .filter((c) => c.status === "completed")
          .reduce((sum, c) => sum + parseFloat(c.amount), 0),
        totalCommissions: cotisations
          .filter((c) => c.status === "completed")
          .reduce((sum, c) => sum + parseFloat(c.commissionAmount), 0),
        monthsPaid: cotisations.filter((c) => c.status === "completed").length,
        pendingPayments: cotisations.filter((c) => c.status === "pending")
          .length,
        lastPayment: cotisations.find((c) => c.status === "completed"),
      };

      res.json({
        success: true,
        data: {
          member: {
            id: targetMember.id,
            user: targetMember.user,
            memberType: targetMember.memberType,
            joinDate: targetMember.joinDate,
            seniority: targetMember.getTotalSeniority(),
          },
          cotisations,
          stats,
          period: year || "all",
        },
      });
    } catch (error) {
      console.error("Erreur historique cotisations:", error);
      res.status(500).json({
        error: "Erreur récupération historique cotisations",
        code: "COTISATIONS_FETCH_ERROR",
        details: error.message,
      });
    }
  }

  // 🔄 MODIFIER STATUT MEMBRE
  async updateMemberStatus(req, res) {
    try {
      const { associationId, memberId } = req.params;
      const { status, reason, newMemberType, newSectionId } = req.body;

      // Vérifier permissions
      const requesterMembership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
      });

      const canModifyStatus =
        requesterMembership &&
        (["president", "central_board", "secretaire"].includes(
          requesterMembership.roles?.[0]
        ) ||
          req.user.role === "super_admin");

      if (!canModifyStatus) {
        return res.status(403).json({
          error: "Permissions insuffisantes pour modifier statut membre",
          code: "INSUFFICIENT_MODIFY_PERMISSIONS",
        });
      }

      // Trouver le membre
      const member = await AssociationMember.findOne({
        where: { id: memberId, associationId },
        include: [{ model: User, as: "user", attributes: ["id", "fullName"] }],
      });

      if (!member) {
        return res.status(404).json({
          error: "Membre introuvable",
          code: "MEMBER_NOT_FOUND",
        });
      }

      // Empêcher auto-modification du statut
      if (
        member.userId === req.user.id &&
        ["suspended", "excluded"].includes(status)
      ) {
        return res.status(400).json({
          error: "Impossible de se suspendre/exclure soi-même",
          code: "SELF_SUSPENSION_FORBIDDEN",
        });
      }

      // Préparer mise à jour
      const updates = { status };
      if (reason) updates.suspensionReason = reason;
      if (newMemberType) updates.memberType = newMemberType;
      if (newSectionId) updates.sectionId = newSectionId;

      // Mettre à jour
      await member.update(updates);

      // Mettre à jour compteurs si changement statut actif
      if (member.status === "active" && status !== "active") {
        await Association.decrement("membersCount", {
          where: { id: associationId },
        });
        if (member.sectionId) {
          await Section.decrement("activeMembersCount", {
            where: { id: member.sectionId },
          });
        }
      } else if (member.status !== "active" && status === "active") {
        await Association.increment("membersCount", {
          where: { id: associationId },
        });
        if (member.sectionId) {
          await Section.increment("activeMembersCount", {
            where: { id: member.sectionId },
          });
        }
      }

      res.json({
        success: true,
        message: "Statut membre mis à jour avec succès",
        data: {
          member: await AssociationMember.findByPk(member.id, {
            include: [
              { model: User, as: "user", attributes: ["id", "fullName"] },
              { model: Section, as: "section", attributes: ["id", "name"] },
            ],
          }),
        },
      });
    } catch (error) {
      console.error("Erreur modification statut membre:", error);
      res.status(500).json({
        error: "Erreur modification statut membre",
        code: "MEMBER_STATUS_UPDATE_ERROR",
        details: error.message,
      });
    }
  }

  // 🔧 CONFIGURER PRÉLÈVEMENT AUTOMATIQUE
  async setupAutoPayment(req, res) {
    try {
      const { associationId, memberId } = req.params;
      const { paymentMethodId, enabled = true } = req.body;

      // Vérifier que c'est le membre lui-même ou bureau
      const [targetMember, requesterMembership] = await Promise.all([
        AssociationMember.findOne({
          where: { id: memberId, associationId },
        }),
        AssociationMember.findOne({
          where: {
            userId: req.user.id,
            associationId,
            status: "active",
          },
        }),
      ]);

      const isOwnAccount = targetMember?.userId === req.user.id;
      const isBureauMember =
        requesterMembership &&
        ["president", "central_board", "tresorier"].includes(
          requesterMembership.roles?.[0]
        );

      if (!isOwnAccount && !isBureauMember && req.user.role !== "super_admin") {
        return res.status(403).json({
          error: "Seul le membre ou le bureau peut configurer le prélèvement",
          code: "AUTO_PAYMENT_PERMISSION_DENIED",
        });
      }

      if (!targetMember) {
        return res.status(404).json({
          error: "Membre introuvable",
          code: "MEMBER_NOT_FOUND",
        });
      }

      // Valider méthode paiement avec Stripe si activation
      if (enabled && paymentMethodId) {
        try {
          const paymentMethod = await stripe.paymentMethods.retrieve(
            paymentMethodId
          );

          if (paymentMethod.customer !== req.user.stripeCustomerId) {
            return res.status(400).json({
              error: "Méthode paiement non autorisée",
              code: "INVALID_PAYMENT_METHOD",
            });
          }
        } catch (stripeError) {
          return res.status(400).json({
            error: "Méthode paiement invalide",
            code: "STRIPE_PAYMENT_METHOD_ERROR",
            details: stripeError.message,
          });
        }
      }

      // Mettre à jour configuration
      await targetMember.update({
        autoPaymentEnabled: enabled,
        paymentMethodId: enabled ? paymentMethodId : null,
      });

      res.json({
        success: true,
        message: enabled
          ? "Prélèvement automatique activé"
          : "Prélèvement automatique désactivé",
        data: {
          autoPaymentEnabled: enabled,
          paymentMethodId: enabled ? paymentMethodId : null,
        },
      });
    } catch (error) {
      console.error("Erreur configuration prélèvement:", error);
      res.status(500).json({
        error: "Erreur configuration prélèvement automatique",
        code: "AUTO_PAYMENT_CONFIG_ERROR",
        details: error.message,
      });
    }
  }

  // 📈 RAPPORT COTISATIONS ASSOCIATION
  async getCotisationsReport(req, res) {
    try {
      const { associationId } = req.params;
      const { month, year, sectionId } = req.query;

      // Vérifier permissions finances
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
      });

      const canViewFinances =
        (membership && this.checkPermission(membership, "view_finances")) ||
        req.user.role === "super_admin";

      if (!canViewFinances) {
        return res.status(403).json({
          error: "Accès aux finances non autorisé",
          code: "FINANCIAL_ACCESS_DENIED",
        });
      }

      // Construire filtres
      const whereClause = {
        associationId,
        type: "cotisation",
      };

      if (month) whereClause.month = parseInt(month);
      if (year) whereClause.year = parseInt(year);
      if (sectionId) whereClause.sectionId = sectionId;

      // Récupérer transactions cotisations
      const cotisations = await Transaction.findAll({
        where: whereClause,
        include: [
          {
            model: AssociationMember,
            as: "member",
            include: [
              { model: User, as: "user", attributes: ["id", "fullName"] },
              {
                model: Section,
                as: "section",
                attributes: ["id", "name", "country"],
              },
            ],
          },
        ],
        order: [
          ["year", "DESC"],
          ["month", "DESC"],
          ["created_at", "DESC"],
        ],
      });

      // Calculer statistiques
      const stats = {
        totalCollected: cotisations
          .filter((c) => c.status === "completed")
          .reduce((sum, c) => sum + parseFloat(c.netAmount), 0),
        totalCommissions: cotisations
          .filter((c) => c.status === "completed")
          .reduce((sum, c) => sum + parseFloat(c.commissionAmount), 0),
        paymentsCount: {
          completed: cotisations.filter((c) => c.status === "completed").length,
          pending: cotisations.filter((c) => c.status === "pending").length,
          failed: cotisations.filter((c) => c.status === "failed").length,
        },
        paymentMethods: {
          card: cotisations.filter((c) => c.paymentMethod === "card").length,
          iban: cotisations.filter((c) => c.paymentMethod === "iban").length,
        },
      };

      // Grouper par section si multi-sections
      const bySections = {};
      cotisations.forEach((cotisation) => {
        const sectionName = cotisation.member?.section?.name || "Sans section";
        if (!bySections[sectionName]) {
          bySections[sectionName] = {
            total: 0,
            count: 0,
            members: new Set(),
          };
        }

        if (cotisation.status === "completed") {
          bySections[sectionName].total += parseFloat(cotisation.netAmount);
          bySections[sectionName].count++;
          bySections[sectionName].members.add(cotisation.member.userId);
        }
      });

      // Convertir Set en count
      Object.keys(bySections).forEach((section) => {
        bySections[section].uniqueMembers = bySections[section].members.size;
        delete bySections[section].members;
      });

      res.json({
        success: true,
        data: {
          cotisations,
          stats,
          bySections,
          period: { month, year },
          generatedAt: new Date(),
        },
      });
    } catch (error) {
      console.error("Erreur rapport cotisations:", error);
      res.status(500).json({
        error: "Erreur génération rapport cotisations",
        code: "COTISATIONS_REPORT_ERROR",
        details: error.message,
      });
    }
  }

  // 🔄 IMPORTER HISTORIQUE COTISATIONS
  async importCotisationsHistory(req, res) {
    try {
      const { associationId } = req.params;
      const { cotisationsData } = req.body; // Array des cotisations historiques

      // Vérifier permissions (bureau central uniquement)
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
      });

      const canImport =
        (membership &&
          ["president", "central_board", "tresorier"].includes(
            membership.roles?.[0]
          )) ||
        req.user.role === "super_admin";

      if (!canImport) {
        return res.status(403).json({
          error: "Seul le bureau central peut importer l'historique",
          code: "BUREAU_ONLY_IMPORT",
        });
      }

      if (!Array.isArray(cotisationsData) || cotisationsData.length === 0) {
        return res.status(400).json({
          error: "Données d'import invalides",
          code: "INVALID_IMPORT_DATA",
        });
      }

      const importResults = {
        success: 0,
        errors: 0,
        skipped: 0,
        details: [],
      };

      // Traiter chaque cotisation
      for (const [index, cotisationData] of cotisationsData.entries()) {
        try {
          const {
            memberName,
            phoneNumber,
            amount,
            month,
            year,
            status = "completed",
          } = cotisationData;

          // Trouver le membre par nom ou téléphone
          const member = await AssociationMember.findOne({
            where: { associationId },
            include: [
              {
                model: User,
                as: "user",
                where: {
                  [Op.or]: [
                    { fullName: { [Op.iLike]: `%${memberName}%` } },
                    { phoneNumber: phoneNumber },
                  ],
                },
              },
            ],
          });

          if (!member) {
            importResults.errors++;
            importResults.details.push({
              line: index + 1,
              error: `Membre non trouvé: ${memberName}`,
              data: cotisationData,
            });
            continue;
          }

          // Vérifier si cotisation existe déjà
          const existing = await Transaction.findOne({
            where: {
              memberId: member.id,
              type: "cotisation",
              month: parseInt(month),
              year: parseInt(year),
            },
          });

          if (existing) {
            importResults.skipped++;
            importResults.details.push({
              line: index + 1,
              message: `Cotisation ${month}/${year} déjà existante pour ${memberName}`,
              data: cotisationData,
            });
            continue;
          }

          // Créer transaction historique
          await Transaction.create({
            userId: member.userId,
            associationId,
            memberId: member.id,
            sectionId: member.sectionId,
            type: "cotisation",
            amount: parseFloat(amount),
            commissionAmount: 0, // Pas de commission sur historique
            netAmount: parseFloat(amount),
            currency: "EUR",
            month: parseInt(month),
            year: parseInt(year),
            paymentMethod: "iban", // Historique supposé par virement
            status,
            description: `Import historique ${month}/${year}`,
            source: "imported",
            processedAt: new Date(),
            completedAt: status === "completed" ? new Date() : null,
          });

          // Mettre à jour statistiques membre si cotisation payée
          if (status === "completed") {
            await member.update({
              totalContributed: member.totalContributed + parseFloat(amount),
            });
          }

          importResults.success++;
          importResults.details.push({
            line: index + 1,
            message: `Cotisation ${month}/${year} importée pour ${memberName}`,
            data: cotisationData,
          });
        } catch (lineError) {
          importResults.errors++;
          importResults.details.push({
            line: index + 1,
            error: lineError.message,
            data: cotisationData,
          });
        }
      }

      res.json({
        success: true,
        message: "Import historique terminé",
        data: {
          summary: {
            total: cotisationsData.length,
            imported: importResults.success,
            errors: importResults.errors,
            skipped: importResults.skipped,
          },
          details: importResults.details,
        },
      });
    } catch (error) {
      console.error("Erreur import historique:", error);
      res.status(500).json({
        error: "Erreur import historique cotisations",
        code: "IMPORT_HISTORY_ERROR",
        details: error.message,
      });
    }
  }

  // Obtenir détails d'un membre
  async getMember(req, res) {
    try {
      const { associationId, memberId } = req.params;

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

      // Récupérer le membre
      const member = await AssociationMember.findOne({
        where: {
          id: memberId,
          associationId,
        },
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "firstName", "lastName", "phoneNumber", "email"],
          },
          {
            model: Section,
            as: "section",
            attributes: ["id", "name", "country", "city"],
          },
        ],
      });

      if (!member) {
        return res.status(404).json({
          error: "Membre introuvable",
          code: "MEMBER_NOT_FOUND",
        });
      }

      res.json({
        success: true,
        data: { member },
      });
    } catch (error) {
      console.error("Erreur récupération membre:", error);
      res.status(500).json({
        error: "Erreur récupération membre",
        code: "MEMBER_FETCH_ERROR",
        details: error.message,
      });
    }
  }

  // 🎯 TABLEAU DE BORD MEMBRE
  async getMemberDashboard(req, res) {
    try {
      const { associationId } = req.params;

      // Récupérer membership utilisateur
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
        include: [
          { model: Association, as: "association" },
          { model: Section, as: "section" },
        ],
      });

      if (!membership) {
        return res.status(403).json({
          error: "Membre non trouvé dans cette association",
          code: "NOT_ASSOCIATION_MEMBER",
        });
      }

      // Récupérer dernières cotisations
      const recentCotisations = await Transaction.findAll({
        where: {
          memberId: membership.id,
          type: "cotisation",
        },
        limit: 6,
        order: [
          ["year", "DESC"],
          ["month", "DESC"],
        ],
      });

      // Calculer statistiques personnelles
      const [totalContributed, currentYearPaid, isCurrentMonthPaid] =
        await Promise.all([
          membership.getTotalContributions(),
          Transaction.count({
            where: {
              memberId: membership.id,
              type: "cotisation",
              status: "completed",
              year: new Date().getFullYear(),
            },
          }),
          membership.isCurrentMonthPaid(),
        ]);

      // Vérifier prochaine échéance
      const currentMonth = new Date().getMonth() + 1;
      const currentYear = new Date().getFullYear();
      const nextDue = {
        month: currentMonth,
        year: currentYear,
        amount: membership.cotisationAmount,
        isPaid: isCurrentMonthPaid,
      };

      // Permissions utilisateur
      const userPermissions = await this.getUserPermissions(
        req.user.id,
        associationId
      );

      // Événements à venir (si permission)
      let upcomingEvents = [];
      if (userPermissions.view_events !== false) {
        const { Event } = require("../../../models");
        upcomingEvents = await Event.findAll({
          where: {
            associationId,
            startDate: { [Op.gte]: new Date() },
            [Op.or]: [
              { visibility: "public" },
              { visibility: "association" },
              ...(membership.sectionId
                ? [{ sectionId: membership.sectionId }]
                : []),
            ],
          },
          limit: 3,
          order: [["start_date", "ASC"]],
        });
      }

      res.json({
        success: true,
        data: {
          member: {
            id: membership.id,
            memberType: membership.memberType,
            roles: membership.roles,
            joinDate: membership.joinDate,
            seniority: membership.getTotalSeniority(),
            status: membership.status,
            section: membership.section,
          },
          association: {
            id: membership.association.id,
            name: membership.association.name,
            membersCount: membership.association.membersCount,
          },
          finances: {
            totalContributed,
            currentYearPaid,
            nextDue,
            autoPaymentEnabled: membership.autoPaymentEnabled,
            cotisationAmount: membership.cotisationAmount,
          },
          recentActivity: {
            cotisations: recentCotisations,
            upcomingEvents,
          },
          permissions: userPermissions,
        },
      });
    } catch (error) {
      console.error("Erreur dashboard membre:", error);
      res.status(500).json({
        error: "Erreur récupération dashboard membre",
        code: "MEMBER_DASHBOARD_ERROR",
        details: error.message,
      });
    }
  }

  // 🔧 UTILITAIRES PERMISSIONS
  checkPermission(membership, action) {
    if (!membership || !membership.association) return false;

    const permissions = membership.association.permissionsMatrix || {};
    const actionConfig = permissions[action];

    if (!actionConfig) {
      // Permissions par défaut si pas configuré
      const defaultPermissions = {
        view_member_list: [
          "president",
          "central_board",
          "secretaire",
          "responsable_section",
        ],
        view_finances: [
          "president",
          "central_board",
          "tresorier",
          "tresorier_section",
        ],
        manage_members: ["president", "central_board", "secretaire"],
        approve_aids: ["president", "central_board", "tresorier"],
      };

      const defaultRoles = defaultPermissions[action] || [];
      const userRoles = membership.roles || [];
      return userRoles.some((role) => defaultRoles.includes(role));
    }

    const userRoles = membership.roles || [];
    const allowedRoles = actionConfig.allowed_roles || [];

    return userRoles.some((role) => allowedRoles.includes(role));
  }

  async getUserPermissions(userId, associationId) {
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

      // Ajouter permissions par défaut si pas configurées
      const defaultActions = [
        "view_member_list",
        "view_finances",
        "manage_members",
        "approve_aids",
      ];
      defaultActions.forEach((action) => {
        if (userPermissions[action] === undefined) {
          userPermissions[action] = this.checkPermission(membership, action);
        }
      });

      return userPermissions;
    } catch (error) {
      console.error("Erreur calcul permissions utilisateur:", error);
      return {};
    }
  }

  // 📱 NOTIFICATIONS COTISATIONS EN RETARD
  async getOverdueCotisations(req, res) {
    try {
      const { associationId } = req.params;

      // Vérifier permissions (bureau uniquement)
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
      });

      const canViewOverdue =
        (membership && this.checkPermission(membership, "view_finances")) ||
        req.user.role === "super_admin";

      if (!canViewOverdue) {
        return res.status(403).json({
          error: "Permissions insuffisantes",
          code: "INSUFFICIENT_PERMISSIONS",
        });
      }

      const currentMonth = new Date().getMonth() + 1;
      const currentYear = new Date().getFullYear();

      // Trouver membres actifs sans cotisation ce mois
      const activeMembers = await AssociationMember.findAll({
        where: {
          associationId,
          status: "active",
        },
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "fullName", "phoneNumber"],
          },
          { model: Section, as: "section", attributes: ["id", "name"] },
        ],
      });

      const overdueMembers = [];

      for (const member of activeMembers) {
        const hasCurrentPayment = await Transaction.findOne({
          where: {
            memberId: member.id,
            type: "cotisation",
            month: currentMonth,
            year: currentYear,
            status: "completed",
          },
        });

        if (!hasCurrentPayment) {
          // Calculer retard en mois
          const lastPayment = await Transaction.findOne({
            where: {
              memberId: member.id,
              type: "cotisation",
              status: "completed",
            },
            order: [
              ["year", "DESC"],
              ["month", "DESC"],
            ],
          });

          let monthsOverdue = 1;
          if (lastPayment) {
            const lastPaymentDate = new Date(
              lastPayment.year,
              lastPayment.month - 1
            );
            const currentDate = new Date(currentYear, currentMonth - 1);
            monthsOverdue =
              (currentDate.getFullYear() - lastPaymentDate.getFullYear()) * 12 +
              (currentDate.getMonth() - lastPaymentDate.getMonth());
          }

          overdueMembers.push({
            member: {
              id: member.id,
              user: member.user,
              memberType: member.memberType,
              section: member.section,
              cotisationAmount: member.cotisationAmount,
              autoPaymentEnabled: member.autoPaymentEnabled,
            },
            overdue: {
              monthsOverdue,
              lastPayment,
              estimatedDebt: member.cotisationAmount * monthsOverdue,
            },
          });
        }
      }

      // Trier par nombre de mois de retard
      overdueMembers.sort(
        (a, b) => b.overdue.monthsOverdue - a.overdue.monthsOverdue
      );

      // Statistiques résumé
      const stats = {
        totalOverdue: overdueMembers.length,
        totalActiveMembers: activeMembers.length,
        paymentRate: Math.round(
          ((activeMembers.length - overdueMembers.length) /
            activeMembers.length) *
            100
        ),
        totalPotentialRevenue: overdueMembers.reduce(
          (sum, om) => sum + om.overdue.estimatedDebt,
          0
        ),
      };

      res.json({
        success: true,
        data: {
          overdueMembers,
          stats,
          period: { month: currentMonth, year: currentYear },
          generatedAt: new Date(),
        },
      });
    } catch (error) {
      console.error("Erreur cotisations en retard:", error);
      res.status(500).json({
        error: "Erreur récupération cotisations en retard",
        code: "OVERDUE_COTISATIONS_ERROR",
        details: error.message,
      });
    }
  }

  async getSectionMembers(req, res) {
  try {
    const { associationId, sectionId } = req.params;
    const {
      page = 1,
      limit = 50,
      search,
      status = "all",
      memberType,
    } = req.query;

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

    // Construire filtres
    const whereClause = {
      associationId,
      sectionId: sectionId,
    };
    if (memberType && memberType !== "all")
      whereClause.memberType = memberType;
    if (status !== "all") whereClause.status = status;

    // Pagination
    const offset = (page - 1) * limit;

    // Inclusions avec recherche - FIX: utiliser firstName et lastName
    const includes = [
      {
        model: User,
        as: "user",
        attributes: [
          "id",
          "firstName",      // ✅ Correct
          "lastName",       // ✅ Correct
          "phoneNumber",
          "email",
          "created_at",
        ],
        ...(search && {
          where: {
            [Op.or]: [
              { firstName: { [Op.iLike]: `%${search}%` } },   // ✅ Fix
              { lastName: { [Op.iLike]: `%${search}%` } },    // ✅ Fix
              { phoneNumber: { [Op.iLike]: `%${search}%` } },
            ],
          },
        }),
      },
      {
        model: Section,
        as: "section",
        attributes: ["id", "name", "country", "city"],
      },
    ];

    // Récupérer membres de la section
    const { rows: members, count } = await AssociationMember.findAndCountAll({
      where: whereClause,
      include: includes,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["created_at", "DESC"]],
    });

    // Formatter les données pour le frontend
    const formattedMembers = members.map((member) => {
      // Calculer contribution totale (simulation)
      const joinDate = new Date(member.joinDate);
      const monthsActive = Math.max(
        1,
        Math.floor(
          (Date.now() - joinDate.getTime()) / (1000 * 60 * 60 * 24 * 30)
        )
      );

      // Récupérer montant cotisation selon type
      const association = section.association || {};
      const memberTypes = association.memberTypes || {};
      const memberTypeData = memberTypes[member.memberType] || {};
      const monthlyCotisation = memberTypeData.monthlyAmount || 0;

      const totalContributed = monthsActive * monthlyCotisation;

      // Déterminer statut cotisation (simulation basée sur dernière activité)
      let contributionStatus = "uptodate";
      if (member.lastPaymentDate) {
        const daysSinceLastPayment = Math.floor(
          (Date.now() - new Date(member.lastPaymentDate).getTime()) /
            (1000 * 60 * 60 * 24)
        );
        if (daysSinceLastPayment > 60) contributionStatus = "defaulting";
        else if (daysSinceLastPayment > 30) contributionStatus = "late";
      }

      return {
        id: member.id,
        userId: member.userId,
        user: {                                    // ✅ Structure cohérente avec les autres APIs
          id: member.user.id,
          firstName: member.user.firstName,
          lastName: member.user.lastName,
          phoneNumber: member.user.phoneNumber,
          email: member.user.email
        },
        memberType: member.memberType,
        status: member.status,
        joinDate: member.joinDate,
        lastActiveDate: member.lastPaymentDate,
        totalContributed: totalContributed.toString(),
        contributionStatus,
        roles: member.roles || [],
      };
    });

    res.json({
      success: true,
      data: {
        members: formattedMembers,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count,
          pages: Math.ceil(count / limit),
        },
        section: {
          id: section.id,
          name: section.name,
          country: section.country,
          city: section.city,
          currency: section.currency,
        },
      },
    });
  } catch (error) {
    console.error("Erreur récupération membres section:", error);
    res.status(500).json({
      error: "Erreur récupération membres section",
      code: "SECTION_MEMBERS_FETCH_ERROR",
      details: error.message,
    });
  }
}


}

module.exports = new MemberController();
