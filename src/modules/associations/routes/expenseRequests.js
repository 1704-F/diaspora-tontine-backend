// src/modules/associations/routes/expenseRequests.js

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const { authenticate: authMiddleware } = require('../../../core/auth/middleware/auth');
const { handleValidationErrors } = require('../../../core/middleware/validation');
const { checkAssociationMember, checkPermission } = require('../../../core/middleware/checkPermission');

const expenseRequestController = require('../controllers/expenseRequestController');

// 📋 VALIDATIONS (inchangées)
const validateCreateExpenseRequest = [
  param('associationId')
    .isInt({ min: 1 })
    .withMessage('ID association invalide'),
    
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
    
  body('documents')
    .optional()
    .isArray()
    .withMessage('Documents doivent être un tableau'),
    
  body('externalReferences')
    .optional()
    .isObject()
    .withMessage('Références externes doivent être un objet'),
    
  handleValidationErrors
];

const validateUpdateExpenseRequest = [
  param('associationId')
    .isInt({ min: 1 })
    .withMessage('ID association invalide'),
    
  param('requestId')
    .isInt({ min: 1 })
    .withMessage('ID demande invalide'),
    
  body('title')
    .optional()
    .trim()
    .isLength({ min: 5, max: 255 })
    .withMessage('Titre: 5-255 caractères'),
    
  body('description')
    .optional()
    .trim()
    .isLength({ min: 20, max: 2000 })
    .withMessage('Description: 20-2000 caractères'),
    
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
  param('associationId')
    .isInt({ min: 1 })
    .withMessage('ID association invalide'),
    
  param('requestId')
    .isInt({ min: 1 })
    .withMessage('ID demande invalide'),
    
  body('action')
    .isIn(['approve', 'reject', 'request_info'])
    .withMessage('Action invalide (approve, reject, request_info)'),
    
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
    
  body('rejectionReason')
    .if(body('action').equals('reject'))
    .trim()
    .isLength({ min: 10, max: 1000 })
    .withMessage('Motif refus requis (10-1000 caractères)'),
    
  body('requestedInfo')
    .if(body('action').equals('request_info'))
    .trim()
    .isLength({ min: 10, max: 1000 })
    .withMessage('Informations demandées requises (10-1000 caractères)'),
    
  handleValidationErrors
];

// 📝 ROUTES CRUD DEMANDES

/**
 * @route POST /api/v1/associations/:associationId/expense-requests
 * @desc Créer nouvelle demande de dépense
 * @access Membres (aides) / Bureau (autres dépenses)
 */
router.post('/:associationId/expense-requests',
  authMiddleware,
  checkAssociationMember,
  validateCreateExpenseRequest,
  expenseRequestController.createExpenseRequest
);

/**
 * @route GET /api/v1/associations/:associationId/expense-requests
 * @desc Lister demandes dépenses avec filtres et pagination
 * @access Membres (selon permissions)
 */
router.get('/:associationId/expense-requests',
  authMiddleware,
  checkAssociationMember,
  checkPermission('finances.view_treasury'), // ✅ AVEC PRÉFIXE
  [
    param('associationId')
      .isInt({ min: 1 })
      .withMessage('ID association invalide'),
      
    query('status')
      .optional()
      .isIn(['pending', 'under_review', 'additional_info_needed', 'approved', 'rejected', 'paid', 'cancelled'])
      .withMessage('Statut invalide'),
      
    query('expenseType')
      .optional()
      .isIn(['aide_membre', 'depense_operationnelle', 'pret_partenariat', 'projet_special', 'urgence_communautaire'])
      .withMessage('Type dépense invalide'),
      
    query('requesterId')
      .optional()
      .isInt({ min: 1 })
      .withMessage('ID demandeur invalide'),
      
    query('beneficiaryId')
      .optional()
      .isInt({ min: 1 })
      .withMessage('ID bénéficiaire invalide'),
      
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
      .isIn(['created_at', 'amountRequested', 'urgencyLevel', 'status'])
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
    param('associationId')
      .isInt({ min: 1 })
      .withMessage('ID association invalide'),
      
    param('requestId')
      .isInt({ min: 1 })
      .withMessage('ID demande invalide'),
      
    handleValidationErrors
  ],
  expenseRequestController.getExpenseRequestById 
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
    param('associationId')
      .isInt({ min: 1 })
      .withMessage('ID association invalide'),
      
    param('requestId')
      .isInt({ min: 1 })
      .withMessage('ID demande invalide'),
      
    body('reason')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Raison max 500 caractères'),
      
    handleValidationErrors
  ],
  expenseRequestController.cancelExpenseRequest
);

// ⚖️ ROUTES VALIDATION/APPROBATION

/**
 * @route POST /api/v1/associations/:associationId/expense-requests/:requestId/approve
 * @desc Approuver une demande de dépense
 * @access Bureau avec droits validation (president, tresorier, secretaire, admin_association)
 */
router.post('/:associationId/expense-requests/:requestId/approve',
  authMiddleware,
  checkAssociationMember,
  checkPermission('finances.validate_expenses'), // ✅ AVEC PRÉFIXE
  [
    param('associationId')
      .isInt({ min: 1 })
      .withMessage('ID association invalide'),
      
    param('requestId')
      .isInt({ min: 1 })
      .withMessage('ID demande invalide'),
      
    body('comment')
      .optional()
      .trim()
      .isLength({ max: 1000 })
      .withMessage('Commentaire max 1000 caractères'),
      
    body('amountApproved')
      .optional()
      .isFloat({ min: 0.01 })
      .withMessage('Montant approuvé invalide'),
      
    body('conditions')
      .optional()
      .trim()
      .isLength({ max: 1000 })
      .withMessage('Conditions max 1000 caractères'),
      
    handleValidationErrors
  ],
  expenseRequestController.approveExpenseRequest
);

/**
 * @route POST /api/v1/associations/:associationId/expense-requests/:requestId/reject
 * @desc Refuser une demande de dépense
 * @access Bureau avec droits validation (president, tresorier, secretaire, admin_association)
 */
router.post('/:associationId/expense-requests/:requestId/reject',
  authMiddleware,
  checkAssociationMember,
  checkPermission('finances.validate_expenses'), // ✅ AVEC PRÉFIXE
  [
    param('associationId')
      .isInt({ min: 1 })
      .withMessage('ID association invalide'),
      
    param('requestId')
      .isInt({ min: 1 })
      .withMessage('ID demande invalide'),
      
    body('rejectionReason')
      .trim()
      .isLength({ min: 10, max: 1000 })
      .withMessage('Motif de refus requis (10-1000 caractères)'),
      
    handleValidationErrors
  ],
  expenseRequestController.rejectExpenseRequest
);

/**
 * @route POST /api/v1/associations/:associationId/expense-requests/:requestId/request-info
 * @desc Demander des informations complémentaires
 * @access Bureau avec droits validation (president, tresorier, secretaire, admin_association)
 */
router.post('/:associationId/expense-requests/:requestId/request-info',
  authMiddleware,
  checkAssociationMember,
  checkPermission('finances.validate_expenses'), // ✅ AVEC PRÉFIXE
  [
    param('associationId')
      .isInt({ min: 1 })
      .withMessage('ID association invalide'),
      
    param('requestId')
      .isInt({ min: 1 })
      .withMessage('ID demande invalide'),
      
    body('requestedInfo')
      .trim()
      .isLength({ min: 10, max: 1000 })
      .withMessage('Informations demandées requises (10-1000 caractères)'),
      
    handleValidationErrors
  ],
  expenseRequestController.requestAdditionalInfo
);

/**
 * @route GET /api/v1/associations/:associationId/expense-requests-pending
 * @desc Demandes en attente de validation pour cet utilisateur
 * @access Bureau avec droits validation
 */
router.get('/:associationId/expense-requests-pending',
  authMiddleware,
  checkAssociationMember,
  checkPermission('finances.validate_expenses'), // ✅ AVEC PRÉFIXE
  [
    param('associationId')
      .isInt({ min: 1 })
      .withMessage('ID association invalide'),
      
    handleValidationErrors
  ],
  expenseRequestController.getPendingValidations
);

/**
 * @route GET /api/v1/associations/:associationId/expense-requests/pending-validations
 * @desc Demandes en attente de validation pour cet utilisateur
 * @access Bureau avec droits validation
 */
router.get('/:associationId/expense-requests/pending-validations',
  authMiddleware,
  checkAssociationMember,
  checkPermission('finances.validate_expenses'), // ✅ AVEC PRÉFIXE
  [
    param('associationId')
      .isInt({ min: 1 })
      .withMessage('ID association invalide'),
      
    handleValidationErrors
  ],
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
    param('associationId')
      .isInt({ min: 1 })
      .withMessage('ID association invalide'),
      
    param('requestId')
      .isInt({ min: 1 })
      .withMessage('ID demande invalide'),
      
    handleValidationErrors
  ],
  expenseRequestController.getValidationHistory
);

// 💳 ROUTES PAIEMENT

/**
 * @route POST /api/v1/associations/:associationId/expense-requests/:requestId/pay
 * @desc Confirmer paiement (manuel pour l'instant)
 * @access Trésorier + Président + admin_association
 */
router.post('/:associationId/expense-requests/:requestId/pay',
  authMiddleware,
  checkAssociationMember,
  checkPermission('finances.validate_expenses'), // ✅ AVEC PRÉFIXE
  [
    param('associationId')
      .isInt({ min: 1 })
      .withMessage('ID association invalide'),
      
    param('requestId')
      .isInt({ min: 1 })
      .withMessage('ID demande invalide'),
      
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

// 🔄 ROUTES REMBOURSEMENTS (PRÊTS)

/**
 * @route GET /api/v1/associations/:associationId/expense-requests/:requestId/repayments
 * @desc Lister remboursements d'un prêt
 * @access Bureau + Bénéficiaire
 */
router.get('/:associationId/expense-requests/:requestId/repayments',
  authMiddleware,
  checkAssociationMember,
  checkPermission('finances.view_treasury'), // ✅ AVEC PRÉFIXE
  [
    param('associationId')
      .isInt({ min: 1 })
      .withMessage('ID association invalide'),
      
    param('requestId')
      .isInt({ min: 1 })
      .withMessage('ID demande invalide'),
      
    handleValidationErrors
  ],
  expenseRequestController.getRepayments
);

/**
 * @route POST /api/v1/associations/:associationId/expense-requests/:requestId/repayments
 * @desc Enregistrer remboursement de prêt
 * @access Trésorier + admin_association
 */
router.post('/:associationId/expense-requests/:requestId/repayments',
  authMiddleware,
  checkAssociationMember,
  checkPermission('finances.validate_expenses'), // ✅ AVEC PRÉFIXE
  [
    param('associationId')
      .isInt({ min: 1 })
      .withMessage('ID association invalide'),
      
    param('requestId')
      .isInt({ min: 1 })
      .withMessage('ID demande invalide'),
      
    body('amount')
      .isFloat({ min: 0.01 })
      .withMessage('Montant remboursement requis'),
      
    body('paymentDate')
      .isISO8601()
      .withMessage('Date paiement requise'),
      
    body('paymentMethod')
      .isIn(['bank_transfer', 'card_payment', 'cash', 'check', 'mobile_money'])
      .withMessage('Méthode paiement invalide'),
      
    body('paymentMode')
      .optional()
      .isIn(['digital', 'manual'])
      .withMessage('Mode paiement invalide'),
      
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
      
    handleValidationErrors
  ],
  expenseRequestController.recordRepayment
);

// 📊 ROUTES STATISTIQUES & ANALYTICS

/**
 * @route GET /api/v1/associations/:associationId/expense-requests/statistics
 * @desc Statistiques dépenses association
 * @access Bureau Central avec droits finances
 */
router.get('/:associationId/expense-requests/statistics',
  authMiddleware,
  checkAssociationMember,
  checkPermission('finances.view_treasury'), // ✅ AVEC PRÉFIXE
  [
    param('associationId')
      .isInt({ min: 1 })
      .withMessage('ID association invalide'),
      
    query('period')
      .optional()
      .isIn(['month', 'quarter', 'year', 'all'])
      .withMessage('Période invalide'),
      
    query('groupBy')
      .optional()
      .isIn(['type', 'month', 'section', 'status'])
      .withMessage('Groupement invalide'),
      
    handleValidationErrors
  ],
  expenseRequestController.getExpenseStatistics
);

/**
 * @route GET /api/v1/associations/:associationId/financial-summary
 * @desc Résumé financier complet association
 * @access admin_association, president, tresorier, secretaire
 */
router.get('/:associationId/financial-summary',
  authMiddleware,
  checkAssociationMember,
  checkPermission('finances.view_treasury'), // ✅ AVEC PRÉFIXE
  [
    param('associationId')
      .isInt({ min: 1 })
      .withMessage('ID association invalide'),
      
    query('period')
      .optional()
      .isIn(['all', 'month', 'quarter', 'year'])
      .withMessage('Période invalide'),
      
    query('includeProjections')
      .optional()
      .isBoolean()
      .withMessage('includeProjections doit être boolean'),
      
    query('includeAlerts')
      .optional()
      .isBoolean()
      .withMessage('includeAlerts doit être boolean'),
      
    query('includeHistory')
      .optional()
      .isBoolean()
      .withMessage('includeHistory doit être boolean'),
      
    query('historyMonths')
      .optional()
      .isInt({ min: 1, max: 24 })
      .withMessage('historyMonths doit être entre 1 et 24'),
      
    handleValidationErrors
  ],
  expenseRequestController.getFinancialSummary
);

/**
 * @route GET /api/v1/associations/:associationId/expense-requests/export
 * @desc Export comptable des dépenses
 * @access Trésorier + Président + admin_association
 */
router.get('/:associationId/expense-requests/export',
  authMiddleware,
  checkAssociationMember,
  checkPermission('finances.export_data'), // ✅ AVEC PRÉFIXE
  [
    param('associationId')
      .isInt({ min: 1 })
      .withMessage('ID association invalide'),
      
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
      
    handleValidationErrors
  ],
  expenseRequestController.exportExpenseData
);

module.exports = router;