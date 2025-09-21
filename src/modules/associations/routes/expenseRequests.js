// src/modules/associations/routes/expenseRequests.js
// Routes complètes pour gestion financière association

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const { authMiddleware, checkRole } = require('../../../core/auth/middleware/auth');
const { handleValidationErrors } = require('../../../core/middleware/validation');
const expenseRequestController = require('../controllers/expenseRequestController');
// Ajoutez après la ligne 10 (après l'import du controller)
console.log('Controller methods:', Object.getOwnPropertyNames(expenseRequestController));
console.log('validateExpenseRequest exists:', typeof expenseRequestController.validateExpenseRequest);
// 🔐 MIDDLEWARE PERMISSIONS
const checkAssociationMember = async (req, res, next) => {
  try {
    const { AssociationMember } = require('../../../models');
    const { associationId } = req.params;
    
    const membership = await AssociationMember.findOne({
      where: {
        userId: req.user.id,
        associationId: parseInt(associationId),
        status: 'active'
      }
    });
    
    if (!membership) {
      return res.status(403).json({
        error: 'Accès refusé',
        code: 'NOT_ASSOCIATION_MEMBER'
      });
    }
    
    req.membership = membership;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Erreur vérification membre' });
  }
};

const checkValidationRights = async (req, res, next) => {
  try {
    const { Association } = require('../../../models');
    const { associationId } = req.params;
    
    const association = await Association.findByPk(associationId);
    if (!association) {
      return res.status(404).json({ error: 'Association non trouvée' });
    }
    
    // Vérifier si user peut valider selon workflowRules ou rôles bureau
    const userRoles = req.membership?.roles || [];
    const bureauCentral = association.bureauCentral || {};
    
    const canValidate = 
      userRoles.includes('president') ||
      userRoles.includes('tresorier') ||
      userRoles.includes('secretaire') ||
      Object.values(bureauCentral).some(member => member.userId === req.user.id);
    
    if (!canValidate) {
      return res.status(403).json({
        error: 'Droits insuffisants pour validation',
        code: 'INSUFFICIENT_VALIDATION_RIGHTS'
      });
    }
    
    req.canValidate = true;
    next();
  } catch (error) {
    res.status(500).json({ error: 'Erreur vérification droits' });
  }
};

// 📋 VALIDATIONS
const validateCreateExpenseRequest = [
  body('expenseType')
    .isIn(['aide_membre', 'depense_operationnelle', 'pret_partenariat', 'projet_special', 'urgence_communautaire'])
    .withMessage('Type de dépense invalide'),
    
  body('title')
    .trim()
    .isLength({ min: 5, max: 255 })
    .withMessage('Titre requis (5-255 caractères)'),
    
  body('description')
    .trim()
    .isLength({ min: 20, max: 2000 })
    .withMessage('Description requise (20-2000 caractères)'),
    
  body('amountRequested')
    .isFloat({ min: 0.01, max: 1000000 })
    .withMessage('Montant invalide (0.01 - 1,000,000)'),
    
  body('currency')
    .optional()
    .isIn(['EUR', 'USD', 'GBP', 'CAD', 'CHF', 'XOF', 'XAF'])
    .withMessage('Devise non supportée'),
    
  body('urgencyLevel')
    .optional()
    .isIn(['low', 'normal', 'high', 'critical'])
    .withMessage('Niveau urgence invalide'),
    
  body('beneficiaryId')
    .optional()
    .isInt({ min: 1 })
    .withMessage('ID bénéficiaire invalide'),
    
  body('beneficiaryExternal')
    .optional()
    .isObject()
    .withMessage('Bénéficiaire externe doit être un objet'),
    
  body('isLoan')
    .optional()
    .isBoolean()
    .withMessage('isLoan doit être boolean'),
    
  body('loanTerms')
    .optional()
    .isObject()
    .withMessage('Conditions prêt doivent être un objet'),
    
  body('expectedImpact')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Impact attendu max 1000 caractères'),
    
  handleValidationErrors
];

const validateUpdateExpenseRequest = [
  param('requestId')
    .isInt({ min: 1 })
    .withMessage('ID demande invalide'),
    
  body('title')
    .optional()
    .trim()
    .isLength({ min: 5, max: 255 })
    .withMessage('Titre requis (5-255 caractères)'),
    
  body('description')
    .optional()
    .trim()
    .isLength({ min: 20, max: 2000 })
    .withMessage('Description requise (20-2000 caractères)'),
    
  body('amountRequested')
    .optional()
    .isFloat({ min: 0.01, max: 1000000 })
    .withMessage('Montant invalide'),
    
  body('urgencyLevel')
    .optional()
    .isIn(['low', 'normal', 'high', 'critical'])
    .withMessage('Niveau urgence invalide'),
    
  handleValidationErrors
];

