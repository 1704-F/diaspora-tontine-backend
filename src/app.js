const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const app = express();

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

// 🛡️ Middleware de sécurité (Ladoum style)
app.use(helmet());
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

// 📚 DOCUMENTATION SWAGGER (à implémenter)
// const { specs, swaggerUi, setup } = require('./config/swagger');
// app.use('/api/v1/docs', swaggerUi.serve, setup);

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

app.get('/uploads/documents/:filename', (req, res, next) => {
  const { filename } = req.params;
  const filePath = `uploads/documents/${filename}`;
  
  // Vérifier si le fichier existe
  if (!require('fs').existsSync(filePath)) {
    return res.status(404).send('Fichier introuvable');
  }
  
  // Headers pour PDF
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline');
  res.sendFile(require('path').resolve(filePath));
});

// 🛣️ Routes API
const apiV1 = '/api/v1';

// Routes principales
app.use(`${apiV1}/auth`, require('./core/auth/routes/auth'));
app.use(`${apiV1}/associations`, require('./modules/associations/routes'));
app.use(`${apiV1}/users`, require('./core/users/routes/userRoutes'));
app.use('/uploads', express.static('uploads'));


// app.use(`${apiV1}/users`, require('./routes/users')); 
// app.use(`${apiV1}/tontines`, require('./routes/tontines'));
// app.use(`${apiV1}/payments`, require('./routes/payments'));

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