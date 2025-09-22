// src/modules/associations/controllers/index.js
// Export centralisé des controllers Association

const associationController = require('./associationController');
const sectionController = require('./sectionController');
const memberController = require('./memberController');
const expenseRequestController = require('./expenseRequestController');

module.exports = {
  associationController,
  sectionController,
  memberController,
  expenseRequestController
};