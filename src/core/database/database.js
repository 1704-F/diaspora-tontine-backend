const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  dialect: 'postgres',
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000
  },
  define: {
    underscored: true,        // camelCase → snake_case automatique
    timestamps: true,         // created_at, updated_at automatiques
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  },
  dialectOptions: {
    // Support des timezones
    timezone: 'Etc/GMT0'
  }
});

module.exports = sequelize;