// src/modules/associations/controllers/expenseRequestController.js
// Controller pour gestion financière association

const { Op } = require('sequelize');
const { 
  ExpenseRequest, 
  LoanRepayment, 
  Association, 
  User, 
  AssociationMember,
  Transaction,
  Document
} = require('../../../models');
const AssociationBalanceService = require('../services/associationBalanceService');
const NotificationService = require('../../../core/services/notificationService');

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
        currency = 'EUR',
        urgencyLevel = 'normal',
        beneficiaryId,
        beneficiaryExternal,
        isLoan = false,
        loanTerms,
        expectedImpact,
        metadata
      } = req.body;
      
      // 🔐 CONTRÔLES PERMISSIONS
      
      // Vérifier qui peut créer selon le type
      if (expenseType === 'aide_membre') {
        // Tous les membres peuvent demander des aides
        if (!beneficiaryId && !beneficiaryExternal) {
          // Si pas de bénéficiaire spécifié, c'est pour le demandeur
          req.body.beneficiaryId = userId;
        }
      } else {
        // Autres types = bureau seulement
        const userRoles = membership.roles || [];
        const isBureau = userRoles.some(role => 
          ['president', 'tresorier', 'secretaire'].includes(role)
        );
        
        if (!isBureau) {
          return res.status(403).json({
            error: 'Seul le bureau peut créer ce type de dépense',
            code: 'INSUFFICIENT_PERMISSIONS'
          });
        }
      }
      
      // 🔍 VALIDATIONS MÉTIER
      
      // Vérifier association existe
      const association = await Association.findByPk(associationId);
      if (!association) {
        return res.status(404).json({
          error: 'Association non trouvée'
        });
      }
      
      // Vérifier bénéficiaire si spécifié
      if (beneficiaryId) {
        const beneficiary = await User.findByPk(beneficiaryId);
        if (!beneficiary) {
          return res.status(400).json({
            error: 'Bénéficiaire non trouvé'
          });
        }
        
        // Vérifier que bénéficiaire est membre de l'association
        const beneficiaryMembership = await AssociationMember.findOne({
          where: {
            userId: beneficiaryId,
            associationId,
            status: 'active'
          }
        });
        
        if (!beneficiaryMembership) {
          return res.status(400).json({
            error: 'Le bénéficiaire doit être membre de l\'association'
          });
        }
      }
      
      // Valider sous-type selon configuration association
      if (expenseSubtype) {
        const expenseTypes = association.expenseTypes || {};
        const typeConfig = expenseTypes[expenseType] || {};
        const subtypeConfig = typeConfig[expenseSubtype];
        
        if (!subtypeConfig) {
          return res.status(400).json({
            error: `Sous-type "${expenseSubtype}" non configuré pour ce type de dépense`
          });
        }
        
        // Vérifier montant max si configuré
        if (subtypeConfig.maxAmount && amountRequested > subtypeConfig.maxAmount) {
          return res.status(400).json({
            error: `Montant demandé dépasse le maximum autorisé (${subtypeConfig.maxAmount}€)`
          });
        }
      }
      
      // Valider conditions prêt si applicable
      if (isLoan && loanTerms) {
        const { durationMonths, interestRate, monthlyPayment } = loanTerms;
        
        if (!durationMonths || durationMonths < 1 || durationMonths > 120) {
          return res.status(400).json({
            error: 'Durée prêt invalide (1-120 mois)'
          });
        }
        
        if (interestRate < 0 || interestRate > 50) {
          return res.status(400).json({
            error: 'Taux intérêt invalide (0-50%)'
          });
        }
        
        if (monthlyPayment && monthlyPayment <= 0) {
          return res.status(400).json({
            error: 'Mensualité invalide'
          });
        }
      }
      
      // 💰 CRÉER LA DEMANDE
      const expenseRequest = await ExpenseRequest.create({
        associationId: parseInt(associationId),
        sectionId: membership.sectionId,
        requesterId: userId,
        beneficiaryId,
        beneficiaryExternal,
        expenseType,
        expenseSubtype,
        title,
        description,
        amountRequested,
        currency,
        urgencyLevel,
        isLoan,
        loanTerms,
        expectedImpact,
        metadata,
        status: 'pending'
      });
      
      // 📧 NOTIFICATIONS (hook se charge de l'envoi)
      
      res.status(201).json({
        message: 'Demande créée avec succès',
        expenseRequest: {
          id: expenseRequest.id,
          title: expenseRequest.title,
          amountRequested: expenseRequest.amountRequested,
          status: expenseRequest.status,
          requiredValidators: expenseRequest.requiredValidators,
          createdAt: expenseRequest.createdAt
        }
      });
      
    } catch (error) {
      console.error('Erreur création demande dépense:', error);
      res.status(500).json({
        error: 'Erreur lors de la création de la demande'
      });
    }
  }
  
  /**
   * 📋 Lister demandes avec filtres et pagination
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
        minAmount,
        maxAmount,
        dateFrom,
        dateTo,
        urgencyLevel,
        isLoan,
        page = 1,
        limit = 20,
        sortBy = 'createdAt',
        sortOrder = 'DESC'
      } = req.query;
      
      // 🔐 CONTRÔLES VISIBILITÉ
      
      const association = await Association.findByPk(associationId);
      const permissionsMatrix = association.permissionsMatrix || {};
      const expensePermissions = permissionsMatrix.view_expense_requests || { allowed_roles: ['bureau_central'] };
      
      const userRoles = membership.roles || [];
      const canViewAll = expensePermissions.allowed_roles.some(role => userRoles.includes(role));
      
      // 🔍 CONSTRUIRE FILTRES
      let whereClause = { associationId: parseInt(associationId) };
      
      // Si pas droits globaux, voir seulement ses propres demandes + celles où il est bénéficiaire
      if (!canViewAll) {
        whereClause[Op.or] = [
          { requesterId: userId },
          { beneficiaryId: userId }
        ];
      }
      
      // Filtres optionnels
      if (status) {
        whereClause.status = Array.isArray(status) ? status : [status];
      }
      
      if (expenseType) {
        whereClause.expenseType = Array.isArray(expenseType) ? expenseType : [expenseType];
      }
      
      if (requesterId && canViewAll) {
        whereClause.requesterId = parseInt(requesterId);
      }
      
      if (minAmount) {
        whereClause.amountRequested = { [Op.gte]: parseFloat(minAmount) };
      }
      
      if (maxAmount) {
        if (whereClause.amountRequested) {
          whereClause.amountRequested[Op.lte] = parseFloat(maxAmount);
        } else {
          whereClause.amountRequested = { [Op.lte]: parseFloat(maxAmount) };
        }
      }
      
      if (dateFrom || dateTo) {
        whereClause.createdAt = {};
        if (dateFrom) whereClause.createdAt[Op.gte] = new Date(dateFrom);
        if (dateTo) whereClause.createdAt[Op.lte] = new Date(dateTo);
      }
      
      if (urgencyLevel) {
        whereClause.urgencyLevel = Array.isArray(urgencyLevel) ? urgencyLevel : [urgencyLevel];
      }
      
      if (isLoan !== undefined) {
        whereClause.isLoan = isLoan === 'true';
      }
      
      // 📊 EXÉCUTER REQUÊTE
      const offset = (parseInt(page) - 1) * parseInt(limit);
      
      const { count, rows: expenseRequests } = await ExpenseRequest.findAndCountAll({
        where: whereClause,
        include: [
          {
            model: User,
            as: 'requester',
            attributes: ['id', 'firstName', 'lastName']
          },
          {
            model: User,
            as: 'beneficiary',
            attributes: ['id', 'firstName', 'lastName']
          }
        ],
        order: [[sortBy, sortOrder]],
        offset,
        limit: parseInt(limit)
      });
      
      // 📈 STATISTIQUES RAPIDES
      const summary = canViewAll ? await this.getQuickSummary(associationId) : null;
      
      res.json({
        expenseRequests: expenseRequests.map(req => ({
          id: req.id,
          title: req.title,
          expenseType: req.expenseType,
          expenseSubtype: req.expenseSubtype,
          amountRequested: req.amountRequested,
          amountApproved: req.amountApproved,
          currency: req.currency,
          status: req.status,
          urgencyLevel: req.urgencyLevel,
          isLoan: req.isLoan,
          requester: req.requester,
          beneficiary: req.beneficiary || req.beneficiaryExternal,
          validationProgress: req.getValidationProgress(),
          createdAt: req.createdAt,
          paidAt: req.paidAt
        })),
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count / parseInt(limit))
        },
        summary
      });
      
    } catch (error) {
      console.error('Erreur listage demandes dépenses:', error);
      res.status(500).json({
        error: 'Erreur lors du listage des demandes'
      });
    }
  }
  
  /**
   * 📄 Détails d'une demande spécifique
   */
   async getExpenseRequestDetails(req, res) {
    try {
      const { associationId, requestId } = req.params;
      const userId = req.user.id;
      const membership = req.membership;
      
      const expenseRequest = await ExpenseRequest.findOne({
        where: {
          id: parseInt(requestId),
          associationId: parseInt(associationId)
        },
        include: [
          {
            model: User,
            as: 'requester',
            attributes: ['id', 'firstName', 'lastName', 'phoneNumber']
          },
          {
            model: User,
            as: 'beneficiary',
            attributes: ['id', 'firstName', 'lastName', 'phoneNumber']
          },
          {
            model: User,
            as: 'paymentValidator',
            attributes: ['id', 'firstName', 'lastName']
          },
          {
            model: Transaction,
            as: 'transaction',
            attributes: ['id', 'amount', 'status', 'pspTransactionId']
          },
          {
            model: Document,
            as: 'relatedDocuments',
            attributes: ['id', 'type', 'name', 'url', 'uploadedAt']
          }
        ]
      });
      
      if (!expenseRequest) {
        return res.status(404).json({
          error: 'Demande non trouvée'
        });
      }
      
      // 🔐 CONTRÔLE ACCÈS
      const association = await Association.findByPk(associationId);
      const permissionsMatrix = association.permissionsMatrix || {};
      const expensePermissions = permissionsMatrix.view_expense_requests || { allowed_roles: ['bureau_central'] };
      
      const userRoles = membership.roles || [];
      const canViewAll = expensePermissions.allowed_roles.some(role => userRoles.includes(role));
      const isRequester = expenseRequest.requesterId === userId;
      const isBeneficiary = expenseRequest.beneficiaryId === userId;
      
      if (!canViewAll && !isRequester && !isBeneficiary) {
        return res.status(403).json({
          error: 'Accès refusé à cette demande'
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
              as: 'validator',
              attributes: ['id', 'firstName', 'lastName']
            }
          ],
          order: [['paymentDate', 'DESC']]
        });
      }
      
      res.json({
        ...expenseRequest.toJSON(),
        validationProgress: expenseRequest.getValidationProgress(),
        canModify: expenseRequest.canBeModified() && (isRequester || canViewAll),
        repayments: repayments.map(r => ({
          id: r.id,
          amount: r.amount,
          paymentDate: r.paymentDate,
          paymentMethod: r.paymentMethod,
          status: r.status,
          validator: r.validator,
          installmentNumber: r.installmentNumber,
          daysLate: r.daysLate
        }))
      });
      
    } catch (error) {
      console.error('Erreur détails demande dépense:', error);
      res.status(500).json({
        error: 'Erreur lors de la récupération des détails'
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
          associationId: parseInt(associationId)
        }
      });
      
      if (!expenseRequest) {
        return res.status(404).json({
          error: 'Demande non trouvée'
        });
      }
      
      // 🔐 CONTRÔLE PERMISSIONS
      const userRoles = membership.roles || [];
      const isBureau = userRoles.some(role => ['president', 'tresorier', 'secretaire'].includes(role));
      const isRequester = expenseRequest.requesterId === userId;
      
      if (!isRequester && !isBureau) {
        return res.status(403).json({
          error: 'Seul le demandeur ou le bureau peut modifier'
        });
      }
      
      // 🔐 CONTRÔLE STATUT
      if (!expenseRequest.canBeModified()) {
        return res.status(400).json({
          error: 'Cette demande ne peut plus être modifiée',
          currentStatus: expenseRequest.status
        });
      }
      
      // 📝 MISE À JOUR
      const allowedFields = [
        'title', 'description', 'amountRequested', 'urgencyLevel',
        'expectedImpact', 'metadata'
      ];
      
      const updateData = {};
      allowedFields.forEach(field => {
        if (req.body[field] !== undefined) {
          updateData[field] = req.body[field];
        }
      });
      
      // Validation montant si modifié
      if (updateData.amountRequested) {
        const association = await Association.findByPk(associationId);
        const expenseTypes = association.expenseTypes || {};
        const typeConfig = expenseTypes[expenseRequest.expenseType] || {};
        const subtypeConfig = typeConfig[expenseRequest.expenseSubtype];
        
        if (subtypeConfig?.maxAmount && updateData.amountRequested > subtypeConfig.maxAmount) {
          return res.status(400).json({
            error: `Montant dépasse le maximum autorisé (${subtypeConfig.maxAmount}€)`
          });
        }
      }
      
      await expenseRequest.update(updateData, {
        userId // Pour audit trail
      });
      
      res.json({
        message: 'Demande mise à jour avec succès',
        expenseRequest: {
          id: expenseRequest.id,
          title: expenseRequest.title,
          amountRequested: expenseRequest.amountRequested,
          status: expenseRequest.status,
          updatedAt: expenseRequest.updatedAt
        }
      });
      
    } catch (error) {
      console.error('Erreur modification demande dépense:', error);
      res.status(500).json({
        error: 'Erreur lors de la modification'
      });
    }
  }
  
  /**
   * ❌ Annuler demande
   */
  async cancelExpenseRequest(req, res) {
    try {
      const { associationId, requestId } = req.params;
      const { reason } = req.body;
      const userId = req.user.id;
      const membership = req.membership;
      
      const expenseRequest = await ExpenseRequest.findOne({
        where: {
          id: parseInt(requestId),
          associationId: parseInt(associationId)
        }
      });
      
      if (!expenseRequest) {
        return res.status(404).json({
          error: 'Demande non trouvée'
        });
      }
      
      // 🔐 CONTRÔLE PERMISSIONS
      const userRoles = membership.roles || [];
      const isBureau = userRoles.some(role => ['president', 'tresorier', 'secretaire'].includes(role));
      const isRequester = expenseRequest.requesterId === userId;
      
      if (!isRequester && !isBureau) {
        return res.status(403).json({
          error: 'Seul le demandeur ou le bureau peut annuler'
        });
      }
      
      // 🔐 CONTRÔLE STATUT
      if (['paid', 'cancelled'].includes(expenseRequest.status)) {
        return res.status(400).json({
          error: 'Cette demande ne peut pas être annulée',
          currentStatus: expenseRequest.status
        });
      }
      
      await expenseRequest.update({
        status: 'cancelled',
        rejectionReason: reason || `Annulée par ${isRequester ? 'le demandeur' : 'le bureau'}`
      }, {
        userId
      });
      
      res.json({
        message: 'Demande annulée avec succès'
      });
      
    } catch (error) {
      console.error('Erreur annulation demande dépense:', error);
      res.status(500).json({
        error: 'Erreur lors de l\'annulation'
      });
    }
  }
  
  /**
   * ⚖️ Valider/rejeter/demander infos
   */
   async validateExpenseRequest(req, res) {
    try {
      const { associationId, requestId } = req.params;
      const { decision, comment, amountApproved, conditions } = req.body;
      const userId = req.user.id;
      const membership = req.membership;
      
      const expenseRequest = await ExpenseRequest.findOne({
        where: {
          id: parseInt(requestId),
          associationId: parseInt(associationId)
        }
      });
      
      if (!expenseRequest) {
        return res.status(404).json({
          error: 'Demande non trouvée'
        });
      }
      
      // 🔐 DÉTERMINER RÔLE VALIDATEUR
      const userRoles = membership.roles || [];
      const association = await Association.findByPk(associationId);
      const bureauCentral = association.bureauCentral || {};
      
      let validatorRole = null;
      if (userRoles.includes('president') || Object.values(bureauCentral).find(m => m.userId === userId && m.role.includes('Président'))) {
        validatorRole = 'president';
      } else if (userRoles.includes('tresorier') || Object.values(bureauCentral).find(m => m.userId === userId && m.role.includes('Trésorier'))) {
        validatorRole = 'tresorier';
      } else if (userRoles.includes('secretaire') || Object.values(bureauCentral).find(m => m.userId === userId && m.role.includes('Secrétaire'))) {
        validatorRole = 'secretaire';
      }
      
      if (!validatorRole) {
        return res.status(403).json({
          error: 'Rôle validateur non identifié'
        });
      }
      
      // 🔍 VÉRIFIER SI DÉJÀ VALIDÉ PAR CE RÔLE
      const validationHistory = expenseRequest.validationHistory || [];
      const alreadyValidated = validationHistory.find(v => 
        v.userId === userId || v.role === validatorRole
      );
      
      if (alreadyValidated && decision === 'approve') {
        return res.status(400).json({
          error: 'Vous avez déjà validé cette demande'
        });
      }
      
      // 💰 CONTRÔLE FONDS DISPONIBLES (si approbation)
      if (decision === 'approve') {
        const requestedAmount = amountApproved || expenseRequest.amountRequested;
        const fundsCheck = await AssociationBalanceService.checkSufficientFunds(
          parseInt(associationId), 
          requestedAmount
        );
        
        if (!fundsCheck.sufficient) {
          return res.status(400).json({
            error: 'Fonds insuffisants',
            availableBalance: fundsCheck.availableBalance,
            requestedAmount: requestedAmount,
            shortage: fundsCheck.shortage
          });
        }
      }
      
      // 📝 TRAITEMENT SELON DÉCISION
      let newStatus = expenseRequest.status;
      let updateData = {};
      
      if (decision === 'approve') {
        // Ajouter validation à l'historique
        const newValidation = {
          userId,
          role: validatorRole,
          decision: 'approved',
          comment,
          timestamp: new Date(),
          amountApproved: amountApproved || expenseRequest.amountRequested
        };
        
        const updatedHistory = [...validationHistory, newValidation];
        updateData.validationHistory = updatedHistory;
        
        if (amountApproved) {
          updateData.amountApproved = amountApproved;
        }
        
        if (conditions) {
          updateData.metadata = {
            ...expenseRequest.metadata,
            approvalConditions: conditions
          };
        }
        
        // Vérifier si toutes les validations requises sont obtenues
        const requiredValidators = expenseRequest.requiredValidators || [];
        const approvedValidators = updatedHistory
          .filter(v => v.decision === 'approved')
          .map(v => v.role);
        
        const allValidated = requiredValidators.every(role => 
          approvedValidators.includes(role)
        );
        
        if (allValidated) {
          newStatus = 'approved';
          updateData.amountApproved = updateData.amountApproved || expenseRequest.amountRequested;
        } else {
          newStatus = 'under_review';
        }
        
      } else if (decision === 'reject') {
        newStatus = 'rejected';
        updateData.rejectionReason = comment || 'Demande rejetée par le bureau';
        updateData.validationHistory = [...validationHistory, {
          userId,
          role: validatorRole,
          decision: 'rejected',
          comment,
          timestamp: new Date()
        }];
        
      } else if (decision === 'request_info') {
        newStatus = 'additional_info_needed';
        updateData.validationHistory = [...validationHistory, {
          userId,
          role: validatorRole,
          decision: 'info_requested',
          comment,
          timestamp: new Date()
        }];
      }
      
      updateData.status = newStatus;
      
      await expenseRequest.update(updateData, { userId });
      
      // 📧 NOTIFICATIONS
      await NotificationService.sendExpenseValidationNotification(
        expenseRequest,
        decision,
        validatorRole,
        comment
      );
      
      res.json({
        message: `Demande ${decision === 'approve' ? 'approuvée' : decision === 'reject' ? 'rejetée' : 'mise en attente'}`,
        status: newStatus,
        validationProgress: expenseRequest.getValidationProgress(),
        fullyApproved: newStatus === 'approved'
      });
      
    } catch (error) {
      console.error('Erreur validation demande dépense:', error);
      res.status(500).json({
        error: 'Erreur lors de la validation'
      });
    }
  }
  
  /**
   * 📊 Statistiques rapides pour summary
   */
   async getQuickSummary(associationId) {
    try {
      const [pending, approved, paid, totalAmount] = await Promise.all([
        ExpenseRequest.count({
          where: { 
            associationId: parseInt(associationId),
            status: ['pending', 'under_review']
          }
        }),
        ExpenseRequest.count({
          where: { 
            associationId: parseInt(associationId),
            status: 'approved'
          }
        }),
        ExpenseRequest.count({
          where: { 
            associationId: parseInt(associationId),
            status: 'paid'
          }
        }),
        ExpenseRequest.findOne({
          where: { 
            associationId: parseInt(associationId),
            status: 'paid'
          },
          attributes: [
            [ExpenseRequest.sequelize.fn('SUM', ExpenseRequest.sequelize.col('amount_approved')), 'total']
          ],
          raw: true
        })
      ]);
      
      return {
        pending,
        approved,
        paid,
        totalAmountPaid: parseFloat(totalAmount?.total || 0)
      };
      
    } catch (error) {
      console.error('Erreur calcul summary:', error);
      return null;
    }
  }
  
  /**
   * 📋 Demandes en attente de validation pour cet utilisateur
   */
  async getPendingValidations(req, res) {
    try {
      const { associationId } = req.params;
      const userId = req.user.id;
      const membership = req.membership;
      
      // Déterminer rôle validateur
      const userRoles = membership.roles || [];
      const association = await Association.findByPk(associationId);
      const bureauCentral = association.bureauCentral || {};
      
      let validatorRole = null;
      if (userRoles.includes('president') || Object.values(bureauCentral).find(m => m.userId === userId && m.role.includes('Président'))) {
        validatorRole = 'president';
      } else if (userRoles.includes('tresorier') || Object.values(bureauCentral).find(m => m.userId === userId && m.role.includes('Trésorier'))) {
        validatorRole = 'tresorier';
      } else if (userRoles.includes('secretaire') || Object.values(bureauCentral).find(m => m.userId === userId && m.role.includes('Secrétaire'))) {
        validatorRole = 'secretaire';
      }
      
      // Récupérer demandes où ce rôle est requis et pas encore validé
      const pendingRequests = await ExpenseRequest.findAll({
        where: {
          associationId: parseInt(associationId),
          status: ['pending', 'under_review'],
          requiredValidators: {
            [Op.contains]: [validatorRole]
          }
        },
        include: [
          {
            model: User,
            as: 'requester',
            attributes: ['id', 'firstName', 'lastName']
          }
        ],
        order: [['urgencyLevel', 'DESC'], ['createdAt', 'ASC']]
      });
      
      // Filtrer celles pas encore validées par ce user/rôle
      const filtered = pendingRequests.filter(req => {
        const history = req.validationHistory || [];
        return !history.some(v => v.userId === userId || v.role === validatorRole);
      });
      
      res.json({
        pendingValidations: filtered.map(req => ({
          id: req.id,
          title: req.title,
          expenseType: req.expenseType,
          amountRequested: req.amountRequested,
          urgencyLevel: req.urgencyLevel,
          requester: req.requester,
          createdAt: req.createdAt,
          validationProgress: req.getValidationProgress()
        })),
        count: filtered.length,
        validatorRole
      });
      
    } catch (error) {
      console.error('Erreur récupération validations en attente:', error);
      res.status(500).json({ error: 'Erreur lors de la récupération' });
    }
  }
  
  /**
   * 📜 Historique des validations pour une demande
   */
  async getValidationHistory(req, res) {
    try {
      const { associationId, requestId } = req.params;
      
      const expenseRequest = await ExpenseRequest.findOne({
        where: {
          id: parseInt(requestId),
          associationId: parseInt(associationId)
        }
      });
      
      if (!expenseRequest) {
        return res.status(404).json({ error: 'Demande non trouvée' });
      }
      
      const validationHistory = expenseRequest.validationHistory || [];
      
      // Enrichir avec infos utilisateurs
      const enrichedHistory = await Promise.all(
        validationHistory.map(async (validation) => {
          const user = await User.findByPk(validation.userId, {
            attributes: ['id', 'firstName', 'lastName']
          });
          
          return {
            ...validation,
            user
          };
        })
      );
      
      res.json({
        validationHistory: enrichedHistory,
        requiredValidators: expenseRequest.requiredValidators,
        currentStatus: expenseRequest.status,
        validationProgress: expenseRequest.getValidationProgress()
      });
      
    } catch (error) {
      console.error('Erreur historique validations:', error);
      res.status(500).json({ error: 'Erreur lors de la récupération' });
    }
  }
  
  /**
   * 💳 Confirmer paiement manuel
   */
   async processPayment(req, res) {
    try {
      const { associationId, requestId } = req.params;
      const userId = req.user.id;
      const {
        paymentMode = 'manual',
        paymentMethod,
        manualPaymentReference,
        manualPaymentDetails,
        paymentDate,
        notes
      } = req.body;
      
      const expenseRequest = await ExpenseRequest.findOne({
        where: {
          id: parseInt(requestId),
          associationId: parseInt(associationId)
        }
      });
      
      if (!expenseRequest) {
        return res.status(404).json({ error: 'Demande non trouvée' });
      }
      
      if (expenseRequest.status !== 'approved') {
        return res.status(400).json({
          error: 'Seules les demandes approuvées peuvent être payées',
          currentStatus: expenseRequest.status
        });
      }
      
      // Vérifier fonds disponibles
      const fundsCheck = await AssociationBalanceService.checkSufficientFunds(
        parseInt(associationId),
        expenseRequest.amountApproved || expenseRequest.amountRequested
      );
      
      if (!fundsCheck.sufficient) {
        return res.status(400).json({
          error: 'Fonds insuffisants',
          availableBalance: fundsCheck.availableBalance,
          requestedAmount: expenseRequest.amountApproved || expenseRequest.amountRequested
        });
      }
      
      // Créer Transaction manuelle
      const transaction = await Transaction.create({
        userId: expenseRequest.beneficiaryId || expenseRequest.requesterId,
        associationId: parseInt(associationId),
        type: expenseRequest.expenseType,
        amount: expenseRequest.amountApproved || expenseRequest.amountRequested,
        currency: expenseRequest.currency,
        status: 'completed',
        description: `Paiement: ${expenseRequest.title}`,
        source: 'manual',
        manualReference: manualPaymentReference,
        metadata: {
          expenseRequestId: expenseRequest.id,
          paymentDetails: manualPaymentDetails
        }
      });
      
      // Mettre à jour demande
      await expenseRequest.update({
        status: 'paid',
        paymentMode,
        paymentMethod,
        manualPaymentReference,
        manualPaymentDetails,
        paymentValidatedBy: userId,
        transactionId: transaction.id,
        paidAt: paymentDate ? new Date(paymentDate) : new Date(),
        internalNotes: notes
      }, { userId });
      
      res.json({
        message: 'Paiement confirmé avec succès',
        transaction: {
          id: transaction.id,
          amount: transaction.amount,
          reference: manualPaymentReference
        }
      });
      
    } catch (error) {
      console.error('Erreur traitement paiement:', error);
      res.status(500).json({ error: 'Erreur lors du traitement du paiement' });
    }
  }
  
  /**
   * 🔄 Mettre à jour statut paiement
   */
   async updatePaymentStatus(req, res) {
    try {
      const { associationId, requestId } = req.params;
      const { status, failureReason, notes } = req.body;
      const userId = req.user.id;
      
      const expenseRequest = await ExpenseRequest.findOne({
        where: {
          id: parseInt(requestId),
          associationId: parseInt(associationId)
        }
      });
      
      if (!expenseRequest) {
        return res.status(404).json({ error: 'Demande non trouvée' });
      }
      
      const updateData = { status };
      
      if (status === 'payment_failed') {
        updateData.metadata = {
          ...expenseRequest.metadata,
          paymentFailure: {
            reason: failureReason,
            timestamp: new Date(),
            reportedBy: userId
          }
        };
      }
      
      if (notes) {
        updateData.internalNotes = notes;
      }
      
      await expenseRequest.update(updateData, { userId });
      
      res.json({
        message: 'Statut paiement mis à jour',
        status: status
      });
      
    } catch (error) {
      console.error('Erreur mise à jour statut paiement:', error);
      res.status(500).json({ error: 'Erreur lors de la mise à jour' });
    }
  }
  
  /**
   * 🔄 Statut remboursement prêt
   */
   async getLoanStatus(req, res) {
    try {
      const { associationId, requestId } = req.params;
      
      const expenseRequest = await ExpenseRequest.findOne({
        where: {
          id: parseInt(requestId),
          associationId: parseInt(associationId),
          isLoan: true
        }
      });
      
      if (!expenseRequest) {
        return res.status(404).json({ error: 'Prêt non trouvé' });
      }
      
      // Récupérer remboursements
      const repayments = await LoanRepayment.findAll({
        where: { expenseRequestId: expenseRequest.id },
        order: [['paymentDate', 'DESC']]
      });
      
      const loanAmount = parseFloat(expenseRequest.amountApproved || expenseRequest.amountRequested);
      const totalRepaid = repayments
        .filter(r => r.status === 'validated')
        .reduce((sum, r) => sum + parseFloat(r.amount), 0);
      
      const remainingBalance = loanAmount - totalRepaid;
      
      // Prochaines échéances
      const upcomingPayments = await LoanRepayment.findAll({
        where: {
          expenseRequestId: expenseRequest.id,
          status: 'pending',
          dueDate: { [Op.gte]: new Date() }
        },
        order: [['dueDate', 'ASC']],
        limit: 3
      });
      
      // Retards
      const latePayments = await LoanRepayment.findAll({
        where: {
          expenseRequestId: expenseRequest.id,
          status: 'pending',
          dueDate: { [Op.lt]: new Date() }
        }
      });
      
      res.json({
        loan: {
          id: expenseRequest.id,
          originalAmount: loanAmount,
          totalRepaid,
          remainingBalance,
          repaymentStatus: expenseRequest.repaymentStatus,
          loanTerms: expenseRequest.loanTerms
        },
        upcomingPayments: upcomingPayments.map(p => ({
          id: p.id,
          amount: p.amount,
          dueDate: p.dueDate,
          installmentNumber: p.installmentNumber
        })),
        latePayments: latePayments.map(p => ({
          id: p.id,
          amount: p.amount,
          dueDate: p.dueDate,
          daysLate: Math.floor((new Date() - new Date(p.dueDate)) / (1000 * 60 * 60 * 24))
        })),
        completionPercentage: Math.round((totalRepaid / loanAmount) * 100)
      });
      
    } catch (error) {
      console.error('Erreur statut prêt:', error);
      res.status(500).json({ error: 'Erreur lors de la récupération du statut' });
    }
  }
  
  /**
   * 💰 Enregistrer remboursement de prêt
   */
   async recordRepayment(req, res) {
    try {
      const { associationId, requestId } = req.params;
      const userId = req.user.id;
      const {
        amount,
        paymentDate,
        paymentMethod,
        manualReference,
        notes,
        installmentNumber
      } = req.body;
      
      const expenseRequest = await ExpenseRequest.findOne({
        where: {
          id: parseInt(requestId),
          associationId: parseInt(associationId),
          isLoan: true
        }
      });
      
      if (!expenseRequest) {
        return res.status(404).json({ error: 'Prêt non trouvé' });
      }
      
      // Créer remboursement
      const repayment = await LoanRepayment.create({
        expenseRequestId: expenseRequest.id,
        amount: parseFloat(amount),
        paymentDate: new Date(paymentDate),
        paymentMethod,
        manualReference,
        notes,
        installmentNumber,
        principalAmount: parseFloat(amount), // Simplifié pour l'instant
        interestAmount: 0,
        status: 'validated',
        validatedBy: userId,
        validatedAt: new Date()
      });
      
      // Créer Transaction entrante
      const transaction = await Transaction.create({
        userId: expenseRequest.beneficiaryId || expenseRequest.requesterId,
        associationId: parseInt(associationId),
        type: 'remboursement',
        amount: parseFloat(amount),
        currency: expenseRequest.currency,
        status: 'completed',
        description: `Remboursement prêt: ${expenseRequest.title}`,
        source: 'manual',
        manualReference,
        metadata: {
          loanRepaymentId: repayment.id,
          expenseRequestId: expenseRequest.id
        }
      });
      
      await repayment.update({ transactionId: transaction.id });
      
      res.json({
        message: 'Remboursement enregistré avec succès',
        repayment: {
          id: repayment.id,
          amount: repayment.amount,
          paymentDate: repayment.paymentDate,
          status: repayment.status
        }
      });
      
    } catch (error) {
      console.error('Erreur enregistrement remboursement:', error);
      res.status(500).json({ error: 'Erreur lors de l\'enregistrement' });
    }
  }
  
  /**
   * 📜 Historique remboursements prêt
   */
   async getRepaymentHistory(req, res) {
    try {
      const { associationId, requestId } = req.params;
      
      const expenseRequest = await ExpenseRequest.findOne({
        where: {
          id: parseInt(requestId),
          associationId: parseInt(associationId),
          isLoan: true
        }
      });
      
      if (!expenseRequest) {
        return res.status(404).json({ error: 'Prêt non trouvé' });
      }
      
      const repayments = await LoanRepayment.findAll({
        where: { expenseRequestId: expenseRequest.id },
        include: [
          {
            model: User,
            as: 'validator',
            attributes: ['id', 'firstName', 'lastName']
          }
        ],
        order: [['paymentDate', 'DESC']]
      });
      
      res.json({
        repayments: repayments.map(r => ({
          id: r.id,
          amount: r.amount,
          paymentDate: r.paymentDate,
          dueDate: r.dueDate,
          paymentMethod: r.paymentMethod,
          status: r.status,
          installmentNumber: r.installmentNumber,
          daysLate: r.daysLate,
          validator: r.validator,
          notes: r.notes,
          createdAt: r.createdAt
        }))
      });
      
    } catch (error) {
      console.error('Erreur historique remboursements:', error);
      res.status(500).json({ error: 'Erreur lors de la récupération' });
    }
  }
  
  /**
   * 📊 Statistiques dépenses association
   */
   async getExpenseStatistics(req, res) {
    try {
      const { associationId } = req.params;
      const { period = 'all', groupBy = 'type', includeLoans = 'true' } = req.query;
      
      let whereClause = { associationId: parseInt(associationId) };
      
      // Filtre période
      if (period !== 'all') {
        const periodMap = { month: 30, quarter: 90, year: 365 };
        const days = periodMap[period] || 30;
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        
        whereClause.createdAt = { [Op.gte]: startDate };
      }
      
      // Inclure/exclure prêts
      if (includeLoans === 'false') {
        whereClause.isLoan = false;
      }
      
      // Stats par type
      const statsByType = await ExpenseRequest.findAll({
        where: { ...whereClause, status: 'paid' },
        attributes: [
          'expenseType',
          [ExpenseRequest.sequelize.fn('COUNT', ExpenseRequest.sequelize.col('id')), 'count'],
          [ExpenseRequest.sequelize.fn('SUM', ExpenseRequest.sequelize.col('amount_approved')), 'totalAmount'],
          [ExpenseRequest.sequelize.fn('AVG', ExpenseRequest.sequelize.col('amount_approved')), 'avgAmount']
        ],
        group: ['expenseType'],
        raw: true
      });
      
      // Stats par statut
      const statsByStatus = await ExpenseRequest.findAll({
        where: whereClause,
        attributes: [
          'status',
          [ExpenseRequest.sequelize.fn('COUNT', ExpenseRequest.sequelize.col('id')), 'count']
        ],
        group: ['status'],
        raw: true
      });
      
      // Évolution mensuelle (12 derniers mois)
      const monthlyEvolution = await this.getMonthlyExpenseEvolution(associationId);
      
      res.json({
        period,
        statsByType: statsByType.map(s => ({
          type: s.expenseType,
          count: parseInt(s.count),
          totalAmount: parseFloat(s.totalAmount || 0),
          avgAmount: parseFloat(s.avgAmount || 0)
        })),
        statsByStatus: statsByStatus.map(s => ({
          status: s.status,
          count: parseInt(s.count)
        })),
        monthlyEvolution
      });
      
    } catch (error) {
      console.error('Erreur statistiques dépenses:', error);
      res.status(500).json({ error: 'Erreur lors du calcul des statistiques' });
    }
  }
  
  /**
   * 💰 Solde et situation financière association
   */
 async getAssociationBalance(req, res) {
    try {
      const { associationId } = req.params;
      const { includeProjections = 'false', period = 'month' } = req.query;
      
      // Utiliser le service de calcul solde
      const balance = await AssociationBalanceService.getFinancialSummary(
        parseInt(associationId),
        { 
          period, 
          includeProjections: includeProjections === 'true' 
        }
      );
      
      // Alertes financières
      const alerts = await AssociationBalanceService.getFinancialAlerts(parseInt(associationId));
      
      // Historique évolution
      const balanceHistory = await AssociationBalanceService.getBalanceHistory(parseInt(associationId), 6);
      
      res.json({
        ...balance,
        alerts,
        balanceHistory
      });
      
    } catch (error) {
      console.error('Erreur solde association:', error);
      res.status(500).json({ error: 'Erreur lors du calcul du solde' });
    }
  }
  
  /**
   * 📤 Export comptable des dépenses
   */
   async exportExpenseData(req, res) {
    try {
      const { associationId } = req.params;
      const { format = 'excel', dateFrom, dateTo, includeDetails = 'true', expenseTypes } = req.query;
      
      let whereClause = {
        associationId: parseInt(associationId),
        status: 'paid',
        createdAt: {
          [Op.between]: [new Date(dateFrom), new Date(dateTo)]
        }
      };
      
      if (expenseTypes) {
        whereClause.expenseType = expenseTypes.split(',').map(t => t.trim());
      }
      
      const expenses = await ExpenseRequest.findAll({
        where: whereClause,
        include: [
          {
            model: User,
            as: 'requester',
            attributes: ['firstName', 'lastName']
          },
          {
            model: User,
            as: 'beneficiary',
            attributes: ['firstName', 'lastName']
          }
        ],
        order: [['paidAt', 'DESC']]
      });
      
      // Préparer données export
      const exportData = expenses.map(exp => ({
        Date: exp.paidAt?.toISOString().split('T')[0],
        Type: exp.expenseType,
        'Sous-type': exp.expenseSubtype || '',
        Titre: exp.title,
        Montant: exp.amountApproved || exp.amountRequested,
        Devise: exp.currency,
        Demandeur: `${exp.requester.firstName} ${exp.requester.lastName}`,
        Bénéficiaire: exp.beneficiary ? 
          `${exp.beneficiary.firstName} ${exp.beneficiary.lastName}` : 
          exp.beneficiaryExternal?.name || '',
        'Méthode paiement': exp.paymentMethod,
        Référence: exp.manualPaymentReference || '',
        'Est un prêt': exp.isLoan ? 'Oui' : 'Non'
      }));
      
      if (format === 'csv') {
        // Générer CSV
        const csv = this.generateCSV(exportData);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="depenses_${dateFrom}_${dateTo}.csv"`);
        res.send(csv);
      } else {
        // Pour Excel/PDF - à implémenter avec bibliothèques spécialisées
        res.json({
          message: 'Export Excel/PDF à implémenter',
          data: exportData,
          count: exportData.length
        });
      }
      
    } catch (error) {
      console.error('Erreur export données:', error);
      res.status(500).json({ error: 'Erreur lors de l\'export' });
    }
  }
  
  /**
   * 📄 Upload document justificatif
   */
   async uploadDocument(req, res) {
    try {
      // TODO: Implémenter upload Cloudinary
      res.json({ message: 'Upload document à implémenter avec Cloudinary' });
    } catch (error) {
      console.error('Erreur upload document:', error);
      res.status(500).json({ error: 'Erreur lors de l\'upload' });
    }
  }
  
  /**
   * 🗑️ Supprimer document
   */
  async deleteDocument(req, res) {
    try {
      // TODO: Implémenter suppression document + Cloudinary
      res.json({ message: 'Suppression document à implémenter' });
    } catch (error) {
      console.error('Erreur suppression document:', error);
      res.status(500).json({ error: 'Erreur lors de la suppression' });
    }
  }
  
  /**
   * 📈 Évolution mensuelle des dépenses (utilitaire)
   */
  async getMonthlyExpenseEvolution(associationId, months = 12) {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);
    
    const evolution = [];
    
    for (let i = 0; i < months; i++) {
      const monthStart = new Date(startDate);
      monthStart.setMonth(startDate.getMonth() + i);
      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      
      const monthlyExpenses = await ExpenseRequest.findOne({
        where: {
          associationId,
          status: 'paid',
          paidAt: {
            [Op.between]: [monthStart, monthEnd]
          }
        },
        attributes: [
          [ExpenseRequest.sequelize.fn('COUNT', ExpenseRequest.sequelize.col('id')), 'count'],
          [ExpenseRequest.sequelize.fn('SUM', ExpenseRequest.sequelize.col('amount_approved')), 'total']
        ],
        raw: true
      });
      
      evolution.push({
        month: monthStart.toISOString().substring(0, 7),
        count: parseInt(monthlyExpenses?.count || 0),
        totalAmount: parseFloat(monthlyExpenses?.total || 0)
      });
    }
    
    return evolution;
  }
  
  /**
   * 📄 Générer CSV (utilitaire)
   */
  static generateCSV(data) {
    if (!data.length) return '';
    
    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(','),
      ...data.map(row => 
        headers.map(header => 
          `"${String(row[header] || '').replace(/"/g, '""')}"`
        ).join(',')
      )
    ].join('\n');
    
    return csvContent;
  }
}

module.exports = ExpenseRequestController;