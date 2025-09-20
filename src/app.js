// app.js - VERSION CORRIGÉE

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const { authenticate } = require('./core/auth/middleware/auth'); // Assure-toi du bon chemin

// 🔥 CORS Manuel - DOIT ÊTRE EN PREMIER
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:3001');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS,PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,Cache-Control,Pragma,X-Requested-With,Accept,Origin,Accept-Language');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// 🛡️ Middleware de sécurité - CONFIGURER HELMET CORRECTEMENT
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      frameSrc: ["'self'", "http://localhost:3001"], // ✅ AUTORISER IFRAME DEPUIS FRONTEND
      frameAncestors: ["'self'", "http://localhost:3001"], // ✅ AUTORISER AFFICHAGE EN IFRAME
      objectSrc: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false, // ✅ DÉSACTIVER POUR IFRAME
}));

app.use(compression());

// 🌍 CORS Configuration - BACKUP
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || [
    'http://localhost:3000', 
    'http://192.168.1.217:19006',
    'http://192.168.1.217:8081',
    'http://localhost:3001', 
    'http://127.0.0.1:3001'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization', 
    'Accept-Language',
    'Cache-Control',
    'Pragma',
    'X-Requested-With',
    'Accept',
    'Origin'
  ],
  credentials: true
};
app.use(cors(corsOptions));

// 📝 Parsing des données
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 🚦 Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 min
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: {
    error: 'Trop de requêtes, veuillez réessayer plus tard'
  }
});
app.use('/api/', limiter);

// 📊 Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// ❤️ Route de santé
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'API Diaspora/Tontine opérationnelle',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    version: '1.0.0'
  });
});

// ✅ ROUTE DOCUMENTS CORRIGÉE - DOIT ÊTRE AVANT express.static
app.get('/uploads/documents/:filename', authenticate, async (req, res) => {
  try {
    const { filename } = req.params;
    const userId = req.user.id; // Depuis le middleware auth
    
    // 🔍 VÉRIFIER QUE L'UTILISATEUR A LE DROIT D'ACCÉDER À CE DOCUMENT
    const { Document, AssociationMember } = require('./models');
    
    const document = await Document.findOne({
      where: {
        fileUrl: `uploads/documents/${filename}`
      },
      include: [{
        model: require('./models').Association,
        as: 'association'
      }]
    });
    
    if (!document) {
      console.log('❌ Document non trouvé en base:', filename);
      return res.status(404).json({ error: 'Document introuvable' });
    }
    
    // ✅ VÉRIFIER QUE L'UTILISATEUR EST MEMBRE DE L'ASSOCIATION
    const isMember = await AssociationMember.findOne({
      where: {
        userId: userId,
        associationId: document.associationId,
        status: 'active'
      }
    });
    
    if (!isMember) {
      console.log('❌ Accès refusé - utilisateur pas membre:', userId, 'association:', document.associationId);
      return res.status(403).json({ 
        error: 'Accès non autorisé',
        code: 'NOT_ASSOCIATION_MEMBER'
      });
    }
    
    console.log('✅ Accès autorisé pour utilisateur:', userId, 'document:', filename);
    
    // 🔍 VÉRIFIER QUE LE FICHIER EXISTE PHYSIQUEMENT
    const filePath = path.join(__dirname, '..', 'uploads', 'documents', filename);
    
    if (!fs.existsSync(filePath)) {
      console.error('❌ Fichier physique introuvable:', filePath);
      return res.status(404).json({ error: 'Fichier physique introuvable' });
    }
    
    // ✅ SERVIR LE FICHIER AVEC LES BONS HEADERS
    res.setHeader('Content-Type', document.mimeType || 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3001');
    
    // 📊 LOGGER L'ACCÈS POUR AUDIT
    console.log(`📄 Document accédé: ${document.fileName} par utilisateur ${userId} (${req.user.firstName} ${req.user.lastName})`);
    
    res.sendFile(filePath);
    
  } catch (error) {
    console.error('❌ Erreur serving document sécurisé:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// 🛣️ Routes API
const apiV1 = '/api/v1';

// Routes principales
app.use(`${apiV1}/auth`, require('./core/auth/routes/auth'));
app.use(`${apiV1}/associations`, require('./modules/associations/routes'));
app.use(`${apiV1}/users`, require('./core/users/routes/userRoutes'));

// ✅ STATIC FILES pour autres uploads (images générales, etc.)
app.use('/uploads', express.static('uploads', {
  setHeaders: (res, path, stat) => {
    // Pour tous les autres fichiers statiques, aussi inline par défaut
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3001');
  }
}));

// 🧪 Route de test pour vérifier les models
app.get(`${apiV1}/test/models`, async (req, res) => {
  try {
    const models = require('./models');
    const modelNames = Object.keys(models).filter(key => 
      key !== 'sequelize' && key !== 'Sequelize'
    );
    
    res.json({
      success: true,
      message: 'Models chargés avec succès',
      models: modelNames,
      count: modelNames.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Erreur lors du chargement des models',
      error: error.message
    });
  }
});

// ⚠️ Middleware de gestion d'erreurs global
app.use((err, req, res, next) => {
  console.error('Erreur:', err);
  
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Erreur interne du serveur',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 Route non trouvée
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} non trouvée`
  });
});

module.exports = app;