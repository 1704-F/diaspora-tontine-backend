//src\modules\associations\controllers\memberController.js

const {
  Association,
  AssociationMember,
  Section,
  User,
  Transaction,
  sequelize,
} = require("../../../models");
const { Op } = require("sequelize");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);




class MemberController {
  // 👥 AJOUTER MEMBRE À ASSOCIATION
   

  async addMember(req, res) {
    try {
      const { associationId } = req.params;
      const {
        userId,
        firstName,
        lastName,
        phoneNumber,
        email,
        dateOfBirth,
        gender,
        address,
        city,
        country,
        postalCode,
        memberType,
        sectionId,
        status = "pending",
        cotisationAmount,
        assignedRoles,
        autoPaymentEnabled,
        paymentMethodId,
      } = req.body;

      // Vérifier accès association avec permissions
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

      // Vérifier permissions avec RBAC moderne
      const canAddMember =
        membership?.isAdmin ||
        hasPermission(membership, "manage_members") ||
        req.user.role === "super_admin";

      if (!canAddMember) {
        return res.status(403).json({
          error: "Permission insuffisante pour ajouter un membre",
          code: "ADD_MEMBER_DENIED",
          required: "manage_members",
        });
      }

      // Déterminer l'utilisateur cible
      let targetUser;

      if (userId) {
        // Cas 1: userId fourni explicitement
        targetUser = await User.findByPk(userId);
        if (!targetUser) {
          return res.status(404).json({
            error: "Utilisateur introuvable",
            code: "USER_NOT_FOUND",
          });
        }
      } else if (firstName && lastName && phoneNumber) {
        // Cas 2: Créer un nouveau membre avec ses infos
        targetUser = await User.findOne({
          where: { phoneNumber: phoneNumber.trim() },
        });

        if (!targetUser) {
          targetUser = await User.create({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            phoneNumber: phoneNumber.trim(),
            email: email ? email.trim() : null,
            dateOfBirth: dateOfBirth || null,
            gender: gender || null,
            address: address ? address.trim() : null,
            city: city ? city.trim() : null,
            country: country || "FR",
            postalCode: postalCode ? postalCode.trim() : null,
            status: "pending_verification",
          });

          console.log(`✅ Nouvel utilisateur créé:`, {
            id: targetUser.id,
            firstName: targetUser.firstName,
            lastName: targetUser.lastName,
            phoneNumber: targetUser.phoneNumber,
          });
        } else {
          console.log(`✅ Utilisateur existant trouvé: ${targetUser.firstName} ${targetUser.lastName}`);
        }
      } else {
        // ✅ CAS 3: Aucun userId/infos fourni → utiliser l'utilisateur courant (req.user.id)
        // Ce cas arrive quand l'admin créateur se convertit lui-même en membre
        console.log(`🔄 Aucun userId/infos fourni → utilisation req.user.id (${req.user.id})`);
        
        targetUser = await User.findByPk(req.user.id);
        if (!targetUser) {
          return res.status(404).json({
            error: "Utilisateur courant introuvable",
            code: "CURRENT_USER_NOT_FOUND",
          });
        }
        
        console.log(`✅ Utilisateur courant trouvé: ${targetUser.firstName} ${targetUser.lastName}`);
      }

      // ============================================
      // ✅ VÉRIFIER SI DÉJÀ MEMBRE
      // ============================================
      const existingMembership = await AssociationMember.findOne({
        where: {
          userId: targetUser.id,
          associationId,
        },
      });

      if (existingMembership) {
        // ✅ CAS SPÉCIAL : Admin externe qui devient membre interne
        if (existingMembership.isAdmin && !existingMembership.isMemberOfAssociation) {
          console.log(`🔄 Conversion admin externe → membre interne pour userId ${targetUser.id}`);

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

          // Valider les rôles assignés
          if (assignedRoles && assignedRoles.length > 0) {
            const rolesConfig = association.rolesConfiguration?.roles || [];
            const invalidRoles = assignedRoles.filter(
              (roleId) => !rolesConfig.find((r) => r.id === roleId)
            );

            if (invalidRoles.length > 0) {
              return res.status(400).json({
                error: "Rôles invalides",
                code: "INVALID_ROLES",
                invalidRoles,
                availableRoles: rolesConfig.map((r) => ({ id: r.id, name: r.name })),
              });
            }
          }

          // Déterminer montant cotisation
          const finalCotisationAmount =
            cotisationAmount !== undefined ? cotisationAmount : memberTypeExists.cotisationAmount;

          // ✅ METTRE À JOUR le membership existant
          await existingMembership.update({
            memberType,
            assignedRoles: assignedRoles || [],
            cotisationAmount: finalCotisationAmount,
            isMemberOfAssociation: true, // ✅ Devient membre réel
            status: status || "pending",
            approvedDate: status === "active" ? new Date() : null,
            approvedBy: status === "active" ? req.user.id : null,
            autoPaymentEnabled: autoPaymentEnabled || false,
            paymentMethodId: paymentMethodId || null,
            sectionId: sectionId || null,
          });

          console.log(`✅ Admin converti en membre avec succès - Type: ${memberType}, Rôles: ${assignedRoles?.length || 0}`);

          // Charger membre complet pour retour
          const memberComplete = await AssociationMember.findByPk(existingMembership.id, {
            include: [
              {
                model: User,
                as: "user",
                attributes: [
                  "id",
                  "firstName",
                  "lastName",
                  "phoneNumber",
                  "email",
                  "dateOfBirth",
                  "gender",
                  "address",
                  "city",
                  "country",
                  "postalCode",
                ],
              },
              {
                model: Section,
                as: "section",
                attributes: ["id", "name", "country"],
              },
              { model: Association, as: "association", attributes: ["id", "name"] },
            ],
          });

          return res.status(200).json({
            success: true,
            message: "Admin converti en membre interne avec succès",
            data: { member: memberComplete },
          });
        }

        // ❌ Sinon, c'est vraiment un doublon
        return res.status(400).json({
          error: "Cet utilisateur est déjà membre de l'association",
          code: "ALREADY_MEMBER",
          currentStatus: existingMembership.status,
          isMemberOfAssociation: existingMembership.isMemberOfAssociation,
        });
      }

      // ============================================
      // ✅ CRÉER NOUVEAU MEMBRE
      // ============================================

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

      // Valider les rôles assignés
      if (assignedRoles && assignedRoles.length > 0) {
        const rolesConfig = association.rolesConfiguration?.roles || [];
        const invalidRoles = assignedRoles.filter(
          (roleId) => !rolesConfig.find((r) => r.id === roleId)
        );

        if (invalidRoles.length > 0) {
          return res.status(400).json({
            error: "Rôles invalides",
            code: "INVALID_ROLES",
            invalidRoles,
            availableRoles: rolesConfig.map((r) => ({ id: r.id, name: r.name })),
          });
        }

        console.log(
          `✅ Rôles validés:`,
          assignedRoles.map(
            (roleId) => rolesConfig.find((r) => r.id === roleId)?.name
          )
        );
      }

      // Déterminer montant cotisation
      const finalCotisationAmount =
        cotisationAmount !== undefined ? cotisationAmount : memberTypeExists.cotisationAmount;

      // ✅ Créer membre avec assignedRoles
      const member = await AssociationMember.create({
        userId: targetUser.id,
        associationId,
        sectionId,
        memberType,
        status,
        cotisationAmount: finalCotisationAmount,
        autoPaymentEnabled: autoPaymentEnabled || false,
        paymentMethodId: paymentMethodId || null,
        joinDate: new Date(),
        approvedDate: status === "active" ? new Date() : null,
        approvedBy: status === "active" ? req.user.id : null,
        isMemberOfAssociation: true, // ✅ Membre réel par défaut
        isAdmin: false,
        assignedRoles: assignedRoles || [],
        customPermissions: { granted: [], revoked: [] },
      });

      console.log(
        `✅ Membre créé avec ${assignedRoles?.length || 0} rôle(s):`,
        assignedRoles
      );

      // Charger membre complet pour retour
      const memberComplete = await AssociationMember.findByPk(member.id, {
        include: [
          {
            model: User,
            as: "user",
            attributes: [
              "id",
              "firstName",
              "lastName",
              "phoneNumber",
              "email",
              "dateOfBirth",
              "gender",
              "address",
              "city",
              "country",
              "postalCode",
            ],
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
      console.error("❌ Erreur ajout membre:", error);
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
      const {
        memberType,
        status,
        sectionId,
        assignedRoles,
        cotisationAmount,
        autoPaymentEnabled,
        paymentMethodId,
      } = req.body;

      // Vérifier accès association avec permissions
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
            attributes: ["rolesConfiguration", "memberTypes"],
          },
        ],
      });

      const canUpdateMember =
        membership?.isAdmin ||
        hasPermission(membership, "manage_members") ||
        req.user.role === "super_admin";

      if (!canUpdateMember) {
        return res.status(403).json({
          error: "Permission insuffisante pour modifier un membre",
          code: "UPDATE_MEMBER_DENIED",
          required: "manage_members",
        });
      }

      // Récupérer le membre à modifier
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

      // Protection admin : vérifier s'il reste d'autres admins
      if (memberToUpdate.isAdmin && status === "suspended") {
        const otherAdmins = await AssociationMember.count({
          where: {
            associationId,
            status: "active",
            isAdmin: true,
            id: { [Op.ne]: memberId },
          },
        });

        if (otherAdmins === 0) {
          return res.status(400).json({
            error: "Impossible de suspendre : aucun autre administrateur actif",
            code: "LAST_ADMIN_PROTECTION",
          });
        }
      }

      // Vérifier section si fournie
      if (sectionId) {
        const sectionExists = await Section.findOne({
          where: { id: sectionId, associationId },
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

      if (memberType !== undefined) {
        const memberTypesConfig = membership.association.memberTypes || [];
        const memberTypeExists = memberTypesConfig.find((t) => t.name === memberType);

        if (!memberTypeExists) {
          return res.status(400).json({
            error: "Type de membre invalide",
            code: "INVALID_MEMBER_TYPE",
            available: memberTypesConfig.map((t) => t.name),
          });
        }

        updateData.memberType = memberType;
        if (cotisationAmount === undefined) {
          updateData.cotisationAmount = memberTypeExists.cotisationAmount;
        }
      }

      if (status !== undefined) updateData.status = status;
      if (sectionId !== undefined) updateData.sectionId = sectionId;
      if (cotisationAmount !== undefined) updateData.cotisationAmount = cotisationAmount;
      if (autoPaymentEnabled !== undefined) updateData.autoPaymentEnabled = autoPaymentEnabled;
      if (paymentMethodId !== undefined) updateData.paymentMethodId = paymentMethodId;

      // Valider et mettre à jour les rôles
      if (assignedRoles !== undefined) {
        const rolesConfig = membership.association.rolesConfiguration?.roles || [];
        const invalidRoles = assignedRoles.filter(
          (roleId) => !rolesConfig.find((r) => r.id === roleId)
        );

        if (invalidRoles.length > 0) {
          return res.status(400).json({
            error: "Rôles invalides",
            code: "INVALID_ROLES",
            invalidRoles,
            availableRoles: rolesConfig.map((r) => ({ id: r.id, name: r.name })),
          });
        }

        updateData.assignedRoles = assignedRoles;
      }

      // Mettre à jour le membre
      await memberToUpdate.update(updateData);

      // Charger membre mis à jour
      const updatedMember = await AssociationMember.findByPk(memberToUpdate.id, {
        include: [
          {
            model: User,
            as: "user",
            attributes: [
              "id",
              "firstName",
              "lastName",
              "phoneNumber",
              "email",
              "profilePicture",
            ],
          },
          {
            model: Section,
            as: "section",
            attributes: ["id", "name", "country"],
          },
        ],
      });

      res.json({
        success: true,
        message: "Membre mis à jour avec succès",
        data: { member: updatedMember },
      });
    } catch (error) {
      console.error("❌ Erreur modification membre:", error);
      res.status(500).json({
        error: "Erreur modification membre",
        code: "UPDATE_MEMBER_ERROR",
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
      include: [
        {
          model: Association,
          as: "association",
          attributes: ["rolesConfiguration"],
        },
      ],
    });

    const canViewMembers =
      membership?.isAdmin ||
      hasPermission(membership, "view_members") ||
      req.user.role === "super_admin";

    if (!canViewMembers) {
      return res.status(403).json({
        error: "Permission insuffisante pour voir les membres",
        code: "VIEW_MEMBERS_DENIED",
        required: "view_members",
      });
    }

    // ✅ Filtrer UNIQUEMENT les membres réels (isMemberOfAssociation: true)
    const whereClause = {
      associationId,
      isMemberOfAssociation: true, // ✅ Exclut les admins externes
    };

    if (sectionId) whereClause.sectionId = sectionId;
    if (status !== "all") whereClause.status = status;
    if (memberType) whereClause.memberType = memberType;

    const offset = (page - 1) * limit;

    const includes = [
      {
        model: User,
        as: "user",
        attributes: [
          "id",
          "firstName",
          "lastName",
          "phoneNumber",
          "email",
        ],
        ...(search && {
          where: {
            [Op.or]: [
              { firstName: { [Op.iLike]: `%${search}%` } },
              { lastName: { [Op.iLike]: `%${search}%` } },
              { phoneNumber: { [Op.iLike]: `%${search}%` } },
            ],
          },
        }),
      },
      {
        model: Section,
        as: "section",
        attributes: ["id", "name", "country", "city"],
        required: false,
      },
    ];

    const { rows: members, count } = await AssociationMember.findAndCountAll({
      where: whereClause,
      include: includes,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["joinDate", "DESC"]],
    });

    res.json({
      success: true,
      data: {
        members,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(count / limit),
        },
      },
    });
  } catch (error) {
    console.error("❌ Erreur liste membres:", error);
    res.status(500).json({
      error: "Erreur liste membres",
      code: "LIST_MEMBERS_ERROR",
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
            allow_redirects: "never",
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
        await transaction.update({
          status: "failed",
          failureReason: stripeError.message.substring(0, 250),
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

      console.log("🔍 Récupération cotisations:", {
        associationId,
        memberId,
        year,
      });

      // Vérifier accès (le membre lui-même ou bureau)
      const [targetMember, requesterMembership] = await Promise.all([
        AssociationMember.findOne({
          where: { id: memberId, associationId },
          include: [
            {
              model: User,
              as: "user",
              attributes: ["id", "firstName", "lastName", "phoneNumber"],
            },
            {
              model: Association,
              as: "association",
              attributes: ['rolesConfiguration']
            }
          ],
        }),
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
      ]);

      if (!targetMember) {
        return res.status(404).json({
          error: "Membre introuvable",
          code: "MEMBER_NOT_FOUND",
        });
      }

      // Vérifier permissions
      const isOwnData = targetMember.userId === req.user.id;

      // ✅ NOUVEAU : Vérifier permissions avec RBAC moderne
      const canViewFinances =
        requesterMembership?.isAdmin ||
        hasPermission(requesterMembership, "view_finances") ||
        req.user.role === "super_admin";

      if (!isOwnData && !canViewFinances) {
        return res.status(403).json({
          error: "Accès non autorisé aux données financières",
          code: "FINANCIAL_DATA_ACCESS_DENIED",
          required: "view_finances",
        });
      }

      // Construire filtres
      const whereClause = {
        memberId: parseInt(memberId),
        type: "cotisation",
      };

      if (year) {
        whereClause.year = parseInt(year);
      }

      console.log("🎯 Filtres whereClause:", whereClause);

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
          "description",
        ],
        limit: parseInt(limit),
        order: [
          ["year", "DESC"],
          ["month", "DESC"],
        ],
      });

      console.log(
        `✅ Trouvé ${cotisations.length} cotisations pour membre ${memberId}`
      );

      // Calculer statistiques
      const completedCotisations = cotisations.filter(
        (c) => c.status === "completed"
      );

      const stats = {
        total: cotisations.length,
        completed: completedCotisations.length,
        pending: cotisations.filter((c) => c.status === "pending").length,
        failed: cotisations.filter((c) => c.status === "failed").length,
        totalPaid: completedCotisations.reduce(
          (sum, c) => sum + parseFloat(c.amount || 0),
          0
        ),
        totalCommissions: completedCotisations.reduce(
          (sum, c) => sum + parseFloat(c.commissionAmount || 0),
          0
        ),
        totalNet: completedCotisations.reduce(
          (sum, c) => sum + parseFloat(c.netAmount || 0),
          0
        ),
      };

      // Grouper par année/mois
      const byPeriod = {};
      cotisations.forEach((cotisation) => {
        const key = `${cotisation.year}-${cotisation.month
          .toString()
          .padStart(2, "0")}`;
        if (!byPeriod[key]) {
          byPeriod[key] = {
            year: cotisation.year,
            month: cotisation.month,
            cotisations: [],
            totalAmount: 0,
            status: "incomplete",
          };
        }
        byPeriod[key].cotisations.push(cotisation);
        if (cotisation.status === "completed") {
          byPeriod[key].totalAmount += parseFloat(cotisation.amount || 0);
          byPeriod[key].status = "completed";
        }
      });

      res.json({
        success: true,
        data: {
          member: {
            id: targetMember.id,
            user: {
              id: targetMember.user.id,
              firstName: targetMember.user.firstName,
              lastName: targetMember.user.lastName,
              fullName: `${targetMember.user.firstName} ${targetMember.user.lastName}`,
              phoneNumber: targetMember.user.phoneNumber,
            },
            memberType: targetMember.memberType,
            cotisationAmount: targetMember.cotisationAmount,
          },
          cotisations,
          stats,
          byPeriod: Object.values(byPeriod).sort((a, b) => {
            if (a.year !== b.year) return b.year - a.year;
            return b.month - a.month;
          }),
          filters: { year, limit },
        },
      });
    } catch (error) {
      console.error("❌ Erreur récupération historique cotisations:", error);
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

  // ... (le reste des méthodes reste identique)

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
        include: [
          {
            model: Association,
            as: "association",
            attributes: ["rolesConfiguration"],
          },
        ],
      });

      const canViewMember =
        membership?.isAdmin ||
        hasPermission(membership, "view_members") ||
        req.user.id === membership?.userId ||
        req.user.role === "super_admin";

      if (!canViewMember) {
        return res.status(403).json({
          error: "Permission insuffisante",
          code: "VIEW_MEMBER_DENIED",
        });
      }

      const member = await AssociationMember.findOne({
        where: {
          id: memberId,
          associationId,
        },
        include: [
          {
            model: User,
            as: "user",
            attributes: [
              "id",
              "firstName",
              "lastName",
              "phoneNumber",
              "email",
              "dateOfBirth",
              "gender",
              "address",
              "city",
              "country",
              "postalCode",
              "profilePicture",
            ],
          },
          {
            model: Section,
            as: "section",
            attributes: ["id", "name", "country", "city"],
          },
          {
            model: Association,
            as: "association",
            attributes: ["id", "name", "rolesConfiguration"],
          },
        ],
      });

      if (!member) {
        return res.status(404).json({
          error: "Membre introuvable",
          code: "MEMBER_NOT_FOUND",
        });
      }

      // Calculer permissions effectives
      const effectivePermissions = getEffectivePermissions(member);

      res.json({
        success: true,
        data: {
          member,
          effectivePermissions,
        },
      });
    } catch (error) {
      console.error("❌ Erreur détails membre:", error);
      res.status(500).json({
        error: "Erreur détails membre",
        code: "GET_MEMBER_ERROR",
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
      const { page = 1, limit = 50 } = req.query;

      // Vérifier accès
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

      const canViewMembers =
        membership?.isAdmin ||
        hasPermission(membership, "view_members") ||
        req.user.role === "super_admin";

      if (!canViewMembers) {
        return res.status(403).json({
          error: "Permission insuffisante",
          code: "VIEW_MEMBERS_DENIED",
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

      const offset = (page - 1) * limit;

      const { count, rows: members } = await AssociationMember.findAndCountAll({
        where: {
          associationId,
          sectionId,
          isMemberOfAssociation: true, // ✅ Membres réels uniquement
          status: "active",
        },
        include: [
          {
            model: User,
            as: "user",
            attributes: [
              "id",
              "firstName",
              "lastName",
              "phoneNumber",
              "email",
              "profilePicture",
            ],
          },
        ],
        order: [["joinDate", "DESC"]],
        limit: parseInt(limit),
        offset: parseInt(offset),
      });

      res.json({
        success: true,
        data: {
          section,
          members,
          pagination: {
            total: count,
            page: parseInt(page),
            limit: parseInt(limit),
            pages: Math.ceil(count / limit),
          },
        },
      });
    } catch (error) {
      console.error("❌ Erreur membres section:", error);
      res.status(500).json({
        error: "Erreur membres section",
        code: "SECTION_MEMBERS_ERROR",
        details: error.message,
      });
    }
  }

  async getCotisationsDashboard(req, res) {
    try {
      const { associationId } = req.params;
      const {
        month = new Date().getMonth() + 1,
        year = new Date().getFullYear(),
        sectionId,
        memberType,
        status,
      } = req.query;

      console.log("🔍 Dashboard cotisations:", {
        associationId,
        month,
        year,
        sectionId,
      });

      // Vérifier permissions
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
      });

      const canViewCotisations =
        membership?.roles?.includes("admin_association") ||
        membership?.roles?.includes("president") ||
        membership?.roles?.includes("tresorier") ||
        req.user.role === "super_admin";

      if (!canViewCotisations) {
        return res.status(403).json({
          error: "Permission insuffisante pour voir les cotisations",
          code: "COTISATIONS_ACCESS_DENIED",
        });
      }

      // Récupérer l'association avec ses configurations
      const association = await Association.findByPk(associationId, {
        include: [
          {
            model: Section,
            as: "sections",
            attributes: ["id", "name", "country", "city"],
          },
        ],
      });

      if (!association) {
        return res.status(404).json({
          error: "Association introuvable",
          code: "ASSOCIATION_NOT_FOUND",
        });
      }

      // 1. Récupérer tous les membres actifs SANS les transactions
      const memberFilters = {
        associationId,
        status: "active",
      };

      if (sectionId) memberFilters.sectionId = sectionId;
      if (memberType) memberFilters.memberType = memberType;

      const members = await AssociationMember.findAll({
        where: memberFilters,
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
            required: false,
          },
        ],
      });

      console.log(`✅ Trouvé ${members.length} membres actifs`);

      // 2. Récupérer SÉPARÉMENT les transactions pour la période
      const transactionsFilters = {
        associationId,
        type: "cotisation",
        month: parseInt(month),
        year: parseInt(year),
      };

      if (sectionId) transactionsFilters.sectionId = sectionId;

      const transactions = await Transaction.findAll({
        where: transactionsFilters,
        attributes: [
          "id",
          "amount",
          "status",
          "memberId",
          "paymentMethod",
          "created_at",
          "completedAt",
        ],
        include: [
          {
            model: AssociationMember,
            as: "member",
            attributes: ["id", "userId"],
            include: [
              {
                model: User,
                as: "user",
                attributes: ["id", "firstName", "lastName"],
              },
            ],
          },
        ],
      });

      console.log(
        `✅ Trouvé ${transactions.length} transactions pour ${month}/${year}`
      );

      // 3. Créer un Map des transactions par memberId
      const transactionsMap = new Map();
      transactions.forEach((transaction) => {
        if (!transactionsMap.has(transaction.memberId)) {
          transactionsMap.set(transaction.memberId, []);
        }
        transactionsMap.get(transaction.memberId).push(transaction);
      });

      // 4. Calculer les statistiques pour chaque membre
      let totalExpected = 0;
      let totalCollected = 0;
      let totalPending = 0;
      const statusCounts = {
        paid: 0,
        pending: 0,
        late: 0,
        very_late: 0,
      };

      const membersWithStatus = members.map((member) => {
        // Récupérer montant attendu selon le type de membre
        const memberTypeConfig = association.memberTypes?.find(
          (type) => type.name === member.memberType
        );
        const expectedAmount = memberTypeConfig?.cotisationAmount || 0;
        totalExpected += expectedAmount;

        // Récupérer les transactions du membre pour cette période
        const memberTransactions = transactionsMap.get(member.id) || [];

        // Vérifier si le membre a payé ce mois
        const completedPayment = memberTransactions.find(
          (t) => t.status === "completed"
        );
        const pendingPayment = memberTransactions.find(
          (t) => t.status === "pending"
        ); // ✅ AJOUTER CETTE LIGNE

        const paidAmount = completedPayment
          ? parseFloat(completedPayment.amount)
          : 0;

        if (paidAmount > 0) {
          totalCollected += paidAmount;
        } else {
          totalPending += expectedAmount;
        }

        // Calculer le retard
        const now = new Date();
        const deadlineDate = new Date(year, month - 1, 5); // 5ème jour du mois
        const daysSinceDeadline = Math.floor(
          (now - deadlineDate) / (1000 * 60 * 60 * 24)
        );

        let cotisationStatus = "paid";
        if (!completedPayment) {
          if (daysSinceDeadline > 60) {
            cotisationStatus = "very_late";
          } else if (daysSinceDeadline > 30) {
            cotisationStatus = "late";
          } else {
            cotisationStatus = "pending";
          }
        }

        statusCounts[cotisationStatus]++;

        return {
          id: member.id,
          userId: member.userId,
          user: {
            id: member.user.id,
            firstName: member.user.firstName,
            lastName: member.user.lastName,
            phoneNumber: member.user.phoneNumber,
            email: member.user.email,
          },
          memberType: member.memberType,
          section: member.section
            ? {
                id: member.section.id,
                name: member.section.name,
                country: member.section.country,
                city: member.section.city,
              }
            : null,
          expectedAmount,
          paidAmount,
          paymentMethod: completedPayment?.paymentMethod || null,
          cotisationStatus,
          hasPendingValidation: !!pendingPayment, // ✅ AJOUTER CETTE LIGNE
          paymentDate: completedPayment?.completedAt || null,
          daysSinceDeadline: Math.max(0, daysSinceDeadline),
          joinDate: member.joinDate,
          roles: member.roles || [],
        };
      });

      // 5. Filtrer par statut si demandé
      let filteredMembers = membersWithStatus;
      if (status && status !== "all") {
        filteredMembers = membersWithStatus.filter(
          (member) => member.cotisationStatus === status
        );
      }

      // 6. Calculer les KPIs
      const collectionRate =
        totalExpected > 0
          ? Math.round((totalCollected / totalExpected) * 100)
          : 0;

      // 7. Statistiques par section
      const sectionStats =
        association.sections?.map((section) => {
          const sectionMembers = membersWithStatus.filter(
            (m) => m.section?.id === section.id
          );
          const sectionExpected = sectionMembers.reduce(
            (sum, m) => sum + m.expectedAmount,
            0
          );
          const sectionCollected = sectionMembers.reduce(
            (sum, m) => sum + m.paidAmount,
            0
          );

          return {
            section: {
              id: section.id,
              name: section.name,
              country: section.country,
              city: section.city,
            },
            membersCount: sectionMembers.length,
            expectedAmount: sectionExpected,
            collectedAmount: sectionCollected,
            collectionRate:
              sectionExpected > 0
                ? Math.round((sectionCollected / sectionExpected) * 100)
                : 0,
          };
        }) || [];

      // Ajouter les membres sans section (association centrale)
      const centralMembers = membersWithStatus.filter((m) => !m.section);
      if (centralMembers.length > 0) {
        const centralExpected = centralMembers.reduce(
          (sum, m) => sum + m.expectedAmount,
          0
        );
        const centralCollected = centralMembers.reduce(
          (sum, m) => sum + m.paidAmount,
          0
        );

        sectionStats.unshift({
          section: {
            id: null,
            name: "Association Centrale",
            country: null,
            city: null,
          },
          membersCount: centralMembers.length,
          expectedAmount: centralExpected,
          collectedAmount: centralCollected,
          collectionRate:
            centralExpected > 0
              ? Math.round((centralCollected / centralExpected) * 100)
              : 0,
        });
      }

      // 8. Statistiques par type de membre
      const memberTypeStats = Object.entries(
        membersWithStatus.reduce((acc, member) => {
          if (!acc[member.memberType]) {
            acc[member.memberType] = {
              count: 0,
              expected: 0,
              collected: 0,
            };
          }
          acc[member.memberType].count++;
          acc[member.memberType].expected += member.expectedAmount;
          acc[member.memberType].collected += member.paidAmount;
          return acc;
        }, {})
      ).map(([type, stats]) => ({
        memberType: type,
        membersCount: stats.count,
        expectedAmount: stats.expected,
        collectedAmount: stats.collected,
        collectionRate:
          stats.expected > 0
            ? Math.round((stats.collected / stats.expected) * 100)
            : 0,
      }));

      console.log("📊 KPIs calculés:", {
        totalExpected,
        totalCollected,
        collectionRate,
        statusCounts,
      });

      res.json({
        success: true,
        data: {
          period: {
            month: parseInt(month),
            year: parseInt(year),
            monthName: new Date(year, month - 1).toLocaleDateString("fr-FR", {
              month: "long",
            }),
          },
          kpis: {
            totalExpected,
            totalCollected,
            totalPending,
            collectionRate,
            membersCount: membersWithStatus.length,
            ...statusCounts,
          },
          members: filteredMembers,
          statistics: {
            bySections: sectionStats,
            byMemberTypes: memberTypeStats,
          },
          filters: {
            month: parseInt(month),
            year: parseInt(year),
            sectionId: sectionId || null,
            memberType: memberType || null,
            status: status || "all",
          },
        },
      });
    } catch (error) {
      console.error("❌ Erreur dashboard cotisations:", error);
      res.status(500).json({
        error: "Erreur récupération dashboard cotisations",
        code: "COTISATIONS_DASHBOARD_ERROR",
        details: error.message,
      });
    }
  }

  async addManualCotisation(req, res) {
    try {
      const { associationId } = req.params;
      const { memberId, amount, month, year, reason, paymentMethod } = req.body;

      // Vérifier permissions (président, secrétaire, trésorier peuvent ajouter)
      const requestorMembership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
      });

      const canAddCotisation =
        requestorMembership?.roles?.includes("admin_association") ||
        requestorMembership?.roles?.includes("president") ||
        requestorMembership?.roles?.includes("secretaire") ||
        requestorMembership?.roles?.includes("tresorier") ||
        req.user.role === "super_admin";

      if (!canAddCotisation) {
        return res.status(403).json({
          error: "Permission insuffisante pour ajouter une cotisation",
          code: "ADD_COTISATION_DENIED",
        });
      }

      // Récupérer le membre cible avec ses infos
      const targetMember = await AssociationMember.findOne({
        where: {
          id: memberId,
          associationId,
          status: "active",
        },
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "firstName", "lastName", "phoneNumber"],
          },
          {
            model: Section,
            as: "section",
            attributes: ["id", "name"],
          },
        ],
      });

      if (!targetMember) {
        return res.status(404).json({
          error: "Membre introuvable",
          code: "MEMBER_NOT_FOUND",
        });
      }

      // Récupérer l'association pour connaître sa structure
      const association = await Association.findByPk(associationId);
      if (!association) {
        return res.status(404).json({
          error: "Association introuvable",
          code: "ASSOCIATION_NOT_FOUND",
        });
      }

      // Vérifier qu'une cotisation n'existe pas déjà pour cette période
      const existingCotisation = await Transaction.findOne({
        where: {
          associationId,
          memberId: targetMember.id,
          type: "cotisation",
          month: parseInt(month),
          year: parseInt(year),
          status: ["completed", "pending", "processing"],
        },
      });

      if (existingCotisation) {
        return res.status(400).json({
          error: `Une cotisation existe déjà pour ${month}/${year}`,
          code: "COTISATION_ALREADY_EXISTS",
        });
      }

      // Déterminer le statut initial et qui doit valider
      let initialStatus = "pending";
      let validatorInfo = null;
      let requiresApproval = true;

      // Auto-validation si c'est le trésorier qui ajoute
      const isRequestorTreasurer =
        requestorMembership?.roles?.includes("tresorier");

      if (isRequestorTreasurer) {
        initialStatus = "completed";
        requiresApproval = false;
        validatorInfo = {
          approvedBy: req.user.id,
          approvedAt: new Date(),
          validatorRole: "tresorier",
        };
      } else {
        // Déterminer qui peut valider selon la structure
        if (association.isMultiSection && targetMember.sectionId) {
          // Association multi-sections : trésorier de section OU bureau central
          const sectionTreasurers = await AssociationMember.findAll({
            where: {
              associationId,
              sectionId: targetMember.sectionId,
              status: "active",
              [Op.and]: [
                sequelize.literal(
                  `roles::jsonb @> '["tresorier_section"]'::jsonb`
                ),
              ],
            },
            include: [
              {
                model: User,
                as: "user",
                attributes: ["firstName", "lastName"],
              },
            ],
          });

          const centralTreasurers = await AssociationMember.findAll({
            where: {
              associationId,
              status: "active",
              [Op.and]: [
                sequelize.literal(`roles::jsonb @> '["tresorier"]'::jsonb`),
              ],
            },
            include: [
              {
                model: User,
                as: "user",
                attributes: ["firstName", "lastName"],
              },
            ],
          });

          validatorInfo = {
            sectionValidators: sectionTreasurers,
            centralValidators: centralTreasurers,
          };
        } else {
          // Association simple : trésorier central uniquement
          const treasurers = await AssociationMember.findAll({
            where: {
              associationId,
              status: "active",
              [Op.and]: [
                sequelize.literal(`roles::jsonb @> '["tresorier"]'::jsonb`),
              ],
            },
            include: [
              {
                model: User,
                as: "user",
                attributes: ["firstName", "lastName"],
              },
            ],
          });

          validatorInfo = {
            validators: treasurers,
          };
        }
      }

      // ✅ LOGIQUE COMMISSION CORRIGÉE
      // Commission UNIQUEMENT pour les paiements par carte (frais PSP)
      let commissionAmount = 0;
      let netAmount = parseFloat(amount);

      if (paymentMethod === "card") {
        commissionAmount = parseFloat((amount * 0.025 + 0.25).toFixed(2));
        netAmount = parseFloat((amount - commissionAmount).toFixed(2));
      }
      // Pour cash, check, bank_transfer : pas de commission

      console.log("💰 Commission calculée:", {
        paymentMethod,
        amount: parseFloat(amount),
        commissionAmount,
        netAmount,
      });

      // Créer la transaction
      const transaction = await Transaction.create({
        userId: targetMember.userId,
        associationId,
        sectionId: targetMember.sectionId,
        memberId: targetMember.id,
        type: "cotisation",
        amount: parseFloat(amount),
        commissionAmount,
        netAmount,
        currency: "EUR",
        month: parseInt(month),
        year: parseInt(year),
        paymentMethod,
        status: initialStatus,
        description: reason,
        source: "manual",
        addedBy: req.user.id,
        addedByRole: requestorMembership?.roles?.[0] || "member",
        ...(validatorInfo?.approvedBy && {
          approvedBy: validatorInfo.approvedBy,
          approvedAt: validatorInfo.approvedAt,
          completedAt: validatorInfo.approvedAt,
          processedAt: validatorInfo.approvedAt,
        }),
      });

      // Si validé directement, mettre à jour les stats du membre
      if (initialStatus === "completed") {
        await targetMember.update({
          totalContributed:
            parseFloat(targetMember.totalContributed || "0") +
            parseFloat(amount),
          lastContributionDate: new Date(),
          contributionStatus: "uptodate",
        });
      }

      // Préparer les notifications (à implémenter)
      let notificationMessage = "";
      if (initialStatus === "completed") {
        notificationMessage = `Cotisation de ${amount}€ ajoutée et validée pour ${targetMember.user.firstName} ${targetMember.user.lastName}`;
      } else {
        notificationMessage = `Nouvelle cotisation en attente de validation : ${amount}€ pour ${targetMember.user.firstName} ${targetMember.user.lastName}`;
      }

      res.json({
        success: true,
        message:
          initialStatus === "completed"
            ? "Cotisation ajoutée et validée avec succès"
            : "Cotisation ajoutée - en attente de validation",
        data: {
          transaction: {
            id: transaction.id,
            amount: parseFloat(amount),
            commissionAmount,
            netAmount,
            month: parseInt(month),
            year: parseInt(year),
            status: initialStatus,
            paymentMethod,
            reason,
          },
          member: {
            id: targetMember.id,
            name: `${targetMember.user.firstName} ${targetMember.user.lastName}`,
            section: targetMember.section?.name,
          },
          validation: {
            required: requiresApproval,
            autoValidated: initialStatus === "completed",
            validators: validatorInfo,
          },
          notification: notificationMessage,
        },
      });
    } catch (error) {
      console.error("Erreur ajout cotisation manuelle:", error);
      res.status(500).json({
        error: "Erreur ajout cotisation manuelle",
        code: "MANUAL_COTISATION_ERROR",
        details: error.message,
      });
    }
  }
}

module.exports = new MemberController();