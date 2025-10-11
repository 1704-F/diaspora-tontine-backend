// src/modules/associations/controllers/expenseRequestController.js
// Controller ExpenseRequest - suit les patterns existants

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
} = require("../../../models");
const AssociationBalanceService = require("../services/associationBalanceService");

class ExpenseRequestController {
  /**
   * 📝 Créer nouvelle demande de dépense
   */
  async createExpenseRequest(req, res) {
    try {
      const { associationId } = req.params;
      const userId = req.user.id;
      const membership = req.membership;

      const {
        expenseType,
        expenseSubtype,
        title,
        description,
        amountRequested,
        currency = "EUR",
        urgencyLevel = "normal",
        beneficiaryId,
        beneficiaryExternal,
        documents,
        externalReferences,
        expectedImpact,
        isLoan = false,
        loanTerms,
        metadata,
      } = req.body;

      // ✅ CONTRÔLE PERMISSIONS UNIFIÉ
      const userRoles = membership?.roles || [];
      const isAdmin = userRoles.includes("admin_association");
      const isBureau = userRoles.some((role) =>
        ["president", "secretaire", "tresorier"].includes(role)
      );

      // Admin peut tout faire
      if (!isAdmin) {
        if (expenseType === "aide_membre") {
          // Membres actifs peuvent demander des aides
          if (!membership || membership.status !== "active") {
            return res.status(403).json({
              error: "Seuls les membres actifs peuvent demander des aides",
              code: "MEMBER_REQUIRED",
            });
          }
        } else {
          // Autres dépenses = bureau uniquement
          if (!isBureau) {
            return res.status(403).json({
              error: "Seul le bureau peut enregistrer ce type de dépense",
              code: "BUREAU_REQUIRED",
            });
          }
        }
      }

      // 💰 VÉRIFICATION FONDS DISPONIBLES
      const fundsCheck = await AssociationBalanceService.checkSufficientFunds(
        parseInt(associationId),
        parseFloat(amountRequested)
      );

      if (!fundsCheck.sufficient) {
        return res.status(400).json({
          error: "Fonds insuffisants",
          code: "INSUFFICIENT_FUNDS",
          details: {
            requested: amountRequested,
            available: fundsCheck.availableBalance,
            shortage: fundsCheck.shortage,
          },
        });
      }

      if (beneficiaryId) {
        const beneficiary = await User.findByPk(parseInt(beneficiaryId));
        if (!beneficiary) {
          return res.status(400).json({
            error: "Bénéficiaire sélectionné introuvable",
            code: "BENEFICIARY_NOT_FOUND",
            beneficiaryId: beneficiaryId,
          });
        }
      }

      // ✅ CRÉATION DEMANDE
      const expenseRequest = await ExpenseRequest.create({
        associationId: parseInt(associationId),
        sectionId: membership?.sectionId || null,
        requesterId: userId,
        beneficiaryId: beneficiaryId ? parseInt(beneficiaryId) : null,
        beneficiaryExternal,
        expenseType,
        expenseSubtype,
        title,
        description,
        amountRequested: parseFloat(amountRequested),
        currency,
        urgencyLevel,
        documents,
        externalReferences,
        expectedImpact,
        isLoan,
        loanTerms,
        metadata,
        status: "pending",
      });

      // Dans createExpenseRequest, après validation beneficiaryId
      console.log("🔍 Debug membres disponibles:");
      const allMembers = await AssociationMember.findAll({
        where: { associationId: parseInt(associationId), status: "active" },
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "firstName", "lastName"],
          },
        ],
      });
      console.log(
        "Membres trouvés:",
        allMembers.map((m) => ({
          memberId: m.id,
          userId: m.user?.id,
          name: `${m.user?.firstName} ${m.user?.lastName}`,
        }))
      );

      // 📊 CHARGER RELATIONS POUR RÉPONSE
      const createdRequest = await ExpenseRequest.findByPk(expenseRequest.id, {
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
            model: Association,
            as: "association",
            attributes: ["id", "name"],
          },
        ],
      });

      res.status(201).json({
        message: "Demande de dépense créée avec succès",
        expenseRequest: {
          ...createdRequest.toJSON(),
          validationProgress: createdRequest.getValidationProgress(),
        },
      });
    } catch (error) {
      console.error("Erreur création demande dépense:", error);
      res.status(500).json({
        error: "Erreur lors de la création de la demande",
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
  'createdAt': 'created_at',
  'created_at': 'created_at',
  'amountRequested': 'amount_requested', // ✅ Si la colonne DB est en snake_case
  'urgencyLevel': 'urgency_level',       // ✅ Si la colonne DB est en snake_case
  'status': 'status',
  'approvedAt': 'approved_at'
};

    const sortColumn = columnMapping[sortBy] || 'created_at';

      // 🔐 CONTRÔLE ACCÈS SELON PERMISSIONS
      const association = await Association.findByPk(associationId);
      const permissionsMatrix = association.permissionsMatrix || {};

      const userRoles = membership?.roles || [];
      const isAdmin = userRoles.includes("admin_association");
      const isBureau = userRoles.some((role) =>
        ["president", "secretaire", "tresorier"].includes(role)
      );
      const canViewAll =
        isAdmin || isBureau || req.user?.role === "super_admin";

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
        whereClause.createdAt = {};
        if (dateFrom) whereClause.createdAt[Op.gte] = new Date(dateFrom);
        if (dateTo) whereClause.createdAt[Op.lte] = new Date(dateTo);
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
      console.log("   userRoles:", userRoles);
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
          // {
          //   model: Document,
          //   as: 'relatedDocuments',
          //   attributes: ['id', 'type', 'name', 'url', 'uploadedAt']
          // },
        ],
      });

      if (!expenseRequest) {
        return res.status(404).json({
          error: "Demande non trouvée",
          code: "EXPENSE_REQUEST_NOT_FOUND",
        });
      }

      // 🔐 CONTRÔLE ACCÈS
      const association = await Association.findByPk(associationId);
      const permissionsMatrix = association.permissionsMatrix || {};
      const expensePermissions = permissionsMatrix.view_expense_requests || {
        allowed_roles: ["bureau_central"],
      };

      const userRoles = membership?.roles || [];
      const canViewAll = expensePermissions.allowed_roles.some((role) =>
        userRoles.includes(role)
      );
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

      // 🔐 CONTRÔLE DROITS MODIFICATION
      const userRoles = membership?.roles || [];
      const isBureauMember = userRoles.some((role) =>
        ["president", "tresorier", "secretaire"].includes(role)
      );
      const isRequester = expenseRequest.requesterId === userId;

      if (!isRequester && !isBureauMember) {
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

      // 🔐 CONTRÔLE DROITS ANNULATION
      const userRoles = membership?.roles || [];
      const isBureauMember = userRoles.some((role) =>
        ["president", "tresorier", "secretaire"].includes(role)
      );
      const isRequester = expenseRequest.requesterId === userId;

      if (!isRequester && !isBureauMember) {
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
            reason || `Annulée par ${isRequester ? "demandeur" : "bureau"}`,
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
 * POST /api/v1/associations/:associationId/expense-requests/:requestId/approve
 */
async approveExpenseRequest(req, res) {
  try {
    const { associationId, requestId } = req.params;
    const { comment, amountApproved, conditions } = req.body;

    const expenseRequest = await ExpenseRequest.findOne({
      where: {
        id: parseInt(requestId),
        associationId: parseInt(associationId),
        status: ['pending', 'under_review']
      }
    });

    if (!expenseRequest) {
      return res.status(404).json({
        error: 'Demande non trouvée ou déjà traitée',
        code: 'EXPENSE_REQUEST_NOT_FOUND'
      });
    }

    // Vérifier permissions
    const membership = req.membership;
    const userRoles = membership?.roles || [];
    const canApprove = 
      userRoles.includes('admin_association') ||
      userRoles.includes('president') ||
      userRoles.includes('tresorier') ||
      userRoles.includes('secretaire') ||
      req.user.role === 'super_admin';

    if (!canApprove) {
      return res.status(403).json({
        error: 'Permissions insuffisantes',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    // Vérifier si déjà validé
    const existingValidation = expenseRequest.validationHistory?.find(
      v => v.userId === req.user.id
    );

    if (existingValidation) {
      return res.status(400).json({
        error: 'Vous avez déjà validé cette demande',
        code: 'ALREADY_VALIDATED'
      });
    }

    // Ajouter validation
    const validationHistory = expenseRequest.validationHistory || [];
    validationHistory.push({
      userId: req.user.id,
      role: userRoles[0] || 'member',
      decision: 'approved',
      comment: comment || '',
      timestamp: new Date().toISOString(),
      user: {
        firstName: req.user.firstName,
        lastName: req.user.lastName
      }
    });

    // Déterminer statut
    const requiredValidators = expenseRequest.requiredValidators || ['president', 'tresorier'];
    const approvedCount = validationHistory.filter(v => v.decision === 'approved').length;
    
    let newStatus = 'under_review';
    if (approvedCount >= requiredValidators.length) {
      newStatus = 'approved';
    }

    await expenseRequest.update({
      status: newStatus,
      validationHistory,
      amountApproved: amountApproved || expenseRequest.amountRequested,
      approvalConditions: conditions || null,
      approvedAt: newStatus === 'approved' ? new Date() : null
    });

    res.json({
      success: true,
      message: newStatus === 'approved' ? 'Demande approuvée' : 'Validation enregistrée',
      data: {
        expenseRequest,
        validationProgress: {
          completed: approvedCount,
          total: requiredValidators.length,
          percentage: Math.round((approvedCount / requiredValidators.length) * 100)
        }
      }
    });
  } catch (error) {
    console.error('Erreur approbation:', error);
    res.status(500).json({
      error: 'Erreur lors de l\'approbation',
      code: 'APPROVAL_ERROR'
    });
  }
}

  /**
   * ⏳ Demandes en attente de validation
   * GET /api/v1/associations/:associationId/expense-requests/pending-validations
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
      paymentMode = 'manual',
      paymentMethod,
      paymentDate,
      manualPaymentReference,
      manualPaymentDetails,
      notes
    } = req.body;

    // Vérifier que la demande existe et est approuvée
    const expenseRequest = await ExpenseRequest.findOne({
      where: {
        id: parseInt(requestId),
        associationId: parseInt(associationId),
        status: 'approved'
      }
    });

    if (!expenseRequest) {
      return res.status(404).json({
        error: 'Demande non trouvée ou non approuvée',
        code: 'EXPENSE_REQUEST_NOT_FOUND'
      });
    }

    // Vérifier permissions (trésorier ou admin_association)
    const membership = req.membership;
    const userRoles = membership?.roles || [];
    const canPay = 
      userRoles.includes('admin_association') ||
      userRoles.includes('tresorier') ||
      req.user.role === 'super_admin';

    if (!canPay) {
      return res.status(403).json({
        error: 'Seul le trésorier ou admin peut confirmer les paiements',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    // Créer la transaction
    const transaction = await Transaction.create({
      associationId: parseInt(associationId),
      userId: expenseRequest.beneficiaryId || null,
      type: expenseRequest.isLoan ? 'pret' : 'aide',
      amount: parseFloat(expenseRequest.amountApproved || expenseRequest.amountRequested),
      currency: expenseRequest.currency,
      status: 'completed',
      paymentMode,
      paymentMethod,
      manualPaymentReference,
      manualPaymentDetails,
      metadata: {
        expenseRequestId: expenseRequest.id,
        processedBy: req.user.id,
        processedAt: new Date().toISOString(),
        notes
      }
    });

    // Mettre à jour le statut de la demande
    await expenseRequest.update({
      status: 'paid',
      transactionId: transaction.id,
      paidAt: new Date(paymentDate || new Date()),
      paymentValidator: req.user.id
    });

    res.json({
      success: true,
      message: 'Paiement confirmé avec succès',
      data: {
        expenseRequest: {
          id: expenseRequest.id,
          status: 'paid',
          paidAt: expenseRequest.paidAt
        },
        transaction: {
          id: transaction.id,
          amount: transaction.amount,
          reference: manualPaymentReference
        }
      }
    });
  } catch (error) {
    console.error('Erreur confirmation paiement:', error);
    res.status(500).json({
      error: 'Erreur lors de la confirmation du paiement',
      code: 'PAYMENT_PROCESS_ERROR',
      details: error.message
    });
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
          status: ["approved", "paid"], // Seulement les prêts actifs
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
        principalAmount: parseFloat(amount), // Pour l'instant, pas d'intérêts
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
        status: "pending", // Nécessite validation
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
      // TODO: Implémenter statistiques
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

      // Récupérer membership
      const {
        AssociationMember,
        Association,
        Section,
        User,
      } = require("../../../models");

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
            // ✅ COLONNES RÉELLES SEULEMENT
            attributes: [
              "id",
              "name",
              "permissionsMatrix",
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

      const userRoles = membership.roles || [];
      const association = membership.association;

      console.log("   User roles:", userRoles);
      console.log("   Association:", association.name);

      // 🔥 VÉRIFICATION PERMISSIONS avec admin_association PRIORITAIRE
      let hasFinanceAccess = false;

      if (userRoles.includes("admin_association")) {
        console.log("   ✅ admin_association - Accès total accordé");
        hasFinanceAccess = true;
      } else if (req.user?.role === "super_admin") {
        console.log("   ✅ super_admin - Accès total accordé");
        hasFinanceAccess = true;
      } else {
        const permissionsMatrix = association.permissionsMatrix || {};
        const financePermissions = permissionsMatrix.view_finances || {
          allowed_roles: ["president", "tresorier", "secretaire"],
        };

        if (!financePermissions.allowed_roles.includes("admin_association")) {
          financePermissions.allowed_roles.unshift("admin_association");
        }

        hasFinanceAccess = financePermissions.allowed_roles.some((role) =>
          userRoles.includes(role)
        );

        console.log(
          "   Rôles autorisés finances:",
          financePermissions.allowed_roles
        );
        console.log("   Accès finance accordé:", hasFinanceAccess);
      }

      if (!hasFinanceAccess) {
        return res.status(403).json({
          error: "Permissions insuffisantes pour voir les finances",
          code: "INSUFFICIENT_PERMISSIONS",
          userRoles: userRoles,
          message:
            "admin_association, president, tresorier ou secrétaire requis",
        });
      }

      // 📊 Calculer le résumé financier
      console.log("   📊 Calcul résumé financier...");

      // ✅ VERSION SIMPLIFIÉE sans service externe pour éviter erreurs
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

        // Total dépenses (aides pour l'instant)
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
            outstandingLoans: 0, // Pour plus tard
            availableBalance: totalIncome - totalExpenses,
          },
          projectedBalance: totalIncome - totalExpenses,
          pendingExpenses: 0, // Pour plus tard
          upcomingRepayments: 0, // Pour plus tard
          expensesByType: [], // Pour plus tard
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
        // Pour plus tard, structure vide pour l'instant
        balanceHistory = [];
      }

      // 🏛️ Informations association avec VRAIES colonnes
      const associationInfo = await Association.findByPk(associationId, {
        // ✅ COLONNES RÉELLES SEULEMENT
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
        // Stats membres de base
        const totalMembers = await AssociationMember.count({
          where: { associationId, status: "active" },
        });

        memberStats = { total: totalMembers, byType: [], byStatus: [] };

        // Stats cotisations de base
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

      // 📋 Construire la réponse finale avec VRAIES données
      const response = {
        association: {
          id: associationInfo.id,
          name: associationInfo.name,
          // ✅ UTILISER domiciliationCountry au lieu de currency
          country: associationInfo.domiciliationCountry || "FR",
          currency: "EUR", // Hardcodé pour l'instant
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
          userRole: userRoles,
          hasFullAccess:
            userRoles.includes("admin_association") ||
            userRoles.includes("president") ||
            userRoles.includes("tresorier"),
          accessLevel: userRoles.includes("admin_association")
            ? "admin"
            : "standard",
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
      // Validation entrée
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
      // Validation entrée
      const id = parseInt(associationId);
      if (isNaN(id)) {
        throw new Error(`Association ID invalide: ${associationId}`);
      }

      let whereClause = {
        associationId: id,
        type: "cotisation",
        status: "completed",
      };

      // Filtre période avec validation
      if (period && period !== "all") {
        const periodMap = {
          month: 30,
          quarter: 90,
          year: 365,
        };

        const days = periodMap[period];
        if (days) {
          const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
          whereClause.createdAt = {
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
        currentMonthCollectionRate: 0, // Calculé séparément si nécessaire
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
      // Validation entrée
      const id = parseInt(associationId);
      if (isNaN(id)) {
        throw new Error(`Association ID invalide: ${associationId}`);
      }

      // Pour l'instant, retourner structure vide
      // Implémentation complète quand ExpenseRequest et LoanRepayment seront en place
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
      // TODO: Implémenter export
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
   * POST /api/v1/associations/:associationId/expense-requests/:requestId/reject
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

      const membership = req.membership;
      const userRoles = membership?.roles || [];
      const canReject =
        userRoles.includes("admin_association") ||
        userRoles.includes("president") ||
        userRoles.includes("tresorier") ||
        userRoles.includes("secretaire") ||
        req.user.role === "super_admin";

      if (!canReject) {
        return res.status(403).json({
          error: "Permissions insuffisantes",
          code: "INSUFFICIENT_PERMISSIONS",
        });
      }

      const validationHistory = expenseRequest.validationHistory || [];
      validationHistory.push({
        userId: req.user.id,
        role: userRoles[0] || "member",
        decision: "rejected",
        comment: rejectionReason.trim(),
        timestamp: new Date().toISOString(),
        user: {
          firstName: req.user.firstName,
          lastName: req.user.lastName,
        },
      });

      await expenseRequest.update({
        status: "rejected",
        validationHistory,
        rejectionReason: rejectionReason.trim(),
        rejectedAt: new Date(),
      });

      res.json({
        success: true,
        message: "Demande rejetée",
        data: { expenseRequest },
      });
    } catch (error) {
      console.error("Erreur rejet:", error);
      res.status(500).json({
        error: "Erreur lors du rejet",
        code: "REJECTION_ERROR",
      });
    }
  }

  /**
   * 💬 Demander infos complémentaires
   * POST /api/v1/associations/:associationId/expense-requests/:requestId/request-info
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
        role: req.membership?.roles?.[0] || "member",
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


}

module.exports = new ExpenseRequestController();
