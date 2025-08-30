'use strict';

const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const sequelize = require('../core/database/database');

const basename = path.basename(__filename);
const db = {};

// Définir tous les dossiers contenant des modèles
const modelDirectories = [
  __dirname, // src/models/ (User, Transaction, Document)
  path.join(__dirname, '../modules/associations/models'), // Association, Section, AssociationMember
  path.join(__dirname, '../modules/tontines/models')      // Tontine, TontineParticipant, Rating
];

console.log('🚀 DIASPORA TONTINE - Chargement des modèles...\n');

// 1. CHARGER TOUS LES MODÈLES D'ABORD
modelDirectories.forEach(directory => {
  if (fs.existsSync(directory)) {
    console.log(`📁 Scan du dossier: ${path.relative(process.cwd(), directory)}`);
    
    fs.readdirSync(directory)
      .filter(file => {
        return (file.indexOf('.') !== 0) && 
               (file !== basename) && 
               (file.slice(-3) === '.js') &&
               (file.indexOf('.test.js') === -1);
      })
      .forEach(file => {
        console.log(`   🔄 Chargement: ${file}`);
        try {
          const modelDefiner = require(path.join(directory, file));
          
          if (typeof modelDefiner !== 'function') {
            console.error(`   ❌ Erreur: ${file} n'exporte pas une fonction`);
            return;
          }
          
          const model = modelDefiner(sequelize, Sequelize.DataTypes);
          db[model.name] = model;
          console.log(`   ✅ ${model.name} chargé avec succès`);
        } catch (error) {
          console.error(`   ❌ Erreur lors du chargement de ${file}:`, error.message);
          console.error(`   📍 Stack trace:`, error.stack);
        }
      });
    console.log(''); // Ligne vide pour lisibilité
  } else {
    console.log(`⚠️  Dossier introuvable: ${path.relative(process.cwd(), directory)}\n`);
  }
});

// 2. AFFICHER RÉSUMÉ MODÈLES CHARGÉS
console.log('📋 RÉSUMÉ MODÈLES CHARGÉS:');
console.log(`   Total: ${Object.keys(db).length} modèles`);
Object.keys(db).forEach(modelName => {
  console.log(`   - ${modelName}`);
});
console.log('');

// 3. CONFIGURER LES ASSOCIATIONS APRÈS AVOIR CHARGÉ TOUS LES MODÈLES
console.log('🔗 Configuration des associations...');
Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    console.log(`   🔗 ${modelName}`);
    try {
      db[modelName].associate(db);
    } catch (error) {
      console.error(`   ❌ Erreur associations ${modelName}:`, error.message);
    }
  } else {
    console.log(`   ⚪ ${modelName} (pas d'associations)`);
  }
});

// 4. VÉRIFICATION INTÉGRITÉ ASSOCIATIONS
console.log('\n🔍 Vérification intégrité des associations...');
const expectedModels = [
  'User', 'Association', 'Section', 'AssociationMember',
  'Tontine', 'TontineParticipant', 'Rating',
  'Transaction', 'Document', 'Event'
];

const missingModels = expectedModels.filter(model => !db[model]);
if (missingModels.length > 0) {
  console.error('❌ Modèles manquants:', missingModels.join(', '));
} else {
  console.log('✅ Tous les modèles essentiels sont chargés');
}

// 5. VÉRIFICATIONS SPÉCIFIQUES ARCHITECTURE DIASPORATONTINE
console.log('\n🎯 Vérifications architecture DiasporaTontine...');

// Vérifier User (hub central)
if (db.User) {
  const userAssociations = Object.keys(db.User.associations || {});
  console.log(`   👤 User: ${userAssociations.length} associations configurées`);
  
  const expectedUserAssociations = [
    'associationMemberships', 'tontineParticipations', 
    'organizedTontines', 'transactions', 'documents'
  ];
  
  const missingUserAssociations = expectedUserAssociations.filter(
    assoc => !userAssociations.includes(assoc)
  );
  
  if (missingUserAssociations.length > 0) {
    console.warn(`   ⚠️  Associations User manquantes: ${missingUserAssociations.join(', ')}`);
  } else {
    console.log('   ✅ User: toutes les associations configurées');
  }
}

// Vérifier Association (module principal)
if (db.Association) {
  const assocAssociations = Object.keys(db.Association.associations || {});
  console.log(`   🏛️  Association: ${assocAssociations.length} associations configurées`);
}

// Vérifier Tontine (module principal)
if (db.Tontine) {
  const tontineAssociations = Object.keys(db.Tontine.associations || {});
  console.log(`   💰 Tontine: ${tontineAssociations.length} associations configurées`);
}

// Vérifier Transaction (modèle unifié)
if (db.Transaction) {
  const transactionAssociations = Object.keys(db.Transaction.associations || {});
  console.log(`   💳 Transaction: ${transactionAssociations.length} associations configurées`);
  
  // Vérifier que Transaction peut bien se lier à tous les contextes
  const expectedTransactionRefs = [
    'user', 'association', 'section', 'member', 'tontine', 'participant'
  ];
  
  const missingTransactionRefs = expectedTransactionRefs.filter(
    ref => !transactionAssociations.includes(ref)
  );
  
  if (missingTransactionRefs.length > 0) {
    console.warn(`   ⚠️  Transaction refs manquantes: ${missingTransactionRefs.join(', ')}`);
  } else {
    console.log('   ✅ Transaction: toutes les références configurées');
  }
}

console.log('');

// Exporter configuration finale
db.sequelize = sequelize;
db.Sequelize = Sequelize;

// 6. FONCTIONS UTILITAIRES POUR L'APPLICATION
db.checkModelsIntegrity = () => {
  const issues = [];
  
  // Vérifier que tous les modèles essentiels sont présents
  expectedModels.forEach(modelName => {
    if (!db[modelName]) {
      issues.push(`Modèle manquant: ${modelName}`);
    }
  });
  
  // Vérifier associations critiques
  if (db.User && !db.User.associations.associationMemberships) {
    issues.push('Association User -> AssociationMember manquante');
  }
  
  if (db.User && !db.User.associations.tontineParticipations) {
    issues.push('Association User -> TontineParticipant manquante');
  }
  
  return issues;
};

db.getModelsSummary = () => {
  return {
    totalModels: Object.keys(db).filter(key => typeof db[key] === 'function').length,
    coreModels: ['User', 'Transaction', 'Document'].filter(model => db[model]).length,
    associationModels: ['Association', 'Section', 'AssociationMember'].filter(model => db[model]).length,
    tontineModels: ['Tontine', 'TontineParticipant', 'Rating'].filter(model => db[model]).length,
    supportModels: ['Event'].filter(model => db[model]).length
  };
};

// Log final
const summary = db.getModelsSummary();
console.log('📊 ARCHITECTURE DIASPORATONTINE CHARGÉE:');
console.log(`   🏗️  Modèles core: ${summary.coreModels}/3`);
console.log(`   🏛️  Modèles association: ${summary.associationModels}/3`);
console.log(`   💰 Modèles tontine: ${summary.tontineModels}/3`);
console.log(`   📅 Modèles support: ${summary.supportModels}/1`);
console.log(`   📈 Total: ${summary.totalModels} modèles`);

const integrity = db.checkModelsIntegrity();
if (integrity.length > 0) {
  console.error('\n❌ PROBLÈMES D\'INTÉGRITÉ:');
  integrity.forEach(issue => console.error(`   - ${issue}`));
} else {
  console.log('\n✅ Architecture complète et cohérente !');
}

console.log('\n🚀 Prêt pour synchronisation auto-sync...\n');

module.exports = db;