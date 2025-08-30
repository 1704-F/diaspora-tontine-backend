const { body, param, query, validationResult } = require('express-validator');

// 🔧 UTILITAIRES VALIDATION
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Données invalides',
      code: 'VALIDATION_ERROR',
      details: errors.array().map(err => ({
        field: err.path,
        message: err.msg,
        value: err.value
      }))
    });
  }
  
  next();
};

// Validation JSON schema pour configuration flexible
const validateJSONConfig = (field, schema) => {
  return body(field).custom((value) => {
    if (!value) return true; // Optionnel
    
    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      
      // Validation selon le schema
      if (schema === 'memberTypes') {
        return validateMemberTypesSchema(parsed);
      }
      if (schema === 'bureauCentral') {
        return validateBureauCentralSchema(parsed);
      }
      if (schema === 'permissionsMatrix') {
        return validatePermissionsMatrixSchema(parsed);
      }
      
      return true;
    } catch (error) {
      throw new Error(`JSON invalide pour ${field}: ${error.message}`);
    }
  });
};

// Validation schema memberTypes (DIFFÉRENCIATEUR CLÉ)
const validateMemberTypesSchema = (memberTypes) => {
  if (!Array.isArray(memberTypes)) {
    throw new Error('memberTypes doit être un tableau');
  }
  
  const requiredFields = ['name', 'cotisationAmount'];
  
  memberTypes.forEach((type, index) => {
    requiredFields.forEach(field => {
      if (!type[field]) {
        throw new Error(`memberTypes[${index}].${field} est requis`);
      }
    });
    
    // Validation montant cotisation
    if (typeof type.cotisationAmount !== 'number' || type.cotisationAmount < 0) {
      throw new Error(`memberTypes[${index}].cotisationAmount doit être un nombre positif`);
    }
    
    // Validation nom unique
    const duplicates = memberTypes.filter(t => t.name === type.name);
    if (duplicates.length > 1) {
      throw new Error(`Type membre "${type.name}" en double`);
    }
  });
  
  return true;
};

// Validation schema bureauCentral
const validateBureauCentralSchema = (bureau) => {
  if (typeof bureau !== 'object' || bureau === null) {
    throw new Error('bureauCentral doit être un objet');
  }
  
  // Rôles obligatoires
  const requiredRoles = ['president', 'secretaire', 'tresorier'];
  requiredRoles.forEach(role => {
    if (!bureau[role]) {
      throw new Error(`Rôle obligatoire manquant: ${role}`);
    }
    
    if (typeof bureau[role] !== 'object' || !bureau[role].userId) {
      throw new Error(`bureau.${role} doit contenir un userId`);
    }
  });
  
  return true;
};

// Validation schema permissions matrix
const validatePermissionsMatrixSchema = (permissions) => {
  if (typeof permissions !== 'object' || permissions === null) {
    throw new Error('permissionsMatrix doit être un objet');
  }
  
  const validActions = [
    'view_finances', 'manage_members', 'approve_aids', 
    'view_member_list', 'export_data', 'manage_events'
  ];
  
  Object.keys(permissions).forEach(action => {
    if (!validActions.includes(action)) {
      throw new Error(`Action permission inconnue: ${action}`);
    }
    
    const config = permissions[action];
    if (!config.allowed_roles || !Array.isArray(config.allowed_roles)) {
      throw new Error(`${action}.allowed_roles doit être un tableau`);
    }
  });
  
  return true;
};

// 🏛️ VALIDATIONS ASSOCIATION
const validateCreateAssociation = [
  body('name')
    .trim()
    .isLength({ min: 3, max: 255 })
    .withMessage('Nom association: 3-255 caractères'),
    
  body('legalStatus')
    .isIn(['association_1901', 'asbl', 'nonprofit_501c3', 'other'])
    .withMessage('Statut légal invalide'),
    
  body('country')
    .isLength({ min: 2, max: 3 })
    .isAlpha()
    .withMessage('Code pays invalide (ISO)'),
    
  body('description')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Description max 1000 caractères'),
    
  body('memberTypes')
    .optional()
    .custom((value) => {
      if (!value) return true;
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      return validateMemberTypesSchema(parsed);
    }),
    
  body('bureauCentral')
    .optional()
    .custom((value) => {
      if (!value) return true;
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      return validateBureauCentralSchema(parsed);
    }),
    
  body('permissionsMatrix')
    .optional()
    .custom((value) => {
      if (!value) return true;
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      return validatePermissionsMatrixSchema(parsed);
    }),
    
  handleValidationErrors
];

const validateUpdateAssociation = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID association invalide'),
    
  body('name')
    .optional()
    .trim()
    .isLength({ min: 3, max: 255 })
    .withMessage('Nom association: 3-255 caractères'),
    
  body('memberTypes')
    .optional()
    .custom((value) => {
      if (!value) return true;
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      return validateMemberTypesSchema(parsed);
    }),
    
  body('bureauCentral')
    .optional()
    .custom((value) => {
      if (!value) return true;
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      return validateBureauCentralSchema(parsed);
    }),
    
  handleValidationErrors
];

// 👥 VALIDATIONS MEMBRES
const validateAddMember = [
  param('associationId')
    .isInt({ min: 1 })
    .withMessage('ID association invalide'),
    
  body('userId')
    .isInt({ min: 1 })
    .withMessage('ID utilisateur invalide'),
    
  body('memberType')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Type membre requis'),
    
  body('sectionId')
    .optional()
    .isInt({ min: 1 })
    .withMessage('ID section invalide'),
    
  body('cotisationAmount')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Montant cotisation invalide'),
    
  handleValidationErrors
];