const validateApprovalAction = [
  param('requestId')
    .isInt({ min: 1 })
    .withMessage('ID demande invalide'),
    
  body('decision')
    .isIn(['approve', 'reject', 'request_info'])
    .withMessage('Décision invalide'),
    
  body('comment')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Commentaire max 1000 caractères'),
    
  body('amountApproved')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Montant approuvé invalide'),
    
  body('conditions')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Conditions max 1000 caractères'),
    
  handleValidationErrors
];

// 🆔 ROUTES PRINCIPALES

/**
 * @route POST /api/v1/associations/:associationId/expense-requests
 * @desc Créer nouvelle demande de dépense
 * @access Membres selon type (aides = tous, dépenses = bureau)
 */
router.post('/:associationId/expense-requests',
  authMiddleware,
  checkAssociationMember,
  validateCreateExpenseRequest,
  expenseRequestController.createExpenseRequest
);

/**
 * @route GET /api/v1/associations/:associationId/expense-requests
 * @desc Lister demandes dépenses avec filtres
 * @access Membres selon permissions association
 */
router.get('/:associationId/expense-requests',
  authMiddleware,
  checkAssociationMember,
  [
    query('status')
      .optional()
      .isIn(['pending', 'under_review', 'additional_info_needed', 'approved', 'rejected', 'paid', 'cancelled'])
      .withMessage('Statut invalide'),
      
    query('expenseType')
      .optional()
      .isIn(['aide_membre', 'depense_operationnelle', 'pret_partenariat', 'projet_special', 'urgence_communautaire'])
      .withMessage('Type invalide'),
      
    query('requesterId')
      .optional()
      .isInt({ min: 1 })
      .withMessage('ID demandeur invalide'),
      
    query('minAmount')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Montant minimum invalide'),
      
    query('maxAmount')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Montant maximum invalide'),
      
    query('dateFrom')
      .optional()
      .isISO8601()
      .withMessage('Date début invalide'),
      
    query('dateTo')
      .optional()
      .isISO8601()
      .withMessage('Date fin invalide'),
      
    query('urgencyLevel')
      .optional()
      .isIn(['low', 'normal', 'high', 'critical'])
      .withMessage('Niveau urgence invalide'),
      
    query('isLoan')
      .optional()
      .isBoolean()
      .withMessage('isLoan doit être boolean'),
      
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page invalide'),
      
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limite invalide (1-100)'),
      
    query('sortBy')
      .optional()
      .isIn(['createdAt', 'amountRequested', 'urgencyLevel', 'status'])
      .withMessage('Tri invalide'),
      
    query('sortOrder')
      .optional()
      .isIn(['ASC', 'DESC'])
      .withMessage('Ordre tri invalide'),
      
    handleValidationErrors
  ],
  expenseRequestController.getExpenseRequests
);

/**
 * @route GET /api/v1/associations/:associationId/expense-requests/:requestId
 * @desc Détails d'une demande de dépense
 * @access Demandeur + Bureau avec droits + Bénéficiaire
 */
router.get('/:associationId/expense-requests/:requestId',
  authMiddleware,
  checkAssociationMember,
  [
    param('requestId').isInt({ min: 1 }).withMessage('ID demande invalide'),
    handleValidationErrors
  ],
  expenseRequestController.getExpenseRequestDetails
);

/**
 * @route PUT /api/v1/associations/:associationId/expense-requests/:requestId
 * @desc Modifier demande (avant validation complète)
 * @access Demandeur + Bureau
 */
router.put('/:associationId/expense-requests/:requestId',
  authMiddleware,
  checkAssociationMember,
  validateUpdateExpenseRequest,
  expenseRequestController.updateExpenseRequest
);

/**
 * @route DELETE /api/v1/associations/:associationId/expense-requests/:requestId
 * @desc Annuler/supprimer demande
 * @access Demandeur + Bureau
 */
router.delete('/:associationId/expense-requests/:requestId',
  authMiddleware,
  checkAssociationMember,
  [
    param('requestId').isInt({ min: 1 }).withMessage('ID demande invalide'),
    body('reason').optional().trim().isLength({ max: 500 }).withMessage('Raison max 500 caractères'),
    handleValidationErrors
  ],
  expenseRequestController.cancelExpenseRequest
);

// ⚖️ ROUTES VALIDATION/APPROBATION

/**
 * @route POST /api/v1/associations/:associationId/expense-requests/:requestId/validate
 * @desc Valider/rejeter/demander infos pour une demande
 * @access Bureau avec droits validation
 */
