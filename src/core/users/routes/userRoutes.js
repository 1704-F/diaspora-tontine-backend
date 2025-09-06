const express = require('express');
const { authenticate } = require('../../auth/middleware/auth');
const userController = require('../controllers/userController');

const router = express.Router();

// GET /api/v1/users/me - Profil utilisateur complet
router.get('/me', authenticate, userController.getProfile);

module.exports = router;