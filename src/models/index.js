'use strict';

const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const sequelize = require('../core/database/database'); // ✅ chemin correct

const basename = path.basename(__filename);
const db = {};

// Les dossiers de modèles à scanner
const modelDirectories = [
  __dirname, // src/models (User, Transaction, Document, etc.)
  path.join(__dirname, '../modules/associations/models'), // ✅ contient ExpenseRequest & LoanRepayment
  path.join(__dirname, '../modules/tontines/models')
];

console.log('🚀 DIASPORA TONTINE - Chargement des modèles...\n');

// 1️⃣ Chargement dynamique des modèles
modelDirectories.forEach(directory => {
  if (fs.existsSync(directory)) {
    console.log(`📁 Scan du dossier: ${path.relative(process.cwd(), directory)}`);

    fs.readdirSync(directory)
      .filter(file =>
        file.indexOf('.') !== 0 &&
        file !== basename &&
        file.slice(-3) === '.js' &&
        file.indexOf('.test.js') === -1
      )
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
    console.log('');
  } else {
    console.log(`⚠️  Dossier introuvable: ${path.relative(process.cwd(), directory)}\n`);
  }
});

// 2️⃣ Configuration des associations
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

// 3️⃣ Vérification d’intégrité
console.log('\n🔍 Vérification intégrité des associations...');
const expectedModels = [
  'User', 'Association', 'Section', 'AssociationMember',
  'Tontine', 'TontineParticipant', 'Rating',
  'Transaction', 'Document', 'Event',
  // ➕ Nouveaux modèles
  'ExpenseRequest', 'LoanRepayment'
];

const missingModels = expectedModels.filter(model => !db[model]);
if (missingModels.length > 0) {
  console.error('❌ Modèles manquants:', missingModels.join(', '));
} else {
  console.log('✅ Tous les modèles essentiels sont chargés');
}

// 4️⃣ Fonctions utilitaires
db.checkModelsIntegrity = () => {
  const issues = [];
  expectedModels.forEach(modelName => {
    if (!db[modelName]) {
      issues.push(`Modèle manquant: ${modelName}`);
    }
  });
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
    totalModels: Object.keys(db).filter(k => typeof db[k] === 'function').length,
    coreModels: ['User', 'Transaction', 'Document'].filter(m => db[m]).length,
    associationModels: [
      'Association', 'Section', 'AssociationMember',
      'ExpenseRequest', 'LoanRepayment' // ✅ inclus ici
    ].filter(m => db[m]).length,
    tontineModels: ['Tontine', 'TontineParticipant', 'Rating'].filter(m => db[m]).length,
    supportModels: ['Event'].filter(m => db[m]).length
  };
};

// 5️⃣ Résumé
const summary = db.getModelsSummary();
console.log('📊 ARCHITECTURE DIASPORATONTINE CHARGÉE:');
console.log(`   🏗️  Modèles core: ${summary.coreModels}/3`);
console.log(`   🏛️  Modèles association: ${summary.associationModels}/5`);
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

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;
