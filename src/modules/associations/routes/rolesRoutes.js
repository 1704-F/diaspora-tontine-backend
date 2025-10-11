// src/modules/associations/routes/rolesRoutes.js
// Routes API pour gestion des rôles et permissions RBAC

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const { authenticate } = require('../../../core/auth/middleware/auth');
const { checkAssociationMember, checkPermission } = require('../../../core/middleware/checkPermission');
const { handleValidationErrors } = require('../../../core/middleware/validation');
const rolesController = require('../controllers/rolesController');

// 🔐 MIDDLEWARE ADMIN ONLY
// Seul l'admin de l'association peut gérer les rôles
const requireAdmin = async (req, res, next) => {
  if (req.membership?.isAdmin) {
    return next();
  }
  
  return res.status(403).json({
    error: 'Seul l\'administrateur de l\'association peut gérer les rôles',
    code: 'ADMIN_ONLY'
  });
};

// 📋 ROUTES CRUD RÔLES

/**
 * @route GET /api/v1/associations/:id/roles
 * @desc Lister tous les rôles de l'association
 * @access Admin association
 */
router.get('/:id/roles',
  authenticate,
  checkAssociationMember,
  requireAdmin,
  [
    param('id').isInt({ min: 1 }).withMessage('ID association invalide'),
    handleValidationErrors
  ],
  rolesController.getRoles
);

/**
 * @route GET /api/v1/associations/:id/roles/:roleId
 * @desc Détails d'un rôle spécifique
 * @access Admin association
 */
router.get('/:id/roles/:roleId',
  authenticate,
  checkAssociationMember,
  requireAdmin,
  [
    param('id').isInt({ min: 1 }).withMessage('ID association invalide'),
    param('roleId').trim().notEmpty().withMessage('ID rôle requis'),
    handleValidationErrors
  ],
  rolesController.getRoleDetails
);

/**
 * @route POST /api/v1/associations/:id/roles
 * @desc Créer un nouveau rôle
 * @access Admin association
 */
router.post('/:id/roles',
  authenticate,
  checkAssociationMember,
  requireAdmin,
  [
    param('id').isInt({ min: 1 }).withMessage('ID association invalide'),
    
    body('name')
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('Nom du rôle requis (2-50 caractères)'),
    
    body('description')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Description max 500 caractères'),
    
    body('permissions')
      .isArray()
      .withMessage('Permissions doit être un tableau'),
    
    body('permissions.*')
      .trim()
      .notEmpty()
      .withMessage('Chaque permission doit être une chaîne non vide'),
    
    body('color')
      .optional()
      .matches(/^#[0-9A-F]{6}$/i)
      .withMessage('Couleur doit être au format hexadécimal (#RRGGBB)'),
    
    body('icon')
      .optional()
      .trim()
      .isLength({ min: 1, max: 10 })
      .withMessage('Icône max 10 caractères'),
    
    body('isUnique')
      .optional()
      .isBoolean()
      .withMessage('isUnique doit être un boolean'),
    
    handleValidationErrors
  ],
  rolesController.createRole
);

/**
 * @route PUT /api/v1/associations/:id/roles/:roleId
 * @desc Modifier un rôle existant
 * @access Admin association
 */
router.put('/:id/roles/:roleId',
  authenticate,
  checkAssociationMember,
  requireAdmin,
  [
    param('id').isInt({ min: 1 }).withMessage('ID association invalide'),
    param('roleId').trim().notEmpty().withMessage('ID rôle requis'),
    
    body('name')
      .optional()
      .trim()
      .isLength({ min: 2, max: 50 })
      .withMessage('Nom du rôle: 2-50 caractères'),
    
    body('description')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Description max 500 caractères'),
    
    body('permissions')
      .optional()
      .isArray()
      .withMessage('Permissions doit être un tableau'),
    
    body('color')
      .optional()
      .matches(/^#[0-9A-F]{6}$/i)
      .withMessage('Couleur doit être au format hexadécimal'),
    
    body('icon')
      .optional()
      .trim()
      .isLength({ min: 1, max: 10 })
      .withMessage('Icône max 10 caractères'),
    
    handleValidationErrors
  ],
  rolesController.updateRole
);

/**
 * @route DELETE /api/v1/associations/:id/roles/:roleId
 * @desc Supprimer un rôle
 * @access Admin association
 */
router.delete('/:id/roles/:roleId',
  authenticate,
  checkAssociationMember,
  requireAdmin,
  [
    param('id').isInt({ min: 1 }).withMessage('ID association invalide'),
    param('roleId').trim().notEmpty().withMessage('ID rôle requis'),
    
    query('force')
      .optional()
      .isIn(['true', 'false'])
      .withMessage('force doit être true ou false'),
    
    handleValidationErrors
  ],
  rolesController.deleteRole
);

// 👥 ROUTES ATTRIBUTION RÔLES AUX MEMBRES

/**
 * @route POST /api/v1/associations/:id/members/:memberId/roles
 * @desc Attribuer des rôles à un membre
 * @access Admin association
 */
router.post('/:id/members/:memberId/roles',
  authenticate,
  checkAssociationMember,
  requireAdmin,
  [
    param('id').isInt({ min: 1 }).withMessage('ID association invalide'),
    param('memberId').isInt({ min: 1 }).withMessage('ID membre invalide'),
    
    body('roleIds')
      .isArray({ min: 0 })
      .withMessage('roleIds doit être un tableau'),
    
    body('roleIds.*')
      .trim()
      .notEmpty()
      .withMessage('Chaque roleId doit être une chaîne non vide'),
    
    handleValidationErrors
  ],
  rolesController.assignRolesToMember
);

/**
 * @route DELETE /api/v1/associations/:id/members/:memberId/roles/:roleId
 * @desc Retirer un rôle d'un membre
 * @access Admin association
 */
router.delete('/:id/members/:memberId/roles/:roleId',
  authenticate,
  checkAssociationMember,
  requireAdmin,
  [
    param('id').isInt({ min: 1 }).withMessage('ID association invalide'),
    param('memberId').isInt({ min: 1 }).withMessage('ID membre invalide'),
    param('roleId').trim().notEmpty().withMessage('ID rôle requis'),
    handleValidationErrors
  ],
  rolesController.removeRoleFromMember
);

/**
 * @route GET /api/v1/associations/:id/members/:memberId/roles
 * @desc Voir les rôles et permissions d'un membre
 * @access Admin association ou le membre lui-même
 */
router.get('/:id/members/:memberId/roles',
  authenticate,
  checkAssociationMember,
  [
    param('id').isInt({ min: 1 }).withMessage('ID association invalide'),
    param('memberId').isInt({ min: 1 }).withMessage('ID membre invalide'),
    handleValidationErrors
  ],
  // Vérification custom: admin OU le membre lui-même
  async (req, res, next) => {
    const isAdmin = req.membership?.isAdmin;
    const isSelf = req.membership?.id === parseInt(req.params.memberId);
    
    if (isAdmin || isSelf) {
      return next();
    }
    
    return res.status(403).json({
      error: 'Accès refusé',
      code: 'ACCESS_DENIED'
    });
  },
  rolesController.getMemberRoles
);

// 🔐 ROUTES PERMISSIONS CUSTOM

/**
 * @route POST /api/v1/associations/:id/members/:memberId/permissions/grant
 * @desc Accorder une permission individuelle à un membre
 * @access Admin association
 */
router.post('/:id/members/:memberId/permissions/grant',
  authenticate,
  checkAssociationMember,
  requireAdmin,
  [
    param('id').isInt({ min: 1 }).withMessage('ID association invalide'),
    param('memberId').isInt({ min: 1 }).withMessage('ID membre invalide'),
    
    body('permissionId')
      .trim()
      .notEmpty()
      .withMessage('ID permission requis'),
    
    handleValidationErrors
  ],
  rolesController.grantPermission
);

/**
 * @route POST /api/v1/associations/:id/members/:memberId/permissions/revoke
 * @desc Révoquer une permission individuelle d'un membre
 * @access Admin association
 */
router.post('/:id/members/:memberId/permissions/revoke',
  authenticate,
  checkAssociationMember,
  requireAdmin,
  [
    param('id').isInt({ min: 1 }).withMessage('ID association invalide'),
    param('memberId').isInt({ min: 1 }).withMessage('ID membre invalide'),
    
    body('permissionId')
      .trim()
      .notEmpty()
      .withMessage('ID permission requis'),
    
    handleValidationErrors
  ],
  rolesController.revokePermission
);

// 📋 ROUTES PERMISSIONS DISPONIBLES

/**
 * @route GET /api/v1/associations/:id/permissions
 * @desc Liste des permissions disponibles dans l'association
 * @access Tous les membres actifs
 */
router.get('/:id/permissions',
  authenticate,
  checkAssociationMember,
  [
    param('id').isInt({ min: 1 }).withMessage('ID association invalide'),
    handleValidationErrors
  ],
  async (req, res) => {
    try {
      const { Association } = require('../../../models');
      const association = await Association.findByPk(req.params.id, {
        attributes: ['id', 'name', 'rolesConfiguration']
      });
      
      if (!association) {
        return res.status(404).json({
          error: 'Association introuvable',
          code: 'ASSOCIATION_NOT_FOUND'
        });
      }
      
      const availablePermissions = association.rolesConfiguration?.availablePermissions || [];
      
      // Grouper par catégorie
      const grouped = availablePermissions.reduce((acc, perm) => {
        const category = perm.category || 'autres';
        if (!acc[category]) acc[category] = [];
        acc[category].push(perm);
        return acc;
      }, {});
      
      res.json({
        success: true,
        data: {
          permissions: availablePermissions,
          grouped,
          total: availablePermissions.length
        }
      });
      
    } catch (error) {
      console.error('Erreur récupération permissions:', error);
      res.status(500).json({
        error: 'Erreur récupération permissions',
        code: 'PERMISSIONS_FETCH_ERROR'
      });
    }
  }
);

// 👑 ROUTE TRANSFERT ADMIN

/**
 * @route POST /api/v1/associations/:id/transfer-admin
 * @desc Transférer le statut d'administrateur à un autre membre
 * @access Admin actuel uniquement
 */
router.post('/:id/transfer-admin',
  authenticate,
  checkAssociationMember,
  requireAdmin,
  [
    param('id').isInt({ min: 1 }).withMessage('ID association invalide'),
    
    body('newAdminMemberId')
      .isInt({ min: 1 })
      .withMessage('ID du nouveau membre admin requis'),
    
    handleValidationErrors
  ],
  rolesController.transferAdmin
);

// 🚨 GESTION D'ERREURS
router.use((error, req, res, next) => {
  console.error('Erreur routes rôles:', error);
  
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Données invalides',
      code: 'VALIDATION_ERROR',
      details: error.errors
    });
  }
  
  res.status(500).json({
    error: 'Erreur serveur',
    code: 'INTERNAL_SERVER_ERROR',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

module.exports = router;