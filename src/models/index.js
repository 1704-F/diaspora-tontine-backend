'use strict';

const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const sequelize = require('../config/database');

const basename = path.basename(__filename);
const db = {};

// Charger tous les modèles du dossier avec debug (style Ladoum)
fs
  .readdirSync(__dirname)
  .filter(file => {
    return (file.indexOf('.') !== 0) && (file !== basename) && (file.slice(-3) === '.js');
  })
  .forEach(file => {
    console.log(`🔄 Chargement du modèle: ${file}`);
    try {
      const modelDefiner = require(path.join(__dirname, file));
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

// Configurer les associations entre modèles
Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    console.log(`🔗 Configuration des associations pour ${modelName}`);
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;