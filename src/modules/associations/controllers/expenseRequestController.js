// src/modules/associations/controllers/expenseRequestController.js
// Controller ExpenseRequest - suit les patterns existants

const { Op } = require('sequelize');
const { 
  ExpenseRequest, 
  LoanRepayment, 
  Association, 
  User, 
  Section,
  Transaction,
  Document 
} = require('../../../models');
const AssociationBalanceService = require('../services/associationBalanceService');

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
        documents,
        externalReferences,
        expectedImpact,
        isLoan = false,
        loanTerms,
        metadata
      } = req.body;
      
      // 🔐 CONTRÔLE PERMISSIONS SELON TYPE
      if (expenseType === 'aide_membre') {
        // Membres peuvent demander des aides
        if (!membership || membership.status !== 'active') {
          return res.status(403).json({
            error: 'Seuls les membres actifs peuvent demander des aides',
            code: 'MEMBER_REQUIRED'
          });
        }
      } else {
        // Autres dépenses = bureau uniquement
        const userRoles = membership?.roles || [];
        const isBureauMember = userRoles.some(role => 
          ['president', 'tresorier', 'secretaire'].includes(role)
        );
        
        if (!isBureauMember) {
          return res.status(403).json({
            error: 'Seul le bureau peut enregistrer ce type de dépense',
            code: 'BUREAU_REQUIRED'
          });
        }
      }
      
      // 💰 VÉRIFICATION FONDS DISPONIBLES
      const fundsCheck = await AssociationBalanceService.checkSufficientFunds(
        parseInt(associationId), 
        parseFloat(amountRequested)
      );
      
      if (!fundsCheck.sufficient) {
        return res.status(400).json({
          error: 'Fonds insuffisants',
          code: 'INSUFFICIENT_FUNDS',
          details: {
            requested: amountRequested,
            available: fundsCheck.availableBalance,
            shortage: fundsCheck.shortage
          }
        });
      }
      
      // ✅ CRÉATION DEMANDE
      const expenseRequest = await ExpenseRequest.create({
        associationId: parseInt(associationId),
        sectionId: membership?.sectionId || null,
        requesterId: userId,
        beneficiaryId: beneficiaryId || null,
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
        status: 'pending'
      });
      
      // 📊 CHARGER RELATIONS POUR RÉPONSE
      const createdRequest = await ExpenseRequest.findByPk(expenseRequest.id, {
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
          },
          {
            model: Association,
            as: 'association',
            attributes: ['id', 'name']
          }
        ]
      });
      
      res.status(201).json({
        message: 'Demande de dépense créée avec succès',
        expenseRequest: {
          ...createdRequest.toJSON(),
          validationProgress: createdRequest.getValidationProgress()
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
        sortBy = 'createdAt',
        sortOrder = 'DESC'
      } = req.query;
      
      // 🔐 CONTRÔLE ACCÈS SELON PERMISSIONS
      const association = await Association.findByPk(associationId);
      const permissionsMatrix = association.permissionsMatrix || {};
      const expensePermissions = permissionsMatrix.view_expense_requests || { 
        allowed_roles: ['bureau_central'] 
      };
      
      const userRoles = membership?.roles || [];
      const canViewAll = expensePermissions.allowed_roles.some(role => 
        userRoles.includes(role)
      );
      
      // 🔍 CONSTRUCTION FILTRES
      let whereClause = { 
        associationId: parseInt(associationId) 
      };
      
      // Si pas de droits complets, voir seulement ses demandes
      if (!canViewAll) {
        whereClause[Op.or] = [
          { requesterId: userId },
          { beneficiaryId: userId }
        ];
      }
      
      // Filtres optionnels
      if (status) whereClause.status = status;
      if (expenseType) whereClause.expenseType = expenseType;
      if (requesterId) whereClause.requesterId = parseInt(requesterId);
      if (beneficiaryId) whereClause.beneficiaryId = parseInt(beneficiaryId);
      if (urgencyLevel) whereClause.urgencyLevel = urgencyLevel;
      if (isLoan !== undefined) whereClause.isLoan = isLoan === 'true';
      
      // Filtres montant
      if (minAmount) {
        whereClause.amountRequested = { 
          [Op.gte]: parseFloat(minAmount) 
        };
      }
      if (maxAmount) {
        whereClause.amountRequested = {
          ...whereClause.amountRequested,
          [Op.lte]: parseFloat(maxAmount)
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
            as: 'requester',
            attributes: ['id', 'firstName', 'lastName']
          },
          {
            model: User,
            as: 'beneficiary',
            attributes: ['id', 'firstName', 'lastName']
          },
          {
            model: Section,
            as: 'section',
            attributes: ['id', 'name']
          }
        ],
        order: [[sortBy, sortOrder.toUpperCase()]],
        limit: parseInt(limit),
        offset
      });
      
      // 📈 ENRICHIR AVEC PROGRESS VALIDATION
      const enrichedRows = rows.map(request => ({
        ...request.toJSON(),
        validationProgress: request.getValidationProgress(),
        canModify: request.canBeModified() && (
          request.requesterId === userId || canViewAll
        )
      }));
      
      res.json({
        expenseRequests: enrichedRows,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(count / parseInt(limit)),
          totalItems: count,
          itemsPerPage: parseInt(limit)
        },
        filters: {
          applied: Object.keys(req.query).length > 0,
          canViewAll
        }
      });
      
    } catch (error) {
      console.error('Erreur liste demandes dépenses:', error);
      res.status(500).json({ 
        error: 'Erreur lors de la récupération des demandes' 
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
          associationId: parseInt(associationId)
        },
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
          },
          {
            model: User,
            as: 'paymentValidator',
            attributes: ['id', 'firstName', 'lastName']
          },
          {
            model: Association,
            as: 'association',
            attributes: ['id', 'name']
          },
          {
            model: Section,
            as: 'section',
            attributes: ['id', 'name']
          },
          {
            model: Transaction,
            as: 'transaction',
            attributes: ['id', 'amount', 'status', 'createdAt']
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
          error: 'Demande non trouvée',
          code: 'EXPENSE_REQUEST_NOT_FOUND'
        });
      }
      
      // 🔐 CONTRÔLE ACCÈS
      const association = await Association.findByPk(associationId);
      const permissionsMatrix = association.permissionsMatrix || {};
      const expensePermissions = permissionsMatrix.view_expense_requests || { 
        allowed_roles: ['bureau_central'] 
      };
      
      const userRoles = membership?.roles || [];
      const canViewAll = expensePermissions.allowed_roles.some(role => 
        userRoles.includes(role)
      );
      const isRequester = expenseRequest.requesterId === userId;
      const isBeneficiary = expenseRequest.beneficiaryId === userId;
      
      if (!canViewAll && !isRequester && !isBeneficiary) {
        return res.status(403).json({
          error: 'Accès refusé à cette demande',
          code: 'ACCESS_DENIED'
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
          error: 'Demande non trouvée',
          code: 'EXPENSE_REQUEST_NOT_FOUND'
        });
      }
      
      // 🔐 CONTRÔLE DROITS MODIFICATION
      const userRoles = membership?.roles || [];
      const isBureauMember = userRoles.some(role => 
        ['president', 'tresorier', 'secretaire'].includes(role)
      );
      const isRequester = expenseRequest.requesterId === userId;
      
      if (!isRequester && !isBureauMember) {
        return res.status(403).json({
          error: 'Droits insuffisants pour modifier cette demande',
          code: 'INSUFFICIENT_RIGHTS'
        });
      }
      
      // ✅ VÉRIFIER SI MODIFIABLE
      if (!expenseRequest.canBeModified()) {
        return res.status(400).json({
          error: 'Cette demande ne peut plus être modifiée',
          code: 'NOT_MODIFIABLE',
          details: { status: expenseRequest.status }
        });
      }
      
      // 💰 VÉRIFIER FONDS SI MONTANT MODIFIÉ
      const { amountRequested } = req.body;
      if (amountRequested && parseFloat(amountRequested) !== parseFloat(expenseRequest.amountRequested)) {
        const fundsCheck = await AssociationBalanceService.checkSufficientFunds(
          parseInt(associationId), 
          parseFloat(amountRequested)
        );
        
        if (!fundsCheck.sufficient) {
          return res.status(400).json({
            error: 'Fonds insuffisants pour ce montant',
            code: 'INSUFFICIENT_FUNDS',
            details: {
              requested: amountRequested,
              available: fundsCheck.availableBalance
            }
          });
        }
      }
      
      // 🔄 MISE À JOUR
      const updatedRequest = await expenseRequest.update(req.body, {
        userId // Pour audit trail
      });
      
      // 📊 RECHARGER AVEC RELATIONS
      const finalRequest = await ExpenseRequest.findByPk(updatedRequest.id, {
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
        ]
      });
      
      res.json({
        message: 'Demande modifiée avec succès',
        expenseRequest: {
          ...finalRequest.toJSON(),
          validationProgress: finalRequest.getValidationProgress()
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
          associationId: parseInt(associationId)
        }
      });
      
      if (!expenseRequest) {
        return res.status(404).json({
          error: 'Demande non trouvée',
          code: 'EXPENSE_REQUEST_NOT_FOUND'
        });
      }
      
      // 🔐 CONTRÔLE DROITS ANNULATION
      const userRoles = membership?.roles || [];
      const isBureauMember = userRoles.some(role => 
        ['president', 'tresorier', 'secretaire'].includes(role)
      );
      const isRequester = expenseRequest.requesterId === userId;
      
      if (!isRequester && !isBureauMember) {
        return res.status(403).json({
          error: 'Droits insuffisants pour annuler cette demande',
          code: 'INSUFFICIENT_RIGHTS'
        });
      }
      
      // ✅ VÉRIFIER SI ANNULABLE
      if (['paid', 'cancelled'].includes(expenseRequest.status)) {
        return res.status(400).json({
          error: 'Cette demande ne peut pas être annulée',
          code: 'NOT_CANCELLABLE',
          details: { status: expenseRequest.status }
        });
      }
      
      // 🔄 ANNULATION
      await expenseRequest.update({
        status: 'cancelled',
        rejectionReason: reason || `Annulée par ${isRequester ? 'demandeur' : 'bureau'}`,
        metadata: {
          ...expenseRequest.metadata,
          cancelledBy: userId,
          cancelledAt: new Date(),
          cancelReason: reason
        }
      }, { userId });
      
      res.json({
        message: 'Demande annulée avec succès',
        expenseRequest: {
          id: expenseRequest.id,
          status: 'cancelled'
        }
      });
      
    } catch (error) {
      console.error('Erreur annulation demande dépense:', error);
      res.status(500).json({ 
        error: 'Erreur lors de l\'annulation' 
      });
    }
  }
  
  
  /**
   * ⚖️ Valider/rejeter/demander infos pour une demande
   */
  async validateExpenseRequest(req, res) {
    try {
      // TODO: Implémenter logique validation
      res.status(501).json({ 
        error: 'Fonctionnalité en cours de développement',
        code: 'NOT_IMPLEMENTED'
      });
    } catch (error) {
      console.error('Erreur validation demande:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
  
  /**
   * 📋 Demandes en attente de validation
   */
  async getPendingValidations(req, res) {
    try {
      // TODO: Implémenter logique demandes en attente
      res.status(501).json({ 
        error: 'Fonctionnalité en cours de développement',
        code: 'NOT_IMPLEMENTED'
      });
    } catch (error) {
      console.error('Erreur demandes en attente:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
  
  /**
   * 📜 Historique des validations
   */
  async getValidationHistory(req, res) {
    try {
      // TODO: Implémenter historique validations
      res.status(501).json({ 
        error: 'Fonctionnalité en cours de développement',
        code: 'NOT_IMPLEMENTED'
      });
    } catch (error) {
      console.error('Erreur historique validations:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
  
  /**
   * 💳 Confirmer paiement manuel
   */
  async processPayment(req, res) {
    try {
      // TODO: Implémenter confirmation paiement
      res.status(501).json({ 
        error: 'Fonctionnalité en cours de développement',
        code: 'NOT_IMPLEMENTED'
      });
    } catch (error) {
      console.error('Erreur paiement:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
  
  /**
   * 🔄 Lister remboursements prêt
   */
  async getRepayments(req, res) {
    try {
      // TODO: Implémenter liste remboursements
      res.status(501).json({ 
        error: 'Fonctionnalité en cours de développement',
        code: 'NOT_IMPLEMENTED'
      });
    } catch (error) {
      console.error('Erreur remboursements:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
  
  /**
   * 💰 Enregistrer remboursement prêt
   */
  async recordRepayment(req, res) {
    try {
      // TODO: Implémenter enregistrement remboursement
      res.status(501).json({ 
        error: 'Fonctionnalité en cours de développement',
        code: 'NOT_IMPLEMENTED'
      });
    } catch (error) {
      console.error('Erreur enregistrement remboursement:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
  
  /**
   * 📊 Statistiques dépenses
   */
  async getExpenseStatistics(req, res) {
    try {
      // TODO: Implémenter statistiques
      res.status(501).json({ 
        error: 'Fonctionnalité en cours de développement',
        code: 'NOT_IMPLEMENTED'
      });
    } catch (error) {
      console.error('Erreur statistiques:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
  
  /**
   * 📈 Résumé financier complet
   */
  async getFinancialSummary(req, res) {
    try {
      // TODO: Implémenter résumé financier
      res.status(501).json({ 
        error: 'Fonctionnalité en cours de développement',
        code: 'NOT_IMPLEMENTED'
      });
    } catch (error) {
      console.error('Erreur résumé financier:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
  
  /**
   * 📄 Export comptable
   */
  async exportExpenseData(req, res) {
    try {
      // TODO: Implémenter export
      res.status(501).json({ 
        error: 'Fonctionnalité en cours de développement',
        code: 'NOT_IMPLEMENTED'
      });
    } catch (error) {
      console.error('Erreur export:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
}

module.exports = new ExpenseRequestController();