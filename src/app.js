const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const app = express();

// 🛡️ Middleware de sécurité (Ladoum style)
app.use(helmet());
app.use(compression());

// 🌍 CORS Configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || [
    'http://localhost:3000', 
    'http://192.168.1.217:19006',
    'http://192.168.1.217:8081'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept-Language'],
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

// 🛣️ Routes API
const apiV1 = '/api/v1';

// Routes principales
app.use(`${apiV1}/auth`, require('./core/auth/routes/auth'));
//app.use(`${apiV1}/associations`, require('./routes/associations'));
// app.use(`${apiV1}/users`, require('./routes/users')); 
// app.use(`${apiV1}/tontines`, require('./routes/tontines'));
// app.use(`${apiV1}/payments`, require('./routes/payments'));1}/payments`, require('./routes/payments'));

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