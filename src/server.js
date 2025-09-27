// src/server.js
require('dotenv').config();
const app = require('./app');
const sequelize = require('./core/database/database');
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
    console.log('🚀 DIASPORA TONTINE BACKEND - Démarrage...\n');

    // 🔍 Test connexion PostgreSQL
    await sequelize.authenticate();
    console.log('✅ Connexion PostgreSQL établie avec succès');

    // 🔍 Test connexion Redis (optionnel)
    try {
      const redisClient = require('./core/redis/redis');
      if (redisClient && typeof redisClient.ping === 'function') {
        await redisClient.ping();
        console.log('✅ Connexion Redis établie avec succès');
      } else {
        console.log('⚠️  Redis non configuré, fonctionnement sans cache');
      }
    } catch (redisError) {
      console.log('⚠️  Redis non disponible, fonctionnement sans cache');
    }

    // 🔄 Synchronisation des modèles (uniquement en dev)
    if (process.env.NODE_ENV === 'development') {
      console.log('\n🔄 SYNCHRONISATION MODÈLES (Mode développement)...');

      const models = require('./models');
      console.log(`📋 ${Object.keys(models).filter(k => typeof models[k] === 'function').length} modèles chargés\n`);

      // Vérifier intégrité
      const integrityIssues = models.checkModelsIntegrity();
      if (integrityIssues.length > 0) {
        console.error('❌ PROBLÈMES D\'INTÉGRITÉ DÉTECTÉS:');
        integrityIssues.forEach(issue => console.error(`   - ${issue}`));
        console.error('\n🛑 Arrêt du serveur pour correction...\n');
        process.exit(1);
      }

      // Synchronisation ordonnée
      console.log('🔄 Synchronisation en cours...');

      try {
        // 1. Tables indépendantes
        if (models.User) {
          await models.User.sync({ alter: true });
          console.log('   ✅ User synchronisé');
        }

        // 2. Tables principales modules
        if (models.Association) {
          await models.Association.sync({ alter: true });
          console.log('   ✅ Association synchronisé');
        }

        if (models.Tontine) {
          await models.Tontine.sync({ alter: true });
          console.log('   ✅ Tontine synchronisé');
        }

        // 3. Tables relations
        if (models.Section) {
          const sectionExists = await sequelize.getQueryInterface().showAllTables()
            .then(tables => tables.includes('sections'));
          if (sectionExists) {
            await models.Section.sync({ force: false });
            console.log('   ✅ Section synchronisé (sans alter - table existante)');
          } else {
            await models.Section.sync({ alter: true });
            console.log('   ✅ Section synchronisé (création initiale)');
          }
        }

        if (models.AssociationMember) {
          await models.AssociationMember.sync({ alter: true });
          console.log('   ✅ AssociationMember synchronisé');
        }

        if (models.TontineParticipant) {
          await models.TontineParticipant.sync({ alter: true });
          console.log('   ✅ TontineParticipant synchronisé');
        }

        // 4. Tables transactionnelles
        if (models.Transaction) {
          await models.Transaction.sync({ alter: true });
          console.log('   ✅ Transaction synchronisé');
        }

        // ➕ AJOUT : nouveaux modèles avant Document
        if (models.ExpenseRequest) {
          await models.ExpenseRequest.sync({ alter: true });
          console.log('   ✅ ExpenseRequest synchronisé');
        }

        if (models.IncomeEntry) {
          await models.IncomeEntry.sync({ alter: true });
          console.log('   ✅ IncomeEntry synchronisé');
        }

        if (models.LoanRepayment) {
          await models.LoanRepayment.sync({ alter: true });
          console.log('   ✅ LoanRepayment synchronisé');
        }

        if (models.Document) {
          await models.Document.sync({ alter: true });
          console.log('   ✅ Document synchronisé');
        }

        if (models.Rating) {
          await models.Rating.sync({ alter: true });
          console.log('   ✅ Rating synchronisé');
        }

        // 5. Tables support
        if (models.Event) {
          await models.Event.sync({ alter: true });
          console.log('   ✅ Event synchronisé');
        }

        console.log('\n✅ Synchronisation terminée avec succès !');

        const summary = models.getModelsSummary();
        console.log('\n📊 ARCHITECTURE SYNCHRONISÉE:');
        console.log(`   🏗️  Core: ${summary.coreModels}/3 modèles`);
        console.log(`   🏛️  Association: ${summary.associationModels}/5 modèles`);
        console.log(`   💰 Tontine: ${summary.tontineModels}/3 modèles`);
        console.log(`   📅 Support: ${summary.supportModels}/1 modèles`);
        console.log(`   📈 Total: ${summary.totalModels} modèles\n`);

      } catch (syncError) {
        console.error('❌ ERREUR SYNCHRONISATION:', syncError.message);
        console.error('📍 Stack:', syncError.stack);
        console.error('\n🛑 Impossible de synchroniser la base de données\n');
        process.exit(1);
      }
    } else {
      console.log('⚡ Mode production - Synchronisation désactivée');

      const models = require('./models');
      const integrityIssues = models.checkModelsIntegrity();
      if (integrityIssues.length > 0) {
        console.error('❌ PROBLÈMES D\'INTÉGRITÉ EN PRODUCTION:');
        integrityIssues.forEach(issue => console.error(`   - ${issue}`));
        process.exit(1);
      }
      console.log('✅ Modèles chargés et vérifiés\n');
    }

    // 🚀 Démarrage serveur HTTP
    const server = app.listen(PORT, () => {
      console.log('🎯 ================================');
      console.log('🚀 DIASPORA TONTINE API DÉMARRÉE');
      console.log('🎯 ================================');
      console.log(`📡 Port: ${PORT}`);
      console.log(`🌍 Environnement: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🕐 Heure: ${new Date().toLocaleString('fr-FR')}`);
      console.log('🎯 ================================');
      console.log('');
      console.log('🔗 Endpoints disponibles:');
      console.log(`   📊 Health check: http://localhost:${PORT}/health`);
      console.log(`   🔐 Auth: http://localhost:${PORT}/api/v1/auth/*`);
      console.log(`   🏛️  Associations: http://localhost:${PORT}/api/v1/associations/*`);
      console.log(`   💰 Tontines: http://localhost:${PORT}/api/v1/tontines/*`);
      console.log(`   📋 API Doc: http://localhost:${PORT}/api-docs (futur)`);
      console.log('');
      console.log('✅ Prêt à recevoir les requêtes !\n');
    });

    // Gestion graceful shutdown
    process.on('SIGTERM', () => {
      console.log('\n🛑 Signal SIGTERM reçu, arrêt graceful...');
      server.close(() => {
        console.log('✅ Serveur HTTP fermé');
        sequelize.close().then(() => {
          console.log('✅ Connexion DB fermée');
          process.exit(0);
        });
      });
    });

    process.on('SIGINT', () => {
      console.log('\n🛑 Signal SIGINT reçu (Ctrl+C), arrêt graceful...');
      server.close(() => {
        console.log('✅ Serveur HTTP fermé');
        sequelize.close().then(() => {
          console.log('✅ Connexion DB fermée');
          process.exit(0);
        });
      });
    });

    process.on('uncaughtException', (error) => {
      console.error('❌ ERREUR NON CATCHÉE:', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ PROMESSE REJETÉE NON GÉRÉE:', reason);
      console.error('🔍 Promise:', promise);
      process.exit(1);
    });

  } catch (error) {
    console.error('❌ ERREUR DÉMARRAGE SERVEUR:');
    console.error('📍 Message:', error.message);
    console.error('📍 Stack:', error.stack);

    if (error.name === 'SequelizeConnectionError') {
      console.error('\n💡 AIDE CONNEXION DB:');
      console.error('   - Vérifiez que PostgreSQL est démarré');
      console.error('   - Vérifiez les variables DB_* dans .env');
      console.error('   - Vérifiez les droits d\'accès à la base');
    }

    if (error.code === 'EADDRINUSE') {
      console.error(`\n💡 Le port ${PORT} est déjà utilisé`);
      console.error('   - Changez la variable PORT dans .env');
      console.error('   - Ou arrêtez le processus utilisant ce port');
    }

    console.error('\n🛑 Arrêt du serveur\n');
    process.exit(1);
  }
}

// Tests de santé externes (Stripe/Twilio)
async function runHealthChecks() {
  console.log('🔍 Tests de santé des services...');

  if (process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      await stripe.balance.retrieve();
      console.log('✅ Stripe: Connecté');
    } catch (stripeError) {
      console.warn('⚠️  Stripe: Erreur connexion -', stripeError.message);
    }
  } else {
    console.log('⚪ Stripe: Non configuré (dev)');
  }

  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    try {
      const twilio = require('twilio')(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );
      await twilio.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
      console.log('✅ Twilio: Connecté');
    } catch (twilioError) {
      console.warn('⚠️  Twilio: Erreur connexion -', twilioError.message);
    }
  } else {
    console.log('⚪ Twilio: Non configuré (dev)');
  }

  console.log('');
}

// Point d'entrée principal
(async () => {
  try {
    if (process.env.NODE_ENV !== 'test') {
      await runHealthChecks();
    }
    await startServer();
  } catch (error) {
    console.error('❌ ÉCHEC DÉMARRAGE:', error.message);
    process.exit(1);
  }
})();

module.exports = app;