// 🏗️ VALIDATIONS SECTIONS
const validateCreateSection = [
  param('associationId')
    .isInt({ min: 1 })
    .withMessage('ID association invalide'),
    
  body('name')
    .trim()
    .isLength({ min: 3, max: 255 })
    .withMessage('Nom section: 3-255 caractères'),
    
  body('country')
    .isLength({ min: 2, max: 3 })
    .isAlpha()
    .withMessage('Code pays invalide'),
    
  body('currency')
    .isLength({ min: 3, max: 3 })
    .isAlpha()
    .withMessage('Code devise invalide (ISO 4217)'),
    
  body('language')
    .isLength({ min: 2, max: 2 })
    .isAlpha()
    .withMessage('Code langue invalide (ISO 639-1)'),
    
  body('cotisationRates')
    .optional()
    .isJSON()
    .withMessage('cotisationRates doit être JSON valide'),
    
  handleValidationErrors
];

// 💰 VALIDATIONS COTISATIONS
const validateCotisationPayment = [
  body('associationId')
    .isInt({ min: 1 })
    .withMessage('ID association invalide'),
    
  body('amount')
    .isFloat({ min: 0.01 })
    .withMessage('Montant doit être positif'),
    
  body('month')
    .isInt({ min: 1, max: 12 })
    .withMessage('Mois invalide (1-12)'),
    
  body('year')
    .isInt({ min: 2020, max: 2050 })
    .withMessage('Année invalide'),
    
  body('paymentMethodId')
    .trim()
    .isLength({ min: 1 })
    .withMessage('Méthode paiement requise'),
    
  body('sectionId')
    .optional()
    .isInt({ min: 1 })
    .withMessage('ID section invalide'),
    
  handleValidationErrors
];

// 🔍 VALIDATIONS RECHERCHE
const validateListAssociations = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page doit être positive'),
    
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limite: 1-100 éléments'),
    
  query('status')
    .optional()
    .isIn(['active', 'inactive', 'pending', 'suspended'])
    .withMessage('Statut invalide'),
    
  query('country')
    .optional()
    .isLength({ min: 2, max: 3 })
    .isAlpha()
    .withMessage('Code pays invalide'),
    
  handleValidationErrors
];

// 📅 VALIDATIONS ÉVÉNEMENTS
const validateCreateEvent = [
  body('associationId')
    .isInt({ min: 1 })
    .withMessage('ID association invalide'),
    
  body('title')
    .trim()
    .isLength({ min: 3, max: 255 })
    .withMessage('Titre événement: 3-255 caractères'),
    
  body('startDate')
    .isISO8601()
    .withMessage('Date début invalide (ISO 8601)'),
    
  body('endDate')
    .optional()
    .isISO8601()
    .withMessage('Date fin invalide (ISO 8601)')
    .custom((endDate, { req }) => {
      if (endDate && req.body.startDate) {
        if (new Date(endDate) <= new Date(req.body.startDate)) {
          throw new Error('Date fin doit être après date début');
        }
      }
      return true;
    }),
    
  body('type')
    .isIn(['meeting', 'general_assembly', 'cultural', 'social', 'fundraising', 'conference', 'workshop', 'celebration', 'other'])
    .withMessage('Type événement invalide'),
    
  body('visibility')
    .optional()
    .isIn(['public', 'association', 'section', 'bureau', 'invited_only'])
    .withMessage('Niveau visibilité invalide'),
    
  handleValidationErrors
];

// 🔧 VALIDATIONS PARAMÈTRES GÉNÉRIQUES
const validateId = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('ID invalide'),
  handleValidationErrors
];

const validateAssociationId = [
  param('associationId')
    .isInt({ min: 1 })
    .withMessage('ID association invalide'),
  handleValidationErrors
];

const validateSectionId = [
  param('sectionId')
    .isInt({ min: 1 })
    .withMessage('ID section invalide'),
  handleValidationErrors
];

// 📱 VALIDATION SPÉCIFIQUE DIASPORA
const validateDiasporaData = [
  body('country')
    .custom((country) => {
      // Liste pays diaspora supportés
      const supportedCountries = ['FR', 'IT', 'ES', 'BE', 'US', 'CA', 'SN', 'ML', 'TG', 'CI'];
      if (!supportedCountries.includes(country)) {
        throw new Error(`Pays non supporté. Supportés: ${supportedCountries.join(', ')}`);
      }
      return true;
    }),
    
  body('currency')
    .custom((currency) => {
      const supportedCurrencies = ['EUR', 'USD', 'CAD', 'XOF', 'GBP'];
      if (!supportedCurrencies.includes(currency)) {
        throw new Error(`Devise non supportée. Supportées: ${supportedCurrencies.join(', ')}`);
      }
      return true;
    })
];

// Export des validations
module.exports = {
  // Utilitaires
  handleValidationErrors,
  validateJSONConfig,
  
  // Association
  validateCreateAssociation,
  validateUpdateAssociation,
  validateListAssociations,
  
  // Membres
  validateAddMember,
  
  // Sections
  validateCreateSection,
  
  // Cotisations
  validateCotisationPayment,
  
  // Événements
  validateCreateEvent,
  
  // Paramètres génériques
  validateId,
  validateAssociationId,
  validateSectionId,
  
  // Spécifique diaspora
  validateDiasporaData
};