router.post('/:associationId/expense-requests/:requestId/validate',
  authMiddleware,
  checkAssociationMember,
  checkValidationRights,
  validateApprovalAction,
  expenseRequestController.validateExpenseRequest
);

/**
 * @route GET /api/v1/associations/:associationId/expense-requests/pending-validations
 * @desc Demandes en attente de validation pour cet utilisateur
 * @access Bureau avec droits validation
 */
router.get('/:associationId/expense-requests/pending-validations',
  authMiddleware,
  checkAssociationMember,
  checkValidationRights,
  expenseRequestController.getPendingValidations
);

/**
 * @route GET /api/v1/associations/:associationId/expense-requests/:requestId/validation-history
 * @desc Historique des validations pour une demande
 * @access Bureau + Demandeur
 */
router.get('/:associationId/expense-requests/:requestId/validation-history',
  authMiddleware,
  checkAssociationMember,
  [
    param('requestId').isInt({ min: 1 }).withMessage('ID demande invalide'),
    handleValidationErrors
  ],
  expenseRequestController.getValidationHistory
);

// 💳 ROUTES PAIEMENT

/**
 * @route POST /api/v1/associations/:associationId/expense-requests/:requestId/pay
 * @desc Confirmer paiement (manuel pour l'instant)
 * @access Trésorier + Président
 */
router.post('/:associationId/expense-requests/:requestId/pay',
  authMiddleware,
  checkAssociationMember,
  [
    param('requestId').isInt({ min: 1 }).withMessage('ID demande invalide'),
    
    body('paymentMode')
      .isIn(['manual'])
      .withMessage('Mode paiement invalide'), // 'digital' ajouté plus tard
      
    body('paymentMethod')
      .isIn(['bank_transfer', 'cash', 'check', 'mobile_money'])
      .withMessage('Méthode paiement invalide'),
      
    body('manualPaymentReference')
      .optional()
      .trim()
      .isLength({ max: 255 })
      .withMessage('Référence max 255 caractères'),
      
    body('manualPaymentDetails')
      .optional()
      .isObject()
      .withMessage('Détails paiement doivent être un objet'),
      
    body('paymentDate')
      .optional()
      .isISO8601()
      .withMessage('Date paiement invalide'),
      
    body('notes')
      .optional()
      .trim()
      .isLength({ max: 1000 })
      .withMessage('Notes max 1000 caractères'),
      
    handleValidationErrors
  ],
  expenseRequestController.processPayment
);

/**
 * @route PUT /api/v1/associations/:associationId/expense-requests/:requestId/payment-status
 * @desc Mettre à jour statut paiement
 * @access Trésorier
 */
router.put('/:associationId/expense-requests/:requestId/payment-status',
  authMiddleware,
  checkAssociationMember,
  [
    param('requestId').isInt({ min: 1 }).withMessage('ID demande invalide'),
    
    body('status')
      .isIn(['paid', 'payment_failed', 'cancelled'])
      .withMessage('Statut invalide'),
      
    body('failureReason')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Motif échec max 500 caractères'),
      
    body('notes')
      .optional()
      .trim()
      .isLength({ max: 1000 })
      .withMessage('Notes max 1000 caractères'),
      
    handleValidationErrors
  ],
  expenseRequestController.updatePaymentStatus
);

// 🔄 ROUTES SUIVI PRÊTS

/**
 * @route GET /api/v1/associations/:associationId/expense-requests/:requestId/loan-status
 * @desc Statut remboursement prêt
 * @access Bureau + Bénéficiaire
 */
router.get('/:associationId/expense-requests/:requestId/loan-status',
  authMiddleware,
  checkAssociationMember,
  [
    param('requestId').isInt({ min: 1 }).withMessage('ID demande invalide'),
    handleValidationErrors
  ],
  expenseRequestController.getLoanStatus
);

/**
 * @route POST /api/v1/associations/:associationId/expense-requests/:requestId/repayments
 * @desc Enregistrer remboursement de prêt
 * @access Trésorier
 */
router.post('/:associationId/expense-requests/:requestId/repayments',
  authMiddleware,
  checkAssociationMember,
  [
    param('requestId').isInt({ min: 1 }).withMessage('ID demande invalide'),
    
    body('amount')
      .isFloat({ min: 0.01 })
      .withMessage('Montant remboursement invalide'),
      
    body('paymentDate')
      .isISO8601()
      .withMessage('Date paiement requise'),
      
    body('paymentMethod')
      .isIn(['bank_transfer', 'card_payment', 'cash', 'check', 'mobile_money'])
      .withMessage('Méthode paiement invalide'),
      
    body('manualReference')
      .optional()
      .trim()
      .isLength({ max: 255 })
      .withMessage('Référence max 255 caractères'),
      
    body('notes')
      .optional()
      .trim()
      .isLength({ max: 1000 })
      .withMessage('Notes max 1000 caractères'),
      
    body('installmentNumber')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Numéro échéance invalide'),
      
    handleValidationErrors
  ],
  expenseRequestController.recordRepayment
);

