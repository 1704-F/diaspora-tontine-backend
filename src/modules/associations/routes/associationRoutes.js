//src/modules/associations/routes/associationRoutes.js
const express = require('express');
const multer = require('multer');

// ✅ IMPORTS MODIFIÉS - Nouveau système RBAC
const { authenticate } = require('../../../core/auth/middleware/auth'); // ← GARDER authenticate
const { checkAssociationMember, checkPermission } = require('../../../core/middleware/checkPermission'); // ← NOUVEAU

const { 
  validateCreateAssociation,
  validateUpdateAssociation,
  validateListAssociations,
  validateId,
  validateAssociationId
} = require('../../../core/middleware/validation');

const { associationController, sectionController, memberController } = require('../controllers');

// Configuration multer pour upload de fichiers
const upload = multer({
  dest: 'uploads/documents/',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'image/jpeg', 
      'image/png',
      'image/jpg'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Type de fichier non autorisé'), false);
    }
  }
});

const router = express.Router();

// 🏛️ ROUTES ASSOCIATIONS PRINCIPALES

// Créer association (avec KYB)
router.post('/',
  authenticate,
  validateCreateAssociation,
  associationController.createAssociation
);

// Lister associations de l'utilisateur
router.get('/',
  authenticate,
  validateListAssociations,
  associationController.listUserAssociations
);

// Rechercher associations publiques
router.get('/search',
  validateListAssociations, // Pas d'auth requise
  associationController.searchPublicAssociations
);

// Détails association spécifique
router.get('/:id',
  authenticate,
  validateId,
  associationController.getAssociation
);

// Modifier association
// ✅ MIGRÉ: president → modify_settings
router.put('/:id',
  authenticate,
  validateId,
  validateUpdateAssociation,
  checkAssociationMember,
  checkPermission('modify_settings'),
  associationController.updateAssociation
);

// Supprimer association (soft delete)
// ✅ MIGRÉ: president → modify_settings
router.delete('/:id',
  authenticate,
  validateId,
  checkAssociationMember,
  checkPermission('modify_settings'),
  associationController.deleteAssociation
);

// Mettre à jour configuration (types membres, bureau, permissions)
// ✅ MIGRÉ: admin/bureau → manage_roles
router.put('/:id/configuration',
  authenticate,
  validateId,
  checkAssociationMember,
  checkPermission('manage_roles'),
  associationController.updateConfiguration
);

// Statistiques association
// ✅ MIGRÉ: member → checkAssociationMember seulement
router.get('/:id/stats',
  authenticate,
  validateId,
  checkAssociationMember, // Tous les membres peuvent voir
  associationController.getAssociationStats
);

// 🏗️ ROUTES SECTIONS

// Créer section
// ✅ MIGRÉ: central_board → manage_sections
router.post('/:associationId/sections',
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission('manage_sections'),
  sectionController.createSection
);

// Lister sections
// ✅ MIGRÉ: member → checkAssociationMember seulement
router.get('/:associationId/sections',
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  sectionController.listSections
);

// Détails d'une section
// ✅ MIGRÉ: member → checkAssociationMember seulement
router.get('/:associationId/sections/:sectionId',
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  sectionController.getSectionDetails
);

// Modifier section
// ✅ MIGRÉ: responsable_section → manage_sections
router.put('/:associationId/sections/:sectionId',
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission('manage_sections'),
  sectionController.updateSection
);

// Mettre à jour bureau section
// ✅ MIGRÉ: admin/central_board → manage_sections
router.put('/:associationId/sections/:sectionId/bureau',
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission('manage_sections'),
  sectionController.updateBureauSection
);

// Statistiques section
// ✅ MIGRÉ: member → checkAssociationMember seulement
router.get('/:associationId/sections/:sectionId/stats',
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  sectionController.getSectionStats
);

// Supprimer section
// ✅ MIGRÉ: president → manage_sections
router.delete('/:associationId/sections/:sectionId',
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission('manage_sections'),
  sectionController.deleteSection
);

// Rapport comparatif sections
// ✅ MIGRÉ: central_board → view_sections
router.get('/:associationId/sections-comparison',
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission('view_sections'),
  sectionController.getSectionsComparison
);

// Transférer membre entre sections
// ✅ MIGRÉ: central_board → manage_members
router.post('/:associationId/sections/:sectionId/transfer-member',
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission('manage_members'),
  sectionController.transferMember
);

// 👥 ROUTES MEMBRES

// Ajouter membre
// ✅ MIGRÉ: admin_association → manage_members
router.post('/:associationId/members',
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission('manage_members'),
  memberController.addMember
);

// Lister membres
// ✅ MIGRÉ: member → view_members
router.get('/:associationId/members',
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission('view_members'),
  memberController.listMembers
);

// Membres d'une section
// ✅ MIGRÉ: member → view_members
router.get('/:associationId/sections/:sectionId/members',
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission('view_members'),
  memberController.getSectionMembers
);

// Dashboard membre personnel
// ✅ MIGRÉ: member → checkAssociationMember seulement (son propre dashboard)
router.get('/:associationId/my-dashboard',
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  memberController.getMemberDashboard
);

// Obtenir détails d'un membre
// ✅ MIGRÉ: member → view_members
router.get('/:associationId/members/:memberId',
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission('view_members'),
  memberController.getMember
);

// Modifier membre
// ✅ MIGRÉ: admin_association → manage_members
router.put('/:associationId/members/:memberId',
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission('manage_members'),
  memberController.updateMember
);

// Modifier statut membre
// ✅ MIGRÉ: central_board → manage_members
router.put('/:associationId/members/:memberId/status',
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission('manage_members'),
  memberController.updateMemberStatus
);

// Historique cotisations membre
// ✅ MIGRÉ: member → view_members (peut voir ses cotisations ou autres si permissions)
router.get('/:associationId/members/:memberId/cotisations',
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission('view_members'),
  memberController.getMemberCotisations
);

// Configurer prélèvement automatique
router.put('/:associationId/members/:memberId/auto-payment',
  authenticate,
  validateAssociationId,
  memberController.setupAutoPayment // Vérification interne
);

// 💰 ROUTES COTISATIONS

// Payer cotisation (CB prioritaire)
router.post('/cotisations',
  authenticate,
  memberController.payCotisation
);

// Rapport cotisations association
// ✅ MIGRÉ: tresorier → view_finances
router.get('/:associationId/cotisations-report',
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission('view_finances'),
  memberController.getCotisationsReport
);

// Import historique cotisations
// ✅ MIGRÉ: central_board → manage_cotisations
router.post('/:associationId/import-cotisations',
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission('manage_cotisations'),
  memberController.importCotisationsHistory
);

// Cotisations en retard
// ✅ MIGRÉ: tresorier → view_finances
router.get('/:associationId/overdue-cotisations',
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission('view_finances'),
  memberController.getOverdueCotisations
);

// Dashboard cotisations
// ✅ MIGRÉ: admin/bureau → view_finances
router.get('/:associationId/cotisations-dashboard',
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission('view_finances'),
  memberController.getCotisationsDashboard
);

// Ajouter cotisation manuelle
// ✅ MIGRÉ: admin/bureau → manage_cotisations
router.post('/:associationId/cotisations-manual',
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission('manage_cotisations'),
  memberController.addManualCotisation
);

// 📄 ROUTES DOCUMENTS

// Upload document KYB
// ✅ MIGRÉ: admin → upload_documents
router.post('/:id/documents',
  authenticate,
  upload.single('document'),
  checkAssociationMember,
  checkPermission('upload_documents'),
  associationController.uploadDocument
);

// Lister documents association
// ✅ MIGRÉ: member → view_documents
router.get('/:id/documents',
  authenticate,
  checkAssociationMember,
  checkPermission('view_documents'),
  associationController.getDocuments
);

// Télécharger document spécifique
// ✅ MIGRÉ: member → view_documents
router.get('/:id/documents/:documentId',
  authenticate,
  checkAssociationMember,
  checkPermission('view_documents'),
  associationController.downloadDocument
);

// Supprimer document spécifique
// ✅ MIGRÉ: admin → manage_documents
router.delete('/:id/documents/:documentId',
  authenticate,
  checkAssociationMember,
  checkPermission('manage_documents'),
  associationController.deleteDocument
);

// ⚙️ SETUP ASSOCIATION

// Route spécifique pour setup association
// ✅ MIGRÉ: admin → manage_roles
router.put('/:id/setup',
  authenticate,
  validateId,
  checkAssociationMember,
  checkPermission('manage_roles'),
  associationController.updateAssociationSetup
);

// 🚨 GESTION D'ERREURS
router.use((error, req, res, next) => {
  console.error('Erreur routes associations:', error);
  
  // Erreurs Sequelize
  if (error.name === 'SequelizeValidationError') {
    return res.status(400).json({
      error: 'Données invalides',
      code: 'VALIDATION_ERROR',
      details: error.errors.map(err => ({
        field: err.path,
        message: err.message,
        value: err.value
      }))
    });
  }
  
  // Erreurs contraintes FK
  if (error.name === 'SequelizeForeignKeyConstraintError') {
    return res.status(400).json({
      error: 'Référence invalide',
      code: 'FOREIGN_KEY_ERROR',
      details: error.message
    });
  }
  
  // Erreurs unicité
  if (error.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({
      error: 'Conflit de données',
      code: 'UNIQUE_CONSTRAINT_ERROR',
      details: error.errors.map(err => err.message)
    });
  }
  
  // Erreur générique
  res.status(500).json({
    error: 'Erreur interne serveur',
    code: 'INTERNAL_SERVER_ERROR',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Une erreur est survenue'
  });
});

module.exports = router;