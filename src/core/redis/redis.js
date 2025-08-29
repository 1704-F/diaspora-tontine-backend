const redis = require('redis');
require('dotenv').config();

// Redis optionnel en développement
const REDIS_ENABLED = process.env.REDIS_ENABLED !== 'false';

let redisClient = null;

if (REDIS_ENABLED) {
  // Configuration Redis
  const redisConfig = {
    socket: {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379
    }
  };

  // Ajouter password si fourni
  if (process.env.REDIS_PASSWORD) {
    redisConfig.password = process.env.REDIS_PASSWORD;
  }

  // Créer le client Redis
  redisClient = redis.createClient(redisConfig);

  // Gestion des erreurs
  redisClient.on('error', (err) => {
    console.error('❌ Erreur Redis:', err.message);
    console.warn('⚠️  Basculement en mode sans cache');
  });

  redisClient.on('connect', () => {
    console.log('🔄 Connexion à Redis en cours...');
  });

  redisClient.on('ready', () => {
    console.log('✅ Redis connecté et prêt');
  });

  redisClient.on('end', () => {
    console.log('🔴 Connexion Redis fermée');
  });

  // Connexion avec gestion d'erreur gracieuse
  redisClient.connect().catch((err) => {
    console.warn('⚠️  Redis non disponible:', err.message);
    console.log('💡 L\'application fonctionnera sans cache Redis');
    redisClient = null;
  });
} else {
  console.log('⚠️  Redis désactivé via configuration');
}

// Helper pour vérifier si Redis est disponible
const isRedisAvailable = () => {
  return redisClient && redisClient.isReady;
};

// Wrapper sécurisé pour les opérations Redis
const safeRedisOperation = async (operation) => {
  if (!isRedisAvailable()) {
    return null;
  }
  
  try {
    return await operation(redisClient);
  } catch (error) {
    console.warn('⚠️  Opération Redis échouée:', error.message);
    return null;
  }
};

module.exports = {
  client: redisClient,
  isAvailable: isRedisAvailable,
  safeOperation: safeRedisOperation
};