/**
 * @route GET /api/v1/associations/:associationId/expense-requests/:requestId/repayments
 * @desc Historique remboursements prêt
 * @access Bureau + Bénéficiaire
 */
router.get('/:associationId/expense-requests/:requestId/repayments',
  authMiddleware,
  checkAssociationMember,
  [
    param('requestId').isInt({ min: 1 }).withMessage('ID demande invalide'),
    handleValidationErrors
  ],
  expenseRequestController.getRepaymentHistory
);

// 📊 ROUTES RAPPORTS & ANALYTICS

/**
 * @route GET /api/v1/associations/:associationId/expense-requests/statistics
 * @desc Statistiques dépenses association
 * @access Bureau Central
 */
router.get('/:associationId/expense-requests/statistics',
  authMiddleware,
  checkAssociationMember,
  [
    query('period')
      .optional()
      .isIn(['month', 'quarter', 'year', 'all'])
      .withMessage('Période invalide'),
      
    query('groupBy')
      .optional()
      .isIn(['type', 'month', 'section', 'status', 'urgency'])
      .withMessage('Groupement invalide'),
      
    query('includeLoans')
      .optional()
      .isBoolean()
      .withMessage('includeLoans doit être boolean'),
      
    handleValidationErrors
  ],
  expenseRequestController.getExpenseStatistics
);

/**
 * @route GET /api/v1/associations/:associationId/expense-requests/balance
 * @desc Solde et situation financière association
 * @access Bureau Central
 */
router.get('/:associationId/expense-requests/balance',
  authMiddleware,
  checkAssociationMember,
  [
    query('includeProjections')
      .optional()
      .isBoolean()
      .withMessage('includeProjections doit être boolean'),
      
    query('period')
      .optional()
      .isIn(['month', 'quarter', 'year'])
      .withMessage('Période invalide'),
      
    handleValidationErrors
  ],
  expenseRequestController.getAssociationBalance
);

/**
 * @route GET /api/v1/associations/:associationId/expense-requests/export
 * @desc Export comptable des dépenses
 * @access Trésorier + Président
 */
router.get('/:associationId/expense-requests/export',
  authMiddleware,
  checkAssociationMember,
  [
    query('format')
      .optional()
      .isIn(['excel', 'csv', 'pdf'])
      .withMessage('Format invalide'),
      
    query('dateFrom')
      .isISO8601()
      .withMessage('Date début requise'),
      
    query('dateTo')
      .isISO8601()
      .withMessage('Date fin requise'),
      
    query('includeDetails')
      .optional()
      .isBoolean()
      .withMessage('includeDetails doit être boolean'),
      
    query('expenseTypes')
      .optional()
      .custom((value) => {
        if (typeof value === 'string') {
          const types = value.split(',');
          const validTypes = ['aide_membre', 'depense_operationnelle', 'pret_partenariat', 'projet_special', 'urgence_communautaire'];
          return types.every(type => validTypes.includes(type.trim()));
        }
        return true;
      })
      .withMessage('Types dépenses invalides'),
      
    handleValidationErrors
  ],
  expenseRequestController.exportExpenseData
);

// 📄 ROUTES DOCUMENTS

/**
 * @route POST /api/v1/associations/:associationId/expense-requests/:requestId/documents
 * @desc Upload document justificatif
 * @access Demandeur + Bureau
 */
router.post('/:associationId/expense-requests/:requestId/documents',
  authMiddleware,
  checkAssociationMember,
  [
    param('requestId').isInt({ min: 1 }).withMessage('ID demande invalide'),
    body('documentType').trim().isLength({ min: 1, max: 50 }).withMessage('Type document requis'),
    body('documentName').trim().isLength({ min: 1, max: 255 }).withMessage('Nom document requis'),
    // Upload middleware Cloudinary sera ajouté ici
    handleValidationErrors
  ],
  expenseRequestController.uploadDocument
);

/**
 * @route DELETE /api/v1/associations/:associationId/expense-requests/:requestId/documents/:documentId
 * @desc Supprimer document
 * @access Demandeur + Bureau
 */
router.delete('/:associationId/expense-requests/:requestId/documents/:documentId',
  authMiddleware,
  checkAssociationMember,
  [
    param('requestId').isInt({ min: 1 }).withMessage('ID demande invalide'),
    param('documentId').isInt({ min: 1 }).withMessage('ID document invalide'),
    handleValidationErrors
  ],
  expenseRequestController.deleteDocument
);

module.exports = router;