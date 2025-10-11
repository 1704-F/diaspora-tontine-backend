// src/modules/associations/routes/incomeEntries.js
// Routes API pour gestion des entrées d'argent personnalisées

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const { authenticate: authMiddleware } = require('../../../core/auth/middleware/auth');
const { handleValidationErrors } = require('../../../core/middleware/validation');
const { checkAssociationMember, checkPermission } = require('../../../core/middleware/checkPermission');

const incomeEntryController = require('../controllers/incomeEntryController');

// 📋 VALIDATIONS

const validateCreateIncomeEntry = [
  param('associationId')
    .isInt({ min: 1 })
    .withMessage('ID association invalide'),

  body('incomeType')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Type d\'entrée requis (2-50 caractères)'),

  body('amount')
    .isFloat({ min: 0.01, max: 1000000 })
    .withMessage('Montant invalide (0.01 - 1,000,000)'),

  body('currency')
    .optional()
    .isIn(['EUR', 'USD', 'GBP', 'CAD', 'CHF', 'XOF', 'XAF'])
    .withMessage('Devise non supportée'),

  body('sourceType')
    .isIn(['individual', 'company', 'government', 'ngo', 'foundation', 'member', 'anonymous'])
    .withMessage('Type de source invalide'),

  body('title')
    .trim()
    .isLength({ min: 5, max: 255 })
    .withMessage('Titre requis (5-255 caractères)'),

  body('receivedDate')
    .isISO8601()
    .withMessage('Date de réception invalide (format ISO8601)'),

  body('paymentMethod')
    .isIn(['bank_transfer', 'check', 'cash', 'card_payment', 'mobile_money', 'crypto', 'other'])
    .withMessage('Méthode de paiement invalide'),

  body('fees')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Frais doivent être positifs'),

  body('sectionId')
    .optional()
    .isInt({ min: 1 })
    .withMessage('ID section invalide'),

  body('isAnonymous')
    .optional()
    .isBoolean()
    .withMessage('isAnonymous doit être boolean'),

  body('restrictedUse')
    .optional()
    .isBoolean()
    .withMessage('restrictedUse doit être boolean'),

  body('publiclyVisible')
    .optional()
    .isBoolean()
    .withMessage('publiclyVisible doit être boolean'),

  body('thanksRequired')
    .optional()
    .isBoolean()
    .withMessage('thanksRequired doit être boolean'),

  // Validation conditionnelle : si pas anonyme, sourceName requis
  body('sourceName')
    .if(body('isAnonymous').equals(false))
    .trim()
    .isLength({ min: 2, max: 255 })
    .withMessage('Nom source requis si pas anonyme'),

  handleValidationErrors
];

const validateUpdateIncomeEntry = [
  param('associationId')
    .isInt({ min: 1 })
    .withMessage('ID association invalide'),

  param('entryId')
    .isInt({ min: 1 })
    .withMessage('ID entrée invalide'),

  body('status')
    .optional()
    .isIn(['pending', 'validated', 'rejected', 'cancelled'])
    .withMessage('Statut invalide'),

  body('amount')
    .optional()
    .isFloat({ min: 0.01 })
    .withMessage('Montant invalide'),

  handleValidationErrors
];

const validateGetIncomeEntries = [
  param('associationId')
    .isInt({ min: 1 })
    .withMessage('ID association invalide'),

  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page doit être un entier positif'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limite doit être entre 1 et 100'),

  query('status')
    .optional()
    .isIn(['all', 'pending', 'validated', 'rejected', 'cancelled'])
    .withMessage('Statut filtre invalide'),

  query('sourceType')
    .optional()
    .isIn(['all', 'individual', 'company', 'government', 'ngo', 'foundation', 'member', 'anonymous'])
    .withMessage('Type source filtre invalide'),

  query('dateFrom')
    .optional()
    .isISO8601()
    .withMessage('Date début invalide'),

  query('dateTo')
    .optional()
    .isISO8601()
    .withMessage('Date fin invalide'),

  query('minAmount')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Montant minimum invalide'),

  query('maxAmount')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Montant maximum invalide'),

  handleValidationErrors
];

const validateValidateIncomeEntry = [
  param('associationId')
    .isInt({ min: 1 })
    .withMessage('ID association invalide'),

  param('entryId')
    .isInt({ min: 1 })
    .withMessage('ID entrée invalide'),

  body('validationNote')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Note validation max 1000 caractères'),

  handleValidationErrors
];

const validateRejectIncomeEntry = [
  param('associationId')
    .isInt({ min: 1 })
    .withMessage('ID association invalide'),

  param('entryId')
    .isInt({ min: 1 })
    .withMessage('ID entrée invalide'),

  body('rejectionReason')
    .trim()
    .isLength({ min: 10, max: 1000 })
    .withMessage('Motif refus requis (10-1000 caractères)'),

  handleValidationErrors
];

// 🆔 MIDDLEWARE PERMISSIONS SPÉCIFIQUES - SUPPRIMÉ
// Utilisation des middleware existants checkAssociationMember, etc.

// 📝 ROUTES CRUD PRINCIPALES

/**
 * @route POST /api/v1/associations/:associationId/income-entries
 * @desc Créer nouvelle entrée d'argent
 * @access Bureau association (admin, président, trésorier, secrétaire)
 */
router.post('/:associationId/income-entries',
  authMiddleware,
  checkAssociationMember,
  checkPermission('validate_expenses'),
  validateCreateIncomeEntry,
  incomeEntryController.createIncomeEntry
);

/**
 * @route GET /api/v1/associations/:associationId/income-entries
 * @desc Lister entrées d'argent avec filtres
 * @access Bureau association
 */
router.get('/:associationId/income-entries',
  authMiddleware,
  checkAssociationMember,
  checkPermission('view_finances'),
  validateGetIncomeEntries,
  incomeEntryController.getIncomeEntries
);

/**
 * @route GET /api/v1/associations/:associationId/income-entries/:entryId
 * @desc Détails d'une entrée d'argent
 * @access Bureau association
 */
router.get('/:associationId/income-entries/:entryId',
  authMiddleware,
  checkAssociationMember,
  checkPermission('view_finances'),
  [
    param('associationId').isInt({ min: 1 }),
    param('entryId').isInt({ min: 1 }),
    handleValidationErrors
  ],
  incomeEntryController.getIncomeEntryDetails
);

/**
 * @route PUT /api/v1/associations/:associationId/income-entries/:entryId
 * @desc Modifier entrée d'argent (avant validation)
 * @access Bureau association
 */
router.put('/:associationId/income-entries/:entryId',
  authMiddleware,
  checkAssociationMember,
  checkPermission('validate_expenses'),
  validateUpdateIncomeEntry,
  incomeEntryController.updateIncomeEntry
);

/**
 * @route DELETE /api/v1/associations/:associationId/income-entries/:entryId
 * @desc Annuler entrée d'argent
 * @access Bureau association
 */
router.delete('/:associationId/income-entries/:entryId',
  authMiddleware,
  checkAssociationMember,
  checkPermission('validate_expenses'),
  [
    param('associationId').isInt({ min: 1 }),
    param('entryId').isInt({ min: 1 }),
    handleValidationErrors
  ],
  incomeEntryController.cancelIncomeEntry
);

// ⚖️ ROUTES WORKFLOW VALIDATION

/**
 * @route POST /api/v1/associations/:associationId/income-entries/:entryId/validate
 * @desc Valider entrée d'argent
 * @access Bureau avec droits validation (admin, président, trésorier)
 */
router.post('/:associationId/income-entries/:entryId/validate',
  authMiddleware,
  checkAssociationMember,
  checkPermission('validate_expenses'),
  validateValidateIncomeEntry,
  incomeEntryController.validateIncomeEntry
);

/**
 * @route POST /api/v1/associations/:associationId/income-entries/:entryId/reject
 * @desc Rejeter entrée d'argent
 * @access Bureau avec droits validation
 */
router.post('/:associationId/income-entries/:entryId/reject',
  authMiddleware,
  checkAssociationMember,
  checkPermission('validate_expenses'),
  validateRejectIncomeEntry,
  incomeEntryController.rejectIncomeEntry
);

/**
 * @route POST /api/v1/associations/:associationId/income-entries/:entryId/resubmit
 * @desc Resoumettre entrée après rejet
 * @access Bureau association
 */
router.post('/:associationId/income-entries/:entryId/resubmit',
  authMiddleware,
  checkAssociationMember,
  checkPermission('validate_expenses'),
  [
    param('associationId').isInt({ min: 1 }),
    param('entryId').isInt({ min: 1 }),
    body('updatedReason').optional().trim().isLength({ max: 1000 }),
    handleValidationErrors
  ],
  incomeEntryController.resubmitIncomeEntry
);

// 🧾 ROUTES DOCUMENTS & REÇUS

/**
 * @route POST /api/v1/associations/:associationId/income-entries/:entryId/generate-receipt
 * @desc Générer reçu fiscal
 * @access Bureau (admin, président, trésorier)
 */
router.post('/:associationId/income-entries/:entryId/generate-receipt',
  authMiddleware,
  checkAssociationMember,
  checkPermission('validate_expenses'),
  [
    param('associationId').isInt({ min: 1 }),
    param('entryId').isInt({ min: 1 }),
    handleValidationErrors
  ],
  incomeEntryController.generateReceipt
);

/**
 * @route POST /api/v1/associations/:associationId/income-entries/:entryId/send-thanks
 * @desc Envoyer remerciements
 * @access Bureau association
 */
router.post('/:associationId/income-entries/:entryId/send-thanks',
  authMiddleware,
  checkAssociationMember,
  checkPermission('validate_expenses'),
  [
    param('associationId').isInt({ min: 1 }),
    param('entryId').isInt({ min: 1 }),
    body('thanksMessage').optional().trim().isLength({ max: 2000 }),
    handleValidationErrors
  ],
  incomeEntryController.sendThanks
);

/**
 * @route POST /api/v1/associations/:associationId/income-entries/:entryId/documents
 * @desc Upload documents justificatifs
 * @access Bureau association
 */
router.post('/:associationId/income-entries/:entryId/documents',
  authMiddleware,
  checkAssociationMember,
  checkPermission('validate_expenses'),
  [
    param('associationId').isInt({ min: 1 }),
    param('entryId').isInt({ min: 1 }),
    // Middleware upload Cloudinary à ajouter
    handleValidationErrors
  ],
  incomeEntryController.uploadDocument
);

// 📊 ROUTES STATISTIQUES & EXPORTS

/**
 * @route GET /api/v1/associations/:associationId/income-entries/statistics
 * @desc Statistiques entrées d'argent
 * @access Bureau association
 */
router.get('/:associationId/income-entries/statistics',
  authMiddleware,
  checkAssociationMember,
  checkPermission('view_finances'),
  [
    param('associationId').isInt({ min: 1 }),
    query('period').optional().isIn(['month', 'quarter', 'year', 'all']),
    query('groupBy').optional().isIn(['type', 'source', 'month', 'status']),
    handleValidationErrors
  ],
  incomeEntryController.getIncomeStatistics
);

/**
 * @route GET /api/v1/associations/:associationId/income-entries/export
 * @desc Export données entrées d'argent
 * @access Bureau association
 */
router.get('/:associationId/income-entries/export',
  authMiddleware,
  checkAssociationMember,
  checkPermission('view_finances'),
  [
    param('associationId').isInt({ min: 1 }),
    query('format').optional().isIn(['excel', 'csv', 'pdf']),
    query('dateFrom').isISO8601(),
    query('dateTo').isISO8601(),
    query('includeDetails').optional().isBoolean(),
    handleValidationErrors
  ],
  incomeEntryController.exportIncomeData
);

/**
 * @route GET /api/v1/associations/:associationId/income-entries/pending-validation
 * @desc Entrées en attente de validation pour cet utilisateur
 * @access Bureau avec droits validation
 */
router.get('/:associationId/income-entries/pending-validation',
  authMiddleware,
  checkAssociationMember,
  checkPermission('validate_expenses'),
  [
    param('associationId').isInt({ min: 1 }),
    handleValidationErrors
  ],
  incomeEntryController.getPendingValidations
);

// 🔧 ROUTES CONFIGURATION

/**
 * @route GET /api/v1/associations/:associationId/income-types
 * @desc Lister types d'entrées configurés
 * @access Membres association
 */
router.get('/:associationId/income-types',
  authMiddleware,
  checkAssociationMember,
  checkPermission('view_finances'),
  [
    param('associationId').isInt({ min: 1 }),
    handleValidationErrors
  ],
  incomeEntryController.getIncomeTypes
);

/**
 * @route POST /api/v1/associations/:associationId/income-types
 * @desc Créer nouveau type d'entrée
 * @access Admin association
 */
router.post('/:associationId/income-types',
  authMiddleware,
  checkAssociationMember,
  checkPermission('validate_expenses'),
  [
    param('associationId').isInt({ min: 1 }),
    body('typeName').trim().isLength({ min: 2, max: 50 }),
    body('typeLabel').trim().isLength({ min: 2, max: 100 }),
    body('description').optional().trim().isLength({ max: 500 }),
    body('defaultSourceType').optional().isIn(['individual', 'company', 'government', 'ngo', 'foundation']),
    body('requiresReceipt').optional().isBoolean(),
    handleValidationErrors
  ],
  incomeEntryController.createIncomeType
);

// 🚨 MIDDLEWARE GESTION ERREURS
router.use((error, req, res, next) => {
  console.error('Erreur routes income entries:', error);
  
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Données invalides',
      code: 'VALIDATION_ERROR',
      details: error.errors
    });
  }
  
  if (error.name === 'SequelizeForeignKeyConstraintError') {
    return res.status(400).json({
      error: 'Référence invalide',
      code: 'FOREIGN_KEY_ERROR'
    });
  }
  
  res.status(500).json({
    error: 'Erreur serveur',
    code: 'INTERNAL_SERVER_ERROR'
  });
});

module.exports = router;