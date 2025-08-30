'use strict';

const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const sequelize = require('../core/database/database');

const basename = path.basename(__filename);
const db = {};

// Définir tous les dossiers contenant des modèles
const modelDirectories = [
  __dirname, // src/models/ (User, Transaction)
  path.join(__dirname, '../modules/associations/models'),
  path.join(__dirname, '../modules/tontines/models')
];

// 1. CHARGER TOUS LES MODÈLES D'ABORD
modelDirectories.forEach(directory => {
  if (fs.existsSync(directory)) {
    console.log(`📁 Scan du dossier: ${directory}`);
    
    fs.readdirSync(directory)
      .filter(file => {
        return (file.indexOf('.') !== 0) && 
               (file !== basename) && 
               (file.slice(-3) === '.js');
      })
      .forEach(file => {
        console.log(`🔄 Chargement du modèle: ${file}`);
        try {
          const modelDefiner = require(path.join(directory, file));
          console.log(`📋 Type du modèle ${file}:`, typeof modelDefiner);
          
          if (typeof modelDefiner !== 'function') {
            console.error(`❌ Erreur: ${file} n'exporte pas une fonction`);
            return;
          }
          
          const model = modelDefiner(sequelize, Sequelize.DataTypes);
          db[model.name] = model;
          console.log(`✅ Modèle ${model.name} chargé avec succès`);
        } catch (error) {
          console.error(`❌ Erreur lors du chargement de ${file}:`, error.message);
        }
      });
  } else {
    console.log(`⚠️ Dossier introuvable: ${directory}`);
  }
});

// 2. CONFIGURER LES ASSOCIATIONS APRÈS AVOIR CHARGÉ TOUS LES MODÈLES
console.log('\n🔗 Configuration des associations...');
Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    console.log(`🔗 Configuration des associations pour ${modelName}`);
    try {
      db[modelName].associate(db);
    } catch (error) {
      console.error(`❌ Erreur associations ${modelName}:`, error.message);
    }
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;