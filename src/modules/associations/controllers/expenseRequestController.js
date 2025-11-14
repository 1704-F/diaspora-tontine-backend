// src/modules/associations/controllers/expenseRequestController.js

const { Op } = require("sequelize");
const {
  ExpenseRequest,
  LoanRepayment,
  Association,
  User,
  Section,
  Transaction,
  Document,
  AssociationMember,
  AuditLog,
  sequelize,
} = require("../../../models");
const AssociationBalanceService = require("../services/associationBalanceService");

// ✅ NOUVEAU : Import système RBAC moderne
const {
  hasPermission,
  getEffectivePermissions,
} = require("../../../core/middleware/checkPermission");

class ExpenseRequestController {
  /**
   * 📝 Créer nouvelle demande de dépense
   */
  async createExpenseRequest(req, res) {
    const transaction = await sequelize.transaction();

    try {
      const { associationId } = req.params;
      const requesterId = req.user.id;
      const {
        expenseType,
        title,
        description,
        amountRequested,
        currency,
        urgencyLevel,
        beneficiaryId,
        beneficiaryExternal,
        expectedImpact,
        actualImpact,
        isLoan,
        loanTerms,
        expenseSubtype,
        documents,
        externalReferences,
      } = req.body;

      // ✅ 1. VÉRIFIER L'ASSOCIATION EXISTE
      const association = await Association.findByPk(associationId);

      if (!association) {
        await transaction.rollback();
        return res.status(404).json({
          error: "Association non trouvée",
          code: "ASSOCIATION_NOT_FOUND",
        });
      }

      // ✅ 2. VÉRIFICATION DES FONDS DISPONIBLES
      const fundsCheck = await AssociationBalanceService.checkSufficientFunds(
        parseInt(associationId),
        parseFloat(amountRequested)
      );

      // ⚠️ AVERTISSEMENT si fonds insuffisants (mais on crée quand même la demande)
      // La demande sera en "pending" et devra être approuvée par le bureau
      if (!fundsCheck.sufficient) {
        console.warn(
          `⚠️ Demande créée avec fonds insuffisants. ` +
            `Requis: ${amountRequested} ${
              currency || association.primaryCurrency
            }, ` +
            `Disponible: ${fundsCheck.availableBalance}, ` +
            `Manquant: ${fundsCheck.shortage}`
        );
      }

      // ✅ 3. VALIDATION MEMBRE ACTIF
      const membership = await AssociationMember.findOne({
        where: {
          associationId: parseInt(associationId),
          userId: requesterId,
          status: "active",
        },
        transaction,
      });

      if (!membership) {
        await transaction.rollback();
        return res.status(403).json({
          error: "Vous devez être membre actif pour créer une demande",
          code: "MEMBERSHIP_REQUIRED",
        });
      }

      // ✅ 4. CONSTRUCTION DU PAYLOAD
      const payload = {
        associationId: parseInt(associationId),
        requesterId,
        expenseType,
        title: title.trim(),
        description: description.trim(),
        amountRequested: parseFloat(amountRequested),
        currency: currency || association.primaryCurrency,
        urgencyLevel: urgencyLevel || "normal",
        status: "pending",
        isLoan: isLoan || false,
        beneficiaryId: beneficiaryId ? parseInt(beneficiaryId) : null,
        beneficiaryExternal: beneficiaryExternal || null,
        expectedImpact: expectedImpact?.trim() || null,
        actualImpact: actualImpact?.trim() || null,
        expenseSubtype: expenseSubtype?.trim() || null,
        loanTerms: isLoan && loanTerms ? loanTerms : null,
        documents: documents || [],
        externalReferences: externalReferences || {},

        // ✅ MÉTADONNÉES : Vérification des fonds au moment de la création
        metadata: {
          fundsCheckAtCreation: {
            sufficient: fundsCheck.sufficient,
            availableBalance: fundsCheck.availableBalance,
            requestedAmount: fundsCheck.requestedAmount,
            shortage: fundsCheck.shortage,
            checkedAt: new Date().toISOString(),
          },
        },
      };

      // ✅ 5. CRÉATION DE LA DEMANDE
      const expenseRequest = await ExpenseRequest.create(payload, {
        transaction,
      });

      /* TEMPORAIREMENT DÉSACTIVÉ - Modèle AuditLog manquant

      // ✅ 6. LOG D'AUDIT
      try {
        
        await AuditLog.create(
          {
            userId: requesterId,
            associationId: parseInt(associationId),
            action: "expense_request_created",
            entityType: "ExpenseRequest",
            entityId: expenseRequest.id,
            details: {
              expenseType,
              amountRequested: parseFloat(amountRequested),
              currency: payload.currency,
              title,
              fundsAvailable: fundsCheck.sufficient,
              insufficientFunds: !fundsCheck.sufficient,
            },
          },
          { transaction }
        );
      } catch (auditError) {
        console.warn("⚠️ Erreur log audit (non bloquant):", auditError.message);
        // On ne bloque pas la création si l'audit échoue
      }

      */

      await transaction.commit();

      // ✅ 7. RÉPONSE AVEC AVERTISSEMENT SI FONDS INSUFFISANTS
      return res.status(201).json({
  success: true,  // ✅ AJOUT
  message: "Demande de dépense créée avec succès",
  data: {
    expense: expenseRequest,  // ✅ RENOMMAGE expense au lieu de expenseRequest
    fundsWarning: !fundsCheck.sufficient
      ? {
          message: "Attention : Les fonds actuels sont insuffisants pour couvrir cette demande",
          currentBalance: fundsCheck.availableBalance,
          requiredAmount: fundsCheck.requestedAmount,
          shortfall: fundsCheck.shortage,
          currency: payload.currency,
        }
      : null,
  },
});
    } catch (error) {
      await transaction.rollback();
      console.error("❌ Erreur création demande dépense:", error);

      return res.status(500).json({
        error: "Erreur lors de la création de la demande",
        code: "CREATE_EXPENSE_REQUEST_ERROR",
        details:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  }

  /**
   * 📋 Lister demandes de dépenses avec filtres
   */
  async getExpenseRequests(req, res) {
    try {
      const { associationId } = req.params;
      const userId = req.user.id;
      const membership = req.membership;

      const {
        status,
        expenseType,
        requesterId,
        beneficiaryId,
        minAmount,
        maxAmount,
        dateFrom,
        dateTo,
        urgencyLevel,
        isLoan,
        page = 1,
        limit = 20,
        sortBy = "created_at",
        sortOrder = "DESC",
      } = req.query;

      // ✅ AJOUTER CE MAPPING
      const columnMapping = {
        createdAt: "created_at",
        created_at: "created_at",
        amountRequested: "amount_requested",
        urgencyLevel: "urgency_level",
        status: "status",
        approvedAt: "approved_at",
      };

      const sortColumn = columnMapping[sortBy] || "created_at";

      // ✅ NOUVEAU : Contrôle accès avec RBAC moderne
      const isAdmin = membership?.isAdmin || false;
      const canViewAll =
        isAdmin ||
        hasPermission(membership, "view_finances") ||
        req.user?.role === "super_admin";

      // 🔍 CONSTRUCTION FILTRES
      let whereClause = {
        associationId: parseInt(associationId),
      };

      // Si pas de droits complets, voir seulement ses demandes
      if (!canViewAll) {
        whereClause[Op.or] = [
          { requesterId: userId },
          { beneficiaryId: userId },
        ];
      }

      // Filtres optionnels
      if (status) whereClause.status = status;
      if (expenseType) whereClause.expenseType = expenseType;
      if (requesterId) whereClause.requesterId = parseInt(requesterId);
      if (beneficiaryId) whereClause.beneficiaryId = parseInt(beneficiaryId);
      if (urgencyLevel) whereClause.urgencyLevel = urgencyLevel;
      if (isLoan !== undefined) whereClause.isLoan = isLoan === "true";

      // Filtres montant
      if (minAmount) {
        whereClause.amountRequested = {
          [Op.gte]: parseFloat(minAmount),
        };
      }
      if (maxAmount) {
        whereClause.amountRequested = {
          ...whereClause.amountRequested,
          [Op.lte]: parseFloat(maxAmount),
        };
      }

      // Filtres date
      if (dateFrom || dateTo) {
        whereClause.created_at = {};
        if (dateFrom) whereClause.created_at[Op.gte] = new Date(dateFrom);
        if (dateTo) whereClause.created_at[Op.lte] = new Date(dateTo);
      }

      // 📊 EXÉCUTION REQUÊTE AVEC PAGINATION
      const offset = (parseInt(page) - 1) * parseInt(limit);

      const { count, rows } = await ExpenseRequest.findAndCountAll({
        where: whereClause,
        include: [
          {
            model: User,
            as: "requester",
            attributes: ["id", "firstName", "lastName"],
          },
          {
            model: User,
            as: "beneficiary",
            attributes: ["id", "firstName", "lastName"],
          },
          {
            model: Section,
            as: "section",
            attributes: ["id", "name"],
          },
        ],
        order: [[sortColumn, sortOrder.toUpperCase()]],
        limit: parseInt(limit),
        offset,
      });

      // 📈 ENRICHIR AVEC PROGRESS VALIDATION
      const enrichedRows = rows.map((request) => ({
        ...request.toJSON(),
        validationProgress: request.getValidationProgress(),
        canModify:
          request.canBeModified() &&
          (request.requesterId === userId || canViewAll),
      }));

      console.log("🔍 Debug getExpenseRequests:");
      console.log("   associationId:", associationId);
      console.log("   userId:", userId);
      console.log("   isAdmin:", isAdmin);
      console.log("   canViewAll:", canViewAll);
      console.log("   whereClause:", whereClause);

      res.json({
        expenseRequests: enrichedRows,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(count / parseInt(limit)),
          totalItems: count,
          itemsPerPage: parseInt(limit),
        },
        filters: {
          applied: Object.keys(req.query).length > 0,
          canViewAll,
        },
      });
    } catch (error) {
      console.error("Erreur liste demandes dépenses:", error);
      res.status(500).json({
        error: "Erreur lors de la récupération des demandes",
      });
    }
  }

  /**
   * 🔍 Détails d'une demande spécifique
   */
  async getExpenseRequestDetails(req, res) {
    try {
      const { associationId, requestId } = req.params;
      const userId = req.user.id;
      const membership = req.membership;

      const expenseRequest = await ExpenseRequest.findOne({
        where: {
          id: parseInt(requestId),
          associationId: parseInt(associationId),
        },
        include: [
          {
            model: User,
            as: "requester",
            attributes: ["id", "firstName", "lastName"],
          },
          {
            model: User,
            as: "beneficiary",
            attributes: ["id", "firstName", "lastName"],
          },
          {
            model: User,
            as: "paymentValidator",
            attributes: ["id", "firstName", "lastName"],
          },
          {
            model: Association,
            as: "association",
            attributes: ["id", "name"],
          },
          {
            model: Section,
            as: "section",
            attributes: ["id", "name"],
          },
          {
            model: Transaction,
            as: "transaction",
            attributes: ["id", "amount", "status", "created_at"],
          },
        ],
      });

      if (!expenseRequest) {
        return res.status(404).json({
          error: "Demande non trouvée",
          code: "EXPENSE_REQUEST_NOT_FOUND",
        });
      }

      // ✅ NOUVEAU : Contrôle accès avec RBAC moderne
      const canViewAll =
        membership?.isAdmin ||
        hasPermission(membership, "view_finances") ||
        req.user?.role === "super_admin";

      const isRequester = expenseRequest.requesterId === userId;
      const isBeneficiary = expenseRequest.beneficiaryId === userId;

      if (!canViewAll && !isRequester && !isBeneficiary) {
        return res.status(403).json({
          error: "Accès refusé à cette demande",
          code: "ACCESS_DENIED",
        });
      }

      // 🔄 HISTORIQUE REMBOURSEMENTS SI PRÊT
      let repayments = [];
      if (expenseRequest.isLoan) {
        repayments = await LoanRepayment.findAll({
          where: { expenseRequestId: expenseRequest.id },
          include: [
            {
              model: User,
              as: "validator",
              attributes: ["id", "firstName", "lastName"],
            },
          ],
          order: [["paymentDate", "DESC"]],
        });
      }

      res.json({
        ...expenseRequest.toJSON(),
        validationProgress: expenseRequest.getValidationProgress(),
        canModify:
          expenseRequest.canBeModified() && (isRequester || canViewAll),
        repayments: repayments.map((r) => ({
          id: r.id,
          amount: r.amount,
          paymentDate: r.paymentDate,
          paymentMethod: r.paymentMethod,
          status: r.status,
          validator: r.validator,
          installmentNumber: r.installmentNumber,
          daysLate: r.daysLate,
        })),
      });
    } catch (error) {
      console.error("Erreur détails demande dépense:", error);
      res.status(500).json({
        error: "Erreur lors de la récupération des détails",
      });
    }
  }

  /**
   * ✏️ Modifier demande (avant validation complète)
   */
  async updateExpenseRequest(req, res) {
    try {
      const { associationId, requestId } = req.params;
      const userId = req.user.id;
      const membership = req.membership;

      const expenseRequest = await ExpenseRequest.findOne({
        where: {
          id: parseInt(requestId),
          associationId: parseInt(associationId),
        },
      });

      if (!expenseRequest) {
        return res.status(404).json({
          error: "Demande non trouvée",
          code: "EXPENSE_REQUEST_NOT_FOUND",
        });
      }

      // ✅ NOUVEAU : Contrôle droits modification avec RBAC moderne
      const canManageExpenses =
        membership?.isAdmin || hasPermission(membership, "manage_expenses");

      const isRequester = expenseRequest.requesterId === userId;

      if (!isRequester && !canManageExpenses) {
        return res.status(403).json({
          error: "Droits insuffisants pour modifier cette demande",
          code: "INSUFFICIENT_RIGHTS",
        });
      }

      // ✅ VÉRIFIER SI MODIFIABLE
      if (!expenseRequest.canBeModified()) {
        return res.status(400).json({
          error: "Cette demande ne peut plus être modifiée",
          code: "NOT_MODIFIABLE",
          details: { status: expenseRequest.status },
        });
      }

      // 💰 VÉRIFIER FONDS SI MONTANT MODIFIÉ
      const { amountRequested } = req.body;
      if (
        amountRequested &&
        parseFloat(amountRequested) !==
          parseFloat(expenseRequest.amountRequested)
      ) {
        const fundsCheck = await AssociationBalanceService.checkSufficientFunds(
          parseInt(associationId),
          parseFloat(amountRequested)
        );

        if (!fundsCheck.sufficient) {
          return res.status(400).json({
            error: "Fonds insuffisants pour ce montant",
            code: "INSUFFICIENT_FUNDS",
            details: {
              requested: amountRequested,
              available: fundsCheck.availableBalance,
            },
          });
        }
      }

      // 🔄 MISE À JOUR
      const updatedRequest = await expenseRequest.update(req.body, {
        userId, // Pour audit trail
      });

      // 📊 RECHARGER AVEC RELATIONS
      const finalRequest = await ExpenseRequest.findByPk(updatedRequest.id, {
        include: [
          {
            model: User,
            as: "requester",
            attributes: ["id", "firstName", "lastName"],
          },
          {
            model: User,
            as: "beneficiary",
            attributes: ["id", "firstName", "lastName"],
          },
        ],
      });

      res.json({
        message: "Demande modifiée avec succès",
        expenseRequest: {
          ...finalRequest.toJSON(),
          validationProgress: finalRequest.getValidationProgress(),
        },
      });
    } catch (error) {
      console.error("Erreur modification demande dépense:", error);
      res.status(500).json({
        error: "Erreur lors de la modification",
      });
    }
  }

  /**
   * ❌ Annuler/supprimer demande
   */
  async cancelExpenseRequest(req, res) {
    try {
      const { associationId, requestId } = req.params;
      const userId = req.user.id;
      const membership = req.membership;
      const { reason } = req.body;

      const expenseRequest = await ExpenseRequest.findOne({
        where: {
          id: parseInt(requestId),
          associationId: parseInt(associationId),
        },
      });

      if (!expenseRequest) {
        return res.status(404).json({
          error: "Demande non trouvée",
          code: "EXPENSE_REQUEST_NOT_FOUND",
        });
      }

      // ✅ NOUVEAU : Contrôle droits annulation avec RBAC moderne
      const canManageExpenses =
        membership?.isAdmin || hasPermission(membership, "manage_expenses");

      const isRequester = expenseRequest.requesterId === userId;

      if (!isRequester && !canManageExpenses) {
        return res.status(403).json({
          error: "Droits insuffisants pour annuler cette demande",
          code: "INSUFFICIENT_RIGHTS",
        });
      }

      // ✅ VÉRIFIER SI ANNULABLE
      if (["paid", "cancelled"].includes(expenseRequest.status)) {
        return res.status(400).json({
          error: "Cette demande ne peut pas être annulée",
          code: "NOT_CANCELLABLE",
          details: { status: expenseRequest.status },
        });
      }

      // 🔄 ANNULATION
      await expenseRequest.update(
        {
          status: "cancelled",
          rejectionReason:
            reason ||
            `Annulée par ${isRequester ? "demandeur" : "gestionnaire"}`,
          metadata: {
            ...expenseRequest.metadata,
            cancelledBy: userId,
            cancelledAt: new Date(),
            cancelReason: reason,
          },
        },
        { userId }
      );

      res.json({
        message: "Demande annulée avec succès",
        expenseRequest: {
          id: expenseRequest.id,
          status: "cancelled",
        },
      });
    } catch (error) {
      console.error("Erreur annulation demande dépense:", error);
      res.status(500).json({
        error: "Erreur lors de l'annulation",
      });
    }
  }

  /**
   * ✅ Approuver une demande de dépense
   */
  async approveExpenseRequest(req, res) {
    const transaction = await sequelize.transaction();

    try {
      const { associationId, requestId } = req.params;
      const { amountApproved } = req.body;

      const expenseRequest = await ExpenseRequest.findOne({
        where: { id: requestId, associationId },
        transaction,
      });

      if (!expenseRequest) {
        await transaction.rollback();
        return res.status(404).json({
          error: "Demande non trouvée",
          code: "EXPENSE_REQUEST_NOT_FOUND",
        });
      }

      // ✅ VÉRIFICATION DES FONDS avec le SERVICE
      const finalAmount = amountApproved || expenseRequest.amountRequested;

      const fundsCheck = await AssociationBalanceService.checkSufficientFunds(
        parseInt(associationId),
        parseFloat(finalAmount)
      );

      // ❌ BLOQUER L'APPROBATION si fonds insuffisants
      if (!fundsCheck.sufficient) {
        await transaction.rollback();
        return res.status(400).json({
          error: "Fonds insuffisants pour approuver cette demande",
          code: "INSUFFICIENT_FUNDS",
          details: {
            requiredAmount: fundsCheck.requestedAmount,
            currentBalance: fundsCheck.availableBalance,
            shortfall: fundsCheck.shortage,
          },
        });
      }

      // Mettre à jour la demande
      await expenseRequest.update(
        {
          status: "approved",
          amountApproved: finalAmount,
          approvedAt: new Date(),
          approvedBy: req.user.id,
        },
        { transaction }
      );

      await transaction.commit();

      return res.status(200).json({
        message: "Demande approuvée avec succès",
        data: { expenseRequest },
      });
    } catch (error) {
      await transaction.rollback();
      console.error("Erreur approbation:", error);
      return res.status(500).json({
        error: "Erreur lors de l'approbation",
        code: "APPROVE_EXPENSE_ERROR",
      });
    }
  }

  /**
   * ⏳ Demandes en attente de validation
   */
  async getPendingValidations(req, res) {
    try {
      const { associationId } = req.params;

      const pendingRequests = await ExpenseRequest.findAll({
        where: {
          associationId: parseInt(associationId),
          status: ["pending", "under_review"],
        },
        include: [
          {
            model: User,
            as: "requester",
            attributes: ["id", "firstName", "lastName"],
          },
          {
            model: User,
            as: "beneficiary",
            attributes: ["id", "firstName", "lastName"],
          },
          {
            model: Section,
            as: "section",
            attributes: ["id", "name"],
          },
        ],
        order: [
          ["urgencyLevel", "DESC"],
          ["created_at", "ASC"],
        ],
      });

      // Filtrer où user n'a pas validé
      const userPendingRequests = pendingRequests.filter((request) => {
        const userValidation = request.validationHistory?.find(
          (v) => v.userId === req.user.id
        );
        return !userValidation;
      });

      const stats = {
        total: userPendingRequests.length,
        totalAmount: userPendingRequests.reduce(
          (sum, req) => sum + parseFloat(req.amountRequested),
          0
        ),
        byUrgency: {
          critical: userPendingRequests.filter(
            (r) => r.urgencyLevel === "critical"
          ).length,
          high: userPendingRequests.filter((r) => r.urgencyLevel === "high")
            .length,
          normal: userPendingRequests.filter((r) => r.urgencyLevel === "normal")
            .length,
          low: userPendingRequests.filter((r) => r.urgencyLevel === "low")
            .length,
        },
      };

      res.json({
        success: true,
        data: {
          pendingRequests: userPendingRequests,
          statistics: stats,
        },
      });
    } catch (error) {
      console.error("Erreur validations en attente:", error);
      res.status(500).json({
        error: "Erreur récupération",
        code: "PENDING_VALIDATIONS_ERROR",
      });
    }
  }

  /**
   * 📜 Historique des validations
   */
  async getValidationHistory(req, res) {
    try {
      // TODO: Implémenter historique validations
      res.status(501).json({
        error: "Fonctionnalité en cours de développement",
        code: "NOT_IMPLEMENTED",
      });
    } catch (error) {
      console.error("Erreur historique validations:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }

  async processPayment(req, res) {
    try {
      const { associationId, requestId } = req.params;
      const {
        paymentMode = "manual",
        paymentMethod,
        paymentDate,
        manualPaymentReference,
        manualPaymentDetails,
        notes,
      } = req.body;

      const expenseRequest = await ExpenseRequest.findOne({
        where: {
          id: parseInt(requestId),
          associationId: parseInt(associationId),
          status: "approved",
        },
      });

      if (!expenseRequest) {
        return res.status(404).json({
          error: "Demande non trouvée ou non approuvée",
          code: "EXPENSE_REQUEST_NOT_FOUND",
        });
      }

      // ❌ SUPPRIMÉ : Vérification hasPermission("validate_expenses")
      // Le middleware s'en charge

      // Créer la transaction
      const transaction = await Transaction.create({
        associationId: parseInt(associationId),
        userId: expenseRequest.beneficiaryId || null,
        type: expenseRequest.isLoan ? "loan_disbursement" : "expense_payment",
        amount: expenseRequest.amountApproved,
        currency: expenseRequest.currency,
        description: `Paiement: ${expenseRequest.title}`,
        status: "completed",
        paymentMode,
        paymentMethod,
        paymentDate: paymentDate || new Date(),
        manualPaymentReference,
        manualPaymentDetails,
        relatedExpenseRequestId: expenseRequest.id,
        metadata: {
          expenseType: expenseRequest.expenseType,
          isLoan: expenseRequest.isLoan,
          notes,
        },
      });

      await expenseRequest.update({
        status: "paid",
        paidAt: new Date(),
        transactionId: transaction.id,
      });

      res.json({
        message: "Paiement enregistré avec succès",
        transaction,
        expenseRequest: {
          id: expenseRequest.id,
          status: "paid",
        },
      });
    } catch (error) {
      console.error("Erreur paiement:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }

  /**
   * 🔄 Lister remboursements prêt
   */
  async getRepayments(req, res) {
    try {
      const { associationId, requestId } = req.params;

      // Vérifier que c'est bien un prêt
      const expenseRequest = await ExpenseRequest.findOne({
        where: {
          id: parseInt(requestId),
          associationId: parseInt(associationId),
          isLoan: true,
        },
      });

      if (!expenseRequest) {
        return res.status(404).json({
          error: "Prêt non trouvé",
          code: "LOAN_NOT_FOUND",
        });
      }

      // Récupérer les remboursements
      const repayments = await LoanRepayment.findAll({
        where: { expenseRequestId: parseInt(requestId) },
        include: [
          {
            model: User,
            as: "validator",
            attributes: ["id", "firstName", "lastName"],
          },
        ],
        order: [["paymentDate", "DESC"]],
      });

      // Calculer totaux
      const totalRepaid = repayments
        .filter((r) => r.status === "validated")
        .reduce((sum, r) => sum + parseFloat(r.amount), 0);

      const totalPending = repayments
        .filter((r) => r.status === "pending")
        .reduce((sum, r) => sum + parseFloat(r.amount), 0);

      res.json({
        success: true,
        data: {
          repayments: repayments.map((r) => ({
            id: r.id,
            amount: parseFloat(r.amount),
            principalAmount: parseFloat(r.principalAmount),
            interestAmount: parseFloat(r.interestAmount),
            penaltyAmount: parseFloat(r.penaltyAmount),
            paymentDate: r.paymentDate,
            dueDate: r.dueDate,
            paymentMethod: r.paymentMethod,
            manualReference: r.manualReference,
            status: r.status,
            daysLate: r.daysLate,
            notes: r.notes,
            installmentNumber: r.installmentNumber,
            validator: r.validator,
            createdAt: r.createdAt,
          })),
          summary: {
            totalRepaid,
            totalPending,
            loanAmount: parseFloat(expenseRequest.amountRequested),
            outstanding:
              parseFloat(expenseRequest.amountRequested) - totalRepaid,
          },
        },
      });
    } catch (error) {
      console.error("Erreur récupération remboursements:", error);
      res.status(500).json({
        error: "Erreur lors de la récupération des remboursements",
        code: "REPAYMENTS_FETCH_ERROR",
      });
    }
  }

  /**
   * 💰 Enregistrer remboursement prêt
   */
  async recordRepayment(req, res) {
    try {
      const { associationId, requestId } = req.params;
      const {
        amount,
        paymentDate,
        paymentMethod,
        paymentMode = "manual",
        manualReference,
        notes,
      } = req.body;

      // Vérifier le prêt
      const loan = await ExpenseRequest.findOne({
        where: {
          id: parseInt(requestId),
          associationId: parseInt(associationId),
          isLoan: true,
          status: ["approved", "paid"],
        },
      });

      if (!loan) {
        return res.status(404).json({
          error: "Prêt non trouvé ou non actif",
          code: "LOAN_NOT_FOUND",
        });
      }

      // Calculer total déjà remboursé
      const existingRepayments = await LoanRepayment.findAll({
        where: {
          expenseRequestId: parseInt(requestId),
          status: "validated",
        },
      });

      const totalRepaid = existingRepayments.reduce(
        (sum, r) => sum + parseFloat(r.amount),
        0
      );

      const loanAmount = parseFloat(loan.amountRequested);
      const outstanding = loanAmount - totalRepaid;

      // Vérifier que le montant ne dépasse pas le restant dû
      if (parseFloat(amount) > outstanding) {
        return res.status(400).json({
          error: "Le montant dépasse le restant dû",
          code: "AMOUNT_EXCEEDS_OUTSTANDING",
          details: {
            outstanding,
            requested: parseFloat(amount),
          },
        });
      }

      // Créer le remboursement
      const repayment = await LoanRepayment.create({
        expenseRequestId: parseInt(requestId),
        amount: parseFloat(amount),
        principalAmount: parseFloat(amount),
        interestAmount: 0,
        penaltyAmount: 0,
        currency: loan.currency,
        paymentDate: new Date(paymentDate),
        paymentMode,
        paymentMethod,
        manualReference: manualReference || `REMB-${requestId}-${Date.now()}`,
        manualDetails: {
          recordedBy: req.user.id,
          recordedAt: new Date(),
        },
        notes,
        status: "pending",
        installmentNumber: existingRepayments.length + 1,
      });

      // Mettre à jour le statut du prêt si totalement remboursé
      const newTotal = totalRepaid + parseFloat(amount);
      if (newTotal >= loanAmount) {
        await loan.update({
          repaymentStatus: "completed",
          status: "paid",
        });
      } else if (existingRepayments.length === 0) {
        await loan.update({
          repaymentStatus: "in_progress",
        });
      }

      res.status(201).json({
        success: true,
        message: "Remboursement enregistré avec succès",
        data: {
          repayment: {
            id: repayment.id,
            amount: parseFloat(repayment.amount),
            paymentDate: repayment.paymentDate,
            status: repayment.status,
            reference: repayment.manualReference,
          },
          loanStatus: {
            totalRepaid: newTotal,
            outstanding: loanAmount - newTotal,
            repaymentStatus:
              newTotal >= loanAmount ? "completed" : "in_progress",
          },
        },
      });
    } catch (error) {
      console.error("Erreur enregistrement remboursement:", error);
      res.status(500).json({
        error: "Erreur lors de l'enregistrement du remboursement",
        code: "REPAYMENT_RECORD_ERROR",
        details: error.message,
      });
    }
  }

  /**
   * 📊 Statistiques dépenses
   */
  async getExpenseStatistics(req, res) {
    try {
      res.status(501).json({
        error: "Fonctionnalité en cours de développement",
        code: "NOT_IMPLEMENTED",
      });
    } catch (error) {
      console.error("Erreur statistiques:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }

  /**
   * 📈 Résumé financier complet d'une association
   */
  async getFinancialSummary(req, res) {
    try {
      const associationId = parseInt(req.params.associationId);
      const {
        period = "all",
        includeProjections = false,
        includeAlerts = true,
        includeHistory = false,
        historyMonths = 12,
      } = req.query;

      console.log("🔍 getFinancialSummary - Debug:");
      console.log("   associationId:", associationId);
      console.log("   userId:", req.user?.id);

      // Validation des paramètres
      if (!associationId || isNaN(associationId)) {
        return res.status(400).json({
          error: "ID association invalide",
          code: "INVALID_ASSOCIATION_ID",
        });
      }

      // Récupérer membership avec association pour RBAC
      const membership = await AssociationMember.findOne({
        where: {
          userId: parseInt(req.user.id),
          associationId: associationId,
          status: "active",
        },
        include: [
          {
            model: Association,
            as: "association",
            attributes: [
              "id",
              "name",
              "rolesConfiguration", // ✅ Charger config RBAC
              "domiciliationCountry",
            ],
          },
        ],
      });

      if (!membership) {
        return res.status(403).json({
          error: "Accès refusé à cette association",
          code: "ACCESS_DENIED",
        });
      }

      const association = membership.association;
      console.log("   Association:", association.name);

      // ✅ NOUVEAU : Vérification permissions avec RBAC moderne
      const hasFinanceAccess =
        membership.isAdmin ||
        hasPermission(membership, "view_finances") ||
        req.user?.role === "super_admin";

      console.log("   isAdmin:", membership.isAdmin);
      console.log("   hasFinanceAccess:", hasFinanceAccess);

      if (!hasFinanceAccess) {
        return res.status(403).json({
          error: "Permissions insuffisantes pour voir les finances",
          code: "INSUFFICIENT_PERMISSIONS",
          required: "view_finances",
        });
      }

      // 📊 Calculer le résumé financier
      console.log("   📊 Calcul résumé financier...");

      let financialSummary;
      try {
        // Calculer balance de base directement
        const { Transaction } = require("../../../models");

        // Total cotisations
        const totalIncomeResult = await Transaction.findOne({
          where: {
            associationId,
            type: "cotisation",
            status: "completed",
          },
          attributes: [
            [
              Transaction.sequelize.fn(
                "COALESCE",
                Transaction.sequelize.fn(
                  "SUM",
                  Transaction.sequelize.col("net_amount")
                ),
                0
              ),
              "total",
            ],
          ],
          raw: true,
        });

        const totalIncome = parseFloat(totalIncomeResult?.total || 0);

        // Total dépenses
        const totalExpensesResult = await Transaction.findOne({
          where: {
            associationId,
            type: "aide",
            status: "completed",
          },
          attributes: [
            [
              Transaction.sequelize.fn(
                "COALESCE",
                Transaction.sequelize.fn(
                  "SUM",
                  Transaction.sequelize.col("amount")
                ),
                0
              ),
              "total",
            ],
          ],
          raw: true,
        });

        const totalExpenses = parseFloat(totalExpensesResult?.total || 0);

        financialSummary = {
          currentBalance: {
            totalIncome,
            totalExpenses,
            outstandingLoans: 0,
            availableBalance: totalIncome - totalExpenses,
          },
          projectedBalance: totalIncome - totalExpenses,
          pendingExpenses: 0,
          upcomingRepayments: 0,
          expensesByType: [],
          lastCalculated: new Date(),
        };
      } catch (balanceError) {
        console.error("   ❌ Erreur calcul balance:", balanceError.message);
        financialSummary = {
          currentBalance: {
            totalIncome: 0,
            totalExpenses: 0,
            outstandingLoans: 0,
            availableBalance: 0,
          },
          projectedBalance: 0,
          pendingExpenses: 0,
          upcomingRepayments: 0,
          expensesByType: [],
          lastCalculated: new Date(),
        };
      }

      // 🚨 Alertes simplifiées
      let alerts = [];
      if (includeAlerts) {
        try {
          const balance = financialSummary.currentBalance.availableBalance;
          if (balance < 500) {
            alerts.push({
              type: "low_balance",
              severity: balance < 0 ? "critical" : "warning",
              message: `Solde ${
                balance < 0 ? "négatif" : "faible"
              }: ${balance.toFixed(2)}€`,
              value: balance,
            });
          }
        } catch (alertError) {
          console.error("   ⚠️ Erreur calcul alertes:", alertError.message);
        }
      }

      // 📈 Historique simplifié
      let balanceHistory = [];
      if (includeHistory) {
        balanceHistory = [];
      }

      // 🏛️ Informations association
      const associationInfo = await Association.findByPk(associationId, {
        attributes: ["id", "name", "domiciliationCountry", "created_at"],
        include: [
          {
            model: Section,
            as: "sections",
            attributes: ["id", "name", "country"],
            required: false,
          },
        ],
      });

      // 📊 Statistiques simplifiées
      let memberStats = { total: 0, byType: [], byStatus: [] };
      let cotisationStats = { period, count: 0, totalGross: 0, totalNet: 0 };
      let upcomingEvents = {
        upcomingRepayments: [],
        urgentExpenses: [],
        lateContributions: [],
      };

      try {
        const totalMembers = await AssociationMember.count({
          where: { associationId, status: "active" },
        });

        memberStats = { total: totalMembers, byType: [], byStatus: [] };

        const cotisationCount = await Transaction.count({
          where: {
            associationId,
            type: "cotisation",
            status: "completed",
          },
        });

        cotisationStats = {
          period,
          count: cotisationCount,
          totalGross: financialSummary.currentBalance.totalIncome,
          totalNet: financialSummary.currentBalance.totalIncome,
          totalCommissions: 0,
        };
      } catch (statsError) {
        console.error("   ⚠️ Erreur stats:", statsError.message);
      }

      // 📋 Construire la réponse finale
      const response = {
        association: {
          id: associationInfo.id,
          name: associationInfo.name,
          country: associationInfo.domiciliationCountry || "FR",
          currency: "EUR",
          createdAt: associationInfo.createdAt,
          sectionsCount: associationInfo.sections?.length || 0,
        },

        balance: {
          current: financialSummary.currentBalance,
          projected: financialSummary.projectedBalance,
          lastCalculated: financialSummary.lastCalculated,
        },

        cashFlow: {
          totalIncome: financialSummary.currentBalance.totalIncome,
          totalExpenses: financialSummary.currentBalance.totalExpenses,
          outstandingLoans: financialSummary.currentBalance.outstandingLoans,
          pendingExpenses: financialSummary.pendingExpenses,
          upcomingRepayments: financialSummary.upcomingRepayments,
        },

        expenses: {
          byType: financialSummary.expensesByType,
          period: period,
        },

        membership: memberStats,
        cotisations: cotisationStats,

        upcoming: upcomingEvents,

        alerts: alerts,

        ...(includeHistory && { history: balanceHistory }),

        metadata: {
          period,
          includeProjections,
          generatedAt: new Date(),
          isAdmin: membership.isAdmin,
          hasFullAccess: hasFinanceAccess,
          accessLevel: membership.isAdmin ? "admin" : "standard",
        },
      };

      console.log("   ✅ Réponse construite avec succès");

      res.status(200).json({
        success: true,
        data: response,
      });
    } catch (error) {
      console.error("❌ Erreur résumé financier:", error);
      console.error("   Message:", error.message);
      console.error("   Stack:", error.stack);

      res.status(500).json({
        error: "Erreur lors de la génération du résumé financier",
        code: "FINANCIAL_SUMMARY_ERROR",
        ...(process.env.NODE_ENV === "development" && {
          details: error.message,
        }),
      });
    }
  }

  // Méthodes utilitaires pour le résumé financier
  async getMembershipStats(associationId) {
    try {
      const id = parseInt(associationId);
      if (isNaN(id)) {
        throw new Error(`Association ID invalide: ${associationId}`);
      }

      const totalMembers = await AssociationMember.count({
        where: {
          associationId: id,
          status: "active",
        },
      });

      const membersByType = await AssociationMember.findAll({
        where: {
          associationId: id,
          status: "active",
        },
        attributes: [
          "memberType",
          [
            AssociationMember.sequelize.fn(
              "COUNT",
              AssociationMember.sequelize.col("id")
            ),
            "count",
          ],
        ],
        group: ["memberType"],
        raw: true,
      });

      const membersByStatus = await AssociationMember.findAll({
        where: { associationId: id },
        attributes: [
          "contributionStatus",
          [
            AssociationMember.sequelize.fn(
              "COUNT",
              AssociationMember.sequelize.col("id")
            ),
            "count",
          ],
        ],
        group: ["contributionStatus"],
        raw: true,
      });

      return {
        total: totalMembers,
        byType: membersByType.map((item) => ({
          type: item.memberType || "unknown",
          count: parseInt(item.count) || 0,
        })),
        byStatus: membersByStatus.map((item) => ({
          status: item.contributionStatus || "unknown",
          count: parseInt(item.count) || 0,
        })),
      };
    } catch (error) {
      console.error("Erreur stats membres:", error.message);
      return { total: 0, byType: [], byStatus: [] };
    }
  }

  async getCotisationStats(associationId, period) {
    try {
      const id = parseInt(associationId);
      if (isNaN(id)) {
        throw new Error(`Association ID invalide: ${associationId}`);
      }

      let whereClause = {
        associationId: id,
        type: "cotisation",
        status: "completed",
      };

      if (period && period !== "all") {
        const periodMap = {
          month: 30,
          quarter: 90,
          year: 365,
        };

        const days = periodMap[period];
        if (days) {
          const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
          whereClause.created_at = {
            [Op.gte]: startDate,
          };
        }
      }

      const cotisationSummary = await Transaction.findOne({
        where: whereClause,
        attributes: [
          [
            Transaction.sequelize.fn("COUNT", Transaction.sequelize.col("id")),
            "count",
          ],
          [
            Transaction.sequelize.fn(
              "COALESCE",
              Transaction.sequelize.fn(
                "SUM",
                Transaction.sequelize.col("amount")
              ),
              0
            ),
            "totalGross",
          ],
          [
            Transaction.sequelize.fn(
              "COALESCE",
              Transaction.sequelize.fn(
                "SUM",
                Transaction.sequelize.col("net_amount")
              ),
              0
            ),
            "totalNet",
          ],
          [
            Transaction.sequelize.fn(
              "COALESCE",
              Transaction.sequelize.fn(
                "SUM",
                Transaction.sequelize.col("commission_amount")
              ),
              0
            ),
            "totalCommissions",
          ],
        ],
        raw: true,
      });

      return {
        period: period || "all",
        count: parseInt(cotisationSummary?.count || 0),
        totalGross: parseFloat(cotisationSummary?.totalGross || 0),
        totalNet: parseFloat(cotisationSummary?.totalNet || 0),
        totalCommissions: parseFloat(cotisationSummary?.totalCommissions || 0),
        currentMonthCollectionRate: 0,
        expectedThisMonth: 0,
        actualThisMonth: 0,
      };
    } catch (error) {
      console.error("Erreur stats cotisations:", error.message);
      return {
        period: period || "all",
        count: 0,
        totalGross: 0,
        totalNet: 0,
        totalCommissions: 0,
        currentMonthCollectionRate: 0,
        expectedThisMonth: 0,
        actualThisMonth: 0,
      };
    }
  }

  async getUpcomingFinancialEvents(associationId) {
    try {
      const id = parseInt(associationId);
      if (isNaN(id)) {
        throw new Error(`Association ID invalide: ${associationId}`);
      }

      return {
        upcomingRepayments: [],
        urgentExpenses: [],
        lateContributions: [],
      };
    } catch (error) {
      console.error("Erreur événements financiers:", error.message);
      return {
        upcomingRepayments: [],
        urgentExpenses: [],
        lateContributions: [],
      };
    }
  }

  /**
   * 📄 Export comptable
   */
  async exportExpenseData(req, res) {
    try {
      res.status(501).json({
        error: "Fonctionnalité en cours de développement",
        code: "NOT_IMPLEMENTED",
      });
    } catch (error) {
      console.error("Erreur export:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }

  /**
   * ❌ Refuser une demande
   */
  async rejectExpenseRequest(req, res) {
    try {
      const { associationId, requestId } = req.params;
      const { rejectionReason } = req.body;

      if (!rejectionReason || rejectionReason.trim().length < 10) {
        return res.status(400).json({
          error: "Motif de refus requis (minimum 10 caractères)",
          code: "REJECTION_REASON_REQUIRED",
        });
      }

      const expenseRequest = await ExpenseRequest.findOne({
        where: {
          id: parseInt(requestId),
          associationId: parseInt(associationId),
          status: ["pending", "under_review"],
        },
      });

      if (!expenseRequest) {
        return res.status(404).json({
          error: "Demande non trouvée",
          code: "EXPENSE_REQUEST_NOT_FOUND",
        });
      }

      // ❌ SUPPRIMÉ : Vérification hasPermission("validate_expenses")
      // Le middleware s'en charge

      const membership = req.membership;
      const validationHistory = expenseRequest.validationHistory || [];
      validationHistory.push({
        userId: req.user.id,
        role: membership?.assignedRoles?.[0] || "member",
        decision: "rejected",
        comment: rejectionReason,
        timestamp: new Date(),
      });

      await expenseRequest.update({
        status: "rejected",
        validationHistory,
        rejectedAt: new Date(),
        rejectedBy: req.user.id,
        metadata: {
          ...expenseRequest.metadata,
          rejectionReason,
        },
      });

      res.json({
        message: "Demande rejetée",
        expenseRequest: {
          id: expenseRequest.id,
          status: "rejected",
        },
      });
    } catch (error) {
      console.error("Erreur rejet:", error);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }

  /**
   * 💬 Demander infos complémentaires
   */
  async requestAdditionalInfo(req, res) {
    try {
      const { associationId, requestId } = req.params;
      const { requestedInfo } = req.body;

      if (!requestedInfo || requestedInfo.trim().length < 10) {
        return res.status(400).json({
          error: "Précisez les informations demandées",
          code: "INFO_REQUEST_REQUIRED",
        });
      }

      const expenseRequest = await ExpenseRequest.findOne({
        where: {
          id: parseInt(requestId),
          associationId: parseInt(associationId),
          status: ["pending", "under_review"],
        },
      });

      if (!expenseRequest) {
        return res.status(404).json({
          error: "Demande non trouvée",
          code: "EXPENSE_REQUEST_NOT_FOUND",
        });
      }

      const validationHistory = expenseRequest.validationHistory || [];
      validationHistory.push({
        userId: req.user.id,
        role: req.membership?.assignedRoles?.[0] || "member",
        decision: "info_needed",
        comment: requestedInfo.trim(),
        timestamp: new Date().toISOString(),
        user: {
          firstName: req.user.firstName,
          lastName: req.user.lastName,
        },
      });

      await expenseRequest.update({
        status: "additional_info_needed",
        validationHistory,
        requestedAdditionalInfo: requestedInfo.trim(),
      });

      res.json({
        success: true,
        message: "Demande d'informations envoyée",
        data: { expenseRequest },
      });
    } catch (error) {
      console.error("Erreur demande infos:", error);
      res.status(500).json({
        error: "Erreur demande infos",
        code: "INFO_REQUEST_ERROR",
      });
    }
  }

  /**
   * 📄 Récupérer détails d'une demande de dépense
   */
  async getExpenseRequestById(req, res) {
    try {
      const { associationId, requestId } = req.params;
      const userId = req.user.id;
      const membership = req.membership;

      // Récupérer la demande avec relations
      const expenseRequest = await ExpenseRequest.findOne({
        where: {
          id: parseInt(requestId),
          associationId: parseInt(associationId),
        },
        include: [
          {
            model: User,
            as: "requester",
            attributes: ["id", "firstName", "lastName", "email", "phoneNumber"],
          },
          {
            model: User,
            as: "beneficiary",
            attributes: ["id", "firstName", "lastName", "email", "phoneNumber"],
          },
          {
            model: Section,
            as: "section",
            attributes: ["id", "name"],
          },
        ],
      });

      if (!expenseRequest) {
        return res.status(404).json({
          error: "Demande de dépense non trouvée",
          code: "EXPENSE_REQUEST_NOT_FOUND",
        });
      }

      // ✅ Vérification d'accès métier (pas de middleware car logique complexe)
      const isAdmin = membership?.isAdmin || false;
      const isRequester = expenseRequest.requesterId === userId;
      const isBeneficiary = expenseRequest.beneficiaryId === userId;

      // Vérifier si l'utilisateur a accès
      if (!isAdmin && !isRequester && !isBeneficiary) {
        // Vérifier si membre du bureau avec droits finances
        const hasFinanceAccess = hasPermission(
          membership,
          "finances.view_treasury"
        );

        if (!hasFinanceAccess) {
          return res.status(403).json({
            error: "Accès refusé à cette demande",
            code: "FORBIDDEN",
          });
        }
      }

      res.json({
        success: true,
        data: {
          expense: expenseRequest,
        },
      });
    } catch (error) {
      console.error("Erreur récupération demande:", error);
      res.status(500).json({
        error: "Erreur lors de la récupération de la demande",
      });
    }
  }
}

module.exports = new ExpenseRequestController();
