//src/modules/associations/routes/associationRoutes.js
const express = require("express");
const multer = require("multer");

// ✅ IMPORTS MODIFIÉS - Nouveau système RBAC
const { authenticate } = require("../../../core/auth/middleware/auth"); // ← GARDER authenticate
const {
  checkAssociationMember,
  checkPermission,
} = require("../../../core/middleware/checkPermission"); // ← NOUVEAU

const {
  validateCreateAssociation,
  validateUpdateAssociation,
  validateListAssociations,
  validateId,
  validateAssociationId,
} = require("../../../core/middleware/validation");

const {
  associationController,
  sectionController,
  memberController,
} = require("../controllers");

// Configuration multer pour upload de fichiers
const upload = multer({
  dest: "uploads/documents/",
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/jpg",
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Type de fichier non autorisé"), false);
    }
  },
});

const router = express.Router();

// 🏛️ ROUTES ASSOCIATIONS PRINCIPALES

// Créer association (avec KYB)
router.post(
  "/",
  authenticate,
  validateCreateAssociation,
  associationController.createAssociation
);

// Lister associations de l'utilisateur
router.get(
  "/",
  authenticate,
  validateListAssociations,
  associationController.listUserAssociations
);

// Rechercher associations publiques
router.get(
  "/search",
  validateListAssociations, // Pas d'auth requise
  associationController.searchPublicAssociations
);

// Détails association spécifique
router.get(
  "/:id",
  authenticate,
  validateId,
  associationController.getAssociation
);

// Modifier association
// ✅ CORRIGÉ: administration.modify_settings
router.put(
  "/:id",
  authenticate,
  validateId,
  validateUpdateAssociation,
  checkAssociationMember,
  checkPermission("administration.modify_settings"),
  associationController.updateAssociation
);

// Supprimer association (soft delete)
// ✅ CORRIGÉ: administration.modify_settings
router.delete(
  "/:id",
  authenticate,
  validateId,
  checkAssociationMember,
  checkPermission("administration.modify_settings"),
  associationController.deleteAssociation
);

// Mettre à jour configuration (types membres, bureau, permissions)
// ✅ CORRIGÉ: administration.manage_roles
router.put(
  "/:id/configuration",
  authenticate,
  validateId,
  checkAssociationMember,
  checkPermission("administration.manage_roles"),
  associationController.updateConfiguration
);

// Statistiques association
// ✅ Tous les membres peuvent voir
router.get(
  "/:id/stats",
  authenticate,
  validateId,
  checkAssociationMember,
  associationController.getAssociationStats
);

// 🗂️ ROUTES SECTIONS

// Créer section
// ✅ CORRIGÉ: administration.manage_sections
router.post(
  "/:associationId/sections",
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission("administration.manage_sections"),
  sectionController.createSection
);

// Lister sections
// ✅ Tous les membres peuvent voir
router.get(
  "/:associationId/sections",
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  sectionController.listSections
);

// Détails d'une section
// ✅ Tous les membres peuvent voir
router.get(
  "/:associationId/sections/:sectionId",
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  sectionController.getSectionDetails
);

// Modifier section
// ✅ CORRIGÉ: administration.manage_sections
router.put(
  "/:associationId/sections/:sectionId",
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission("administration.manage_sections"),
  sectionController.updateSection
);

// Statistiques section
// ✅ Tous les membres peuvent voir
router.get(
  "/:associationId/sections/:sectionId/stats",
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  sectionController.getSectionStats
);

// Supprimer section
// ✅ CORRIGÉ: administration.manage_sections
router.delete(
  "/:associationId/sections/:sectionId",
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission("administration.manage_sections"),
  sectionController.deleteSection
);

// Rapport comparatif sections
// ✅ Tous les membres peuvent voir
router.get(
  "/:associationId/sections-comparison",
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  sectionController.getSectionsComparison
);

// Transférer membre entre sections
// ✅ CORRIGÉ: membres.manage_members
router.post(
  "/:associationId/sections/:sectionId/transfer-member",
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission("membres.manage_members"),
  sectionController.transferMember
);

// 👥 ROUTES MEMBRES

// Ajouter membre
// ✅ CORRIGÉ: membres.manage_members
router.post(
  "/:associationId/members",
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission("membres.manage_members"),
  memberController.addMember
);

// Lister membres
// ✅ CORRIGÉ: membres.view_list
router.get(
  "/:associationId/members",
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission("membres.view_list"),
  memberController.listMembers
);

// Exporter membres en PDF

router.get(
  "/:associationId/members/export-pdf",
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission("membres.export_data"),
  memberController.exportMembersPDF
);

// Membres d'une section
// ✅ CORRIGÉ: membres.view_list
router.get(
  "/:associationId/sections/:sectionId/members",
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission("membres.view_list"),
  memberController.getSectionMembers
);

// Dashboard membre personnel
// ✅ Chaque membre peut voir son propre dashboard
router.get(
  "/:associationId/my-dashboard",
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  memberController.getMemberDashboard
);

// Obtenir détails d'un membre
// ✅ CORRIGÉ: membres.view_details
router.get(
  "/:associationId/members/:memberId",
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission("membres.view_details"),
  memberController.getMember
);

// Modifier membre
// ✅ CORRIGÉ: membres.manage_members
router.put(
  "/:associationId/members/:memberId",
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission("membres.manage_members"),
  memberController.updateMember
);

// Modifier statut membre
// ✅ CORRIGÉ: membres.manage_members
router.put(
  "/:associationId/members/:memberId/status",
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission("membres.manage_members"),
  memberController.updateMemberStatus
);

// Historique cotisations membre
// ✅ CORRIGÉ: membres.view_details (peut voir ses cotisations ou autres si permissions)
router.get(
  "/:associationId/members/:memberId/cotisations",
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission("membres.view_details"),
  memberController.getMemberCotisations
);

// Configurer prélèvement automatique
router.put(
  "/:associationId/members/:memberId/auto-payment",
  authenticate,
  validateAssociationId,
  memberController.setupAutoPayment // Vérification interne
);

// 💰 ROUTES COTISATIONS

// Payer cotisation (CB prioritaire)
router.post("/cotisations", authenticate, memberController.payCotisation);

// Rapport cotisations association
// ✅ CORRIGÉ: finances.view_treasury
router.get(
  "/:associationId/cotisations-report",
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission("finances.view_treasury"),
  memberController.getCotisationsReport
);

// Import historique cotisations
// ✅ CORRIGÉ: finances.manage_budgets
router.post(
  "/:associationId/import-cotisations",
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission("finances.manage_budgets"),
  memberController.importCotisationsHistory
);

// Cotisations en retard
// ✅ CORRIGÉ: finances.view_treasury
router.get(
  "/:associationId/overdue-cotisations",
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission("finances.view_treasury"),
  memberController.getOverdueCotisations
);

// Dashboard cotisations
// ✅ CORRIGÉ: finances.view_treasury
router.get(
  "/:associationId/cotisations-dashboard",
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission("finances.view_treasury"),
  memberController.getCotisationsDashboard
);

// Ajouter cotisation manuelle
// ✅ CORRIGÉ: finances.manage_budgets
router.post(
  "/:associationId/cotisations-manual",
  authenticate,
  validateAssociationId,
  checkAssociationMember,
  checkPermission("finances.manage_budgets"),
  memberController.addManualCotisation
);

// 📄 ROUTES DOCUMENTS

// Upload document KYB
// ✅ CORRIGÉ: documents.upload
router.post(
  "/:id/documents",
  authenticate,
  upload.single("document"),
  checkAssociationMember,
  checkPermission("documents.upload"),
  associationController.uploadDocument
);

// Lister documents association
// ✅ Tous les membres peuvent voir les documents
router.get(
  "/:id/documents",
  authenticate,
  checkAssociationMember,
  associationController.getDocuments
);

// Télécharger document spécifique
// ✅ Tous les membres peuvent voir les documents
router.get(
  "/:id/documents/:documentId",
  authenticate,
  checkAssociationMember,
  associationController.downloadDocument
);

// Supprimer document spécifique
// ✅ CORRIGÉ: documents.manage
router.delete(
  "/:id/documents/:documentId",
  authenticate,
  checkAssociationMember,
  checkPermission("documents.manage"),
  associationController.deleteDocument
);

// 🚨 GESTION D'ERREURS
router.use((error, req, res, next) => {
  console.error("Erreur routes associations:", error);

  // Erreurs Sequelize
  if (error.name === "SequelizeValidationError") {
    return res.status(400).json({
      error: "Données invalides",
      code: "VALIDATION_ERROR",
      details: error.errors.map((err) => ({
        field: err.path,
        message: err.message,
        value: err.value,
      })),
    });
  }

  // Erreurs contraintes FK
  if (error.name === "SequelizeForeignKeyConstraintError") {
    return res.status(400).json({
      error: "Référence invalide",
      code: "FOREIGN_KEY_ERROR",
      details: error.message,
    });
  }

  // Erreurs unicité
  if (error.name === "SequelizeUniqueConstraintError") {
    return res.status(409).json({
      error: "Conflit de données",
      code: "UNIQUE_CONSTRAINT_ERROR",
      details: error.errors.map((err) => err.message),
    });
  }

  // Erreur générique
  res.status(500).json({
    error: "Erreur interne serveur",
    code: "INTERNAL_SERVER_ERROR",
    message:
      process.env.NODE_ENV === "development"
        ? error.message
        : "Une erreur est survenue",
  });
});

module.exports = router;