// src/modules/associations/routes/index.js
// 🏛️ ROUTES CENTRALISÉES MODULE ASSOCIATION - DiasporaTontine

const express = require('express');
const router = express.Router();

// Import des routes spécialisées
const associationRoutes = require('./associationRoutes');
const expenseRequestRoutes = require('./expenseRequests');
const incomeEntriesRoutes = require('./incomeEntries');


// 📋 ASSOCIATION CRUD
router.use('/', associationRoutes);

// 💰 GESTION FINANCIÈRE - ExpenseRequests & LoanRepayments
router.use('/', expenseRequestRoutes);

//Routes pour gestion des entrées d'argent personnalisées
router.use('/', incomeEntriesRoutes);


// ❤️ Route de santé du module
router.get('/health', (req, res) => {
  res.json({
    module: 'associations',
    status: 'operational',
    version: '1.1.0', // ➕ Version bump
    features: {
      crud: true,
      sections: false, // à implémenter
      members: true,
      cotisations: true,
      expenseRequests: true,    // ➕ NOUVEAU - Demandes dépenses
      loanRepayments: true,     // ➕ NOUVEAU - Suivi prêts
      financialReports: true,   // ➕ NOUVEAU - Rapports financiers
      balanceCalculation: true, // ➕ NOUVEAU - Calcul solde
      paymentValidation: true,  // ➕ NOUVEAU - Validation paiements
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
      ]
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = router;