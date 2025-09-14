//src/modules/association/routes/associationRoutes.js
const express = require('express');
const multer = require('multer');
const { authenticate, requireAssociationPermission } = require('../../../core/auth/middleware/auth');
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
  dest: 'uploads/documents/', // Dossier temporaire
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (req, file, cb) => {
    // Types de fichiers autorisés
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
  validateListAssociations, // Pas d'auth requise pour recherche publique
  associationController.searchPublicAssociations
);

// Détails association spécifique
router.get('/:id',
  authenticate,
  validateId,
  associationController.getAssociation
);

// Modifier association
router.put('/:id',
  authenticate,
  validateId,
  validateUpdateAssociation,
  requireAssociationPermission('id', 'president'), // Président uniquement
  associationController.updateAssociation
);

// Supprimer association (soft delete)
router.delete('/:id',
  authenticate,
  validateId,
  requireAssociationPermission('id', 'president'), // Président uniquement
  associationController.deleteAssociation
);

// Mettre à jour configuration (types membres, bureau, permissions)
router.put('/:id/configuration',
  authenticate,
  validateId,
  requireAssociationPermission('id', 'president'), // Configuration = président uniquement
  associationController.updateConfiguration
);

// Statistiques association
router.get('/:id/stats',
  authenticate,
  validateId,
  requireAssociationPermission('id', 'member'), // Tous les membres
  associationController.getAssociationStats
);

// 🏗️ ROUTES SECTIONS

// Créer section
router.post('/:associationId/sections',
  authenticate,
  validateAssociationId,
  requireAssociationPermission('associationId', 'central_board'),
  sectionController.createSection
);

// Lister sections
router.get('/:associationId/sections',
  authenticate,
  validateAssociationId,
  requireAssociationPermission('associationId', 'member'),
  sectionController.listSections
);

// Détails d'une section
router.get('/:associationId/sections/:sectionId',
  authenticate,
  validateAssociationId,
  requireAssociationPermission('associationId', 'member'),
  sectionController.getSectionDetails
);



// Modifier section
router.put('/:associationId/sections/:sectionId',
  authenticate,
  validateAssociationId,
  requireAssociationPermission('associationId', 'responsable_section'),
  sectionController.updateSection
);

// Mettre à jour bureau section
router.put('/:associationId/sections/:sectionId/bureau',
  authenticate,
  validateAssociationId,
  requireAssociationPermission('associationId', ['admin_association', 'central_board']), // ← CORRECTION
  sectionController.updateBureauSection
);

// Statistiques section
router.get('/:associationId/sections/:sectionId/stats',
  authenticate,
  validateAssociationId,
  requireAssociationPermission('associationId', 'member'),
  sectionController.getSectionStats
);

// Supprimer section
router.delete('/:associationId/sections/:sectionId',
  authenticate,
  validateAssociationId,
  requireAssociationPermission('associationId', 'president'),
  sectionController.deleteSection
);


// Rapport comparatif sections
router.get('/:associationId/sections-comparison',
  authenticate,
  validateAssociationId,
  requireAssociationPermission('associationId', 'central_board'),
  sectionController.getSectionsComparison
);

// Transférer membre entre sections
router.post('/:associationId/sections/:sectionId/transfer-member',
  authenticate,
  validateAssociationId,
  requireAssociationPermission('associationId', 'central_board'),
  sectionController.transferMember
);

// 👥 ROUTES MEMBRES

// Ajouter membre
router.post('/:associationId/members',
  authenticate,
  validateAssociationId,
  requireAssociationPermission('associationId', 'admin_association'),
  memberController.addMember
);

// Lister membres
router.get('/:associationId/members',
  authenticate,
  validateAssociationId,
  requireAssociationPermission('associationId', 'member'),
  memberController.listMembers
);

// 2️⃣ MEMBRES D'UNE SECTION
router.get('/:associationId/sections/:sectionId/members',
  authenticate,
  validateAssociationId,
  requireAssociationPermission('associationId', 'member'),
  memberController.getSectionMembers
);


// Dashboard membre personnel
router.get('/:associationId/my-dashboard',
  authenticate,
  validateAssociationId,
  requireAssociationPermission('associationId', 'member'),
  memberController.getMemberDashboard
);

// Obtenir détails d'un membre
router.get('/:associationId/members/:memberId',
  authenticate,
  validateAssociationId,
  requireAssociationPermission('associationId', 'member'),
  memberController.getMember
);

// Modifier membre
router.put('/:associationId/members/:memberId',
  authenticate,
  validateAssociationId,
  requireAssociationPermission('associationId', 'admin_association'),
  memberController.updateMember
);

// Modifier statut membre
router.put('/:associationId/members/:memberId/status',
  authenticate,
  validateAssociationId,
  requireAssociationPermission('associationId', 'central_board'),
  memberController.updateMemberStatus
);

// Historique cotisations membre
router.get('/:associationId/members/:memberId/cotisations',
  authenticate,
  validateAssociationId,
  requireAssociationPermission('associationId', 'member'),
  memberController.getMemberCotisations
);

// Configurer prélèvement automatique
router.put('/:associationId/members/:memberId/auto-payment',
  authenticate,
  validateAssociationId,
  memberController.setupAutoPayment // Vérification permissions interne
);

// 💰 ROUTES COTISATIONS

// Payer cotisation (CB prioritaire)
router.post('/cotisations',
  authenticate,
  memberController.payCotisation
);

// Rapport cotisations association
router.get('/:associationId/cotisations-report',
  authenticate,
  validateAssociationId,
  requireAssociationPermission('associationId', 'tresorier'),
  memberController.getCotisationsReport
);

// Import historique cotisations
router.post('/:associationId/import-cotisations',
  authenticate,
  validateAssociationId,
  requireAssociationPermission('associationId', 'central_board'),
  memberController.importCotisationsHistory
);

// Cotisations en retard
router.get('/:associationId/overdue-cotisations',
  authenticate,
  validateAssociationId,
  requireAssociationPermission('associationId', 'tresorier'),
  memberController.getOverdueCotisations
);

// Upload document KYB
router.post('/:id/documents',
  authenticate,
  upload.single('document'), // Middleware multer
  requireAssociationPermission('id', 'admin'),
  associationController.uploadDocument
);

// Lister documents association
router.get('/:id/documents',
  authenticate,
  requireAssociationPermission('id', 'member'),
  associationController.getDocuments
);

// Télécharger document spécifique
router.get('/:id/documents/:documentId',
  authenticate,
  requireAssociationPermission('id', 'member'),
  associationController.downloadDocument
);

// Supprimer document spécifique
router.delete('/:id/documents/:documentId',
  authenticate,
  requireAssociationPermission('id', 'admin'),
  associationController.deleteDocument
);

// Route spécifique pour setup association (sans validation stricte bureauCentral)
router.put('/:id/setup',
  authenticate,
  validateId,
  requireAssociationPermission('id', 'admin'),
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