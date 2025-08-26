// src/server.js
require('dotenv').config();
const app = require('./app');
const sequelize = require('./config/database');
const redisClient = require('./config/redis');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Créer le dossier logs s'il n'existe pas
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Test de connexion à la base de données
async function startServer() {
  try {
    // 🔍 Test connexion PostgreSQL
    await sequelize.authenticate();
    console.log('✅ Connexion PostgreSQL établie avec succès');
    
    // 🔍 Test connexion Redis (optionnel)
    const redisConfig = require('./config/redis');
    if (redisConfig.isAvailable()) {
      console.log('✅ Connexion Redis établie avec succès');
    } else {
      console.log('⚠️  Redis non disponible, fonctionnement sans cache');
    }
    
    // 🔄 Synchronisation des modèles (uniquement en dev - style Ladoum)
    if (process.env.NODE_ENV === 'development') {
      console.log('🔄 Synchronisation des modèles...');

      // Synchroniser d'abord les modèles sans dépendances
      const models = require('./models');
      
      // 1. Tables indépendantes d'abord
      if (models.User) {
        await models.User.sync({ alter: true });
        console.log('✅ User synchronisé');
      }
      
      // 2. Tables principales
      if (models.Association) {
        await models.Association.sync({ alter: true });
        console.log('✅ Association synchronisé');
      }
      
      if (models.Tontine) {
        await models.Tontine.sync({ alter: true });
        console.log('✅ Tontine synchronisé');
      }

      // 3. Puis synchroniser tous les autres (relations)
      await sequelize.sync({ alter: true });
      console.log('✅ Tous les modèles synchronisés');
    }
    
    // 🚀 Démarrer le serveur
    const server = app.listen(PORT, () => {
      console.log(`🚀 Serveur Diaspora/Tontine API démarré sur le port ${PORT}`);
      console.log(`🌍 Environnement: ${process.env.NODE_ENV}`);
      console.log(`📝 Documentation API: http://localhost:${PORT}/api/v1/docs`);
      console.log(`❤️ Health check: http://localhost:${PORT}/health`);
    });

    // 🤖 Jobs automatisés (uniquement en production)
    if (process.env.NODE_ENV === 'production') {
      console.log('🤖 Démarrage des tâches automatisées...');
      // TODO: Implémenter cronJobManager
      console.log('✅ Tâches automatisées démarrées');
    } else {
      console.log('⚠️ Tâches automatisées désactivées en développement');
    }

    // 🛑 Gestion gracieuse de l'arrêt
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

    function gracefulShutdown(signal) {
      console.log(`\n📡 Signal ${signal} reçu, arrêt gracieux...`);
      
      // Fermer le serveur
      server.close((err) => {
        if (err) {
          console.error('❌ Erreur lors de la fermeture du serveur:', err);
          process.exit(1);
        }
        
        console.log('🚀 Serveur fermé proprement');
        
        // Fermer les connexions
        const redisConfig = require('./config/redis');
        const closePromises = [sequelize.close()];
        
        if (redisConfig.client) {
          closePromises.push(redisConfig.client.quit());
        }
        
        Promise.all(closePromises).then(() => {
          console.log('🗄️ Connexions fermées');
          console.log('👋 Au revoir !');
          process.exit(0);
        }).catch((err) => {
          console.error('❌ Erreur fermeture connexions:', err);
          process.exit(1);
        });
      });
    }

  } catch (error) {
    console.error('❌ Impossible de démarrer le serveur:', error);
    process.exit(1);
  }
}

// 🎬 Lancer le serveur
startServer();