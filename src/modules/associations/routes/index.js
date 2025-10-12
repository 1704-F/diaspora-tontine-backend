// src/modules/associations/routes/index.js
// 🏛️ ROUTES CENTRALISÉES MODULE ASSOCIATION - DiasporaTontine

const express = require('express');
const router = express.Router();

// Import des routes spécialisées
const associationRoutes = require('./associationRoutes');
const expenseRequestRoutes = require('./expenseRequests');
const incomeEntriesRoutes = require('./incomeEntries');
const rolesRoutes = require('./rolesRoutes');

// 📋 ASSOCIATION CRUD
router.use('/', associationRoutes);

// 💰 GESTION FINANCIÈRE - ExpenseRequests & LoanRepayments
router.use('/', expenseRequestRoutes);

// 💵 Routes pour gestion des entrées d'argent personnalisées
router.use('/', incomeEntriesRoutes);

// 🔐 ROUTES RBAC - RÔLES ET PERMISSIONS
router.use('/', rolesRoutes); // ✅ AJOUTÉ

// ❤️ Route de santé du module
router.get('/health', (req, res) => {
  res.json({
    module: 'associations',
    status: 'operational',
    version: '1.2.0', // ✅ Version bump
    features: {
      crud: true,
      sections: false, // à implémenter
      members: true,
      cotisations: true,
      expenseRequests: true,
      loanRepayments: true,
      financialReports: true,
      balanceCalculation: true,
      paymentValidation: true,
      rbac: true, // ✅ NOUVEAU - Rôles et permissions
      reports: false // à implémenter
    },
    endpoints: {
      // Association CRUD
      associations: [
        'GET /associations',
        'POST /associations', 
        'GET /associations/:id',
        'PUT /associations/:id',
        'DELETE /associations/:id'
      ],
      // Gestion financière
      expenseRequests: [
        'POST /:associationId/expense-requests',
        'GET /:associationId/expense-requests',
        'GET /:associationId/expense-requests/:requestId',
        'PUT /:associationId/expense-requests/:requestId',
        'DELETE /:associationId/expense-requests/:requestId'
      ],
      validation: [
        'POST /:associationId/expense-requests/:requestId/validate',
        'GET /:associationId/expense-requests/pending-validations',
        'GET /:associationId/expense-requests/:requestId/validation-history'
      ],
      payments: [
        'POST /:associationId/expense-requests/:requestId/pay',
        'PUT /:associationId/expense-requests/:requestId/payment-status'
      ],
      loans: [
        'GET /:associationId/expense-requests/:requestId/loan-status',
        'POST /:associationId/expense-requests/:requestId/repayments',
        'GET /:associationId/expense-requests/:requestId/repayments'
      ],
      analytics: [
        'GET /:associationId/expense-requests/statistics',
        'GET /:associationId/expense-requests/balance',
        'GET /:associationId/expense-requests/export'
      ],
      // ✅ NOUVEAU - Endpoints RBAC
      roles: [
        'GET /:associationId/roles',
        'POST /:associationId/roles',
        'GET /:associationId/roles/:roleId',
        'PUT /:associationId/roles/:roleId',
        'DELETE /:associationId/roles/:roleId'
      ],
      memberRoles: [
        'POST /:associationId/members/:memberId/roles',
        'DELETE /:associationId/members/:memberId/roles/:roleId',
        'GET /:associationId/members/:memberId/roles'
      ],
      permissions: [
        'POST /:associationId/members/:memberId/permissions/grant',
        'POST /:associationId/members/:memberId/permissions/revoke',
        'GET /:associationId/permissions'
      ],
      admin: [
        'POST /:associationId/transfer-admin'
      ]
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = router;