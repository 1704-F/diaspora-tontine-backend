// src/modules/associations/routes/index.js
// 🏛️ ROUTES CENTRALISÉES MODULE ASSOCIATION - DiasporaTontine

const express = require('express');
const router = express.Router();

// Import des routes spécialisées
const associationRoutes = require('./associationRoutes');
// Future routes à ajouter :
// const sectionRoutes = require('./sectionRoutes');
// const memberRoutes = require('./memberRoutes'); 
// const cotisationRoutes = require('./cotisationRoutes');

// 📋 ASSOCIATION CRUD
router.use('/', associationRoutes);

// 🌍 SECTIONS GÉOGRAPHIQUES (à implémenter)
// router.use('/:associationId/sections', sectionRoutes);

// 👥 GESTION MEMBRES (à implémenter) 
// router.use('/:associationId/members', memberRoutes);

// 💰 COTISATIONS & AIDES (à implémenter)
// router.use('/cotisations', cotisationRoutes);

// 📊 ROUTES DE REPORTING (futures)
// router.use('/:associationId/reports', reportRoutes);

// ❤️ Route de santé du module
router.get('/health', (req, res) => {
  res.json({
    module: 'associations',
    status: 'operational',
    version: '1.0.0',
    features: {
      crud: true,
      sections: false, // à implémenter
      members: true,
      cotisations: true,
      reports: false // à implémenter
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = router;