//src/modules/association/models/ExpenseRequest.js
// Système unifié sorties d'argent association (numérique + manuel)

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ExpenseRequest = sequelize.define('ExpenseRequest', {
    
    // 🆔 IDENTIFIANTS
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    
    // 🎯 CONTEXTE ASSOCIATION
    associationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'associations',
        key: 'id'
      },
      comment: 'Association concernée'
    },
    
    sectionId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'sections', 
        key: 'id'
      },
      comment: 'Section si multi-sections (optionnel)'
    },
    
    // 👤 DEMANDEUR & BÉNÉFICIAIRE
    requesterId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id' 
      },
      comment: 'Qui fait la demande'
    },
    
    beneficiaryId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'Bénéficiaire si membre (null pour dépenses structure)'
    },
    
    beneficiaryExternal: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Bénéficiaire externe (autre association, fournisseur, etc.)',
      // { name: "Association Sénégalaise Italie", type: "association", contact: "...", iban: "..." }
    },
    
    // 🏷️ CATÉGORISATION CONFIGURABLE
    expenseType: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        isIn: [['aide_membre', 'depense_operationnelle', 'pret_partenariat', 'projet_special', 'urgence_communautaire']]
      },
      comment: 'Type principal de dépense'
    },
    
    expenseSubtype: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Sous-catégorie personnalisée par association',
      // Ex: "aide_mariage_traditionnel", "location_salle_ag", "pret_association_soeur"
    },
    
    // 💰 MONTANTS
    amountRequested: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        min: 0.01
      },
      comment: 'Montant demandé'
    },
    
    amountApproved: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      validate: {
        min: 0
      },
      comment: 'Montant approuvé (peut être différent)'
    },
    
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'EUR',
      validate: {
        isIn: [['EUR', 'USD', 'GBP', 'CAD', 'CHF', 'XOF', 'XAF']]
      },
      comment: 'Devise'
    },
    
    // 📝 JUSTIFICATION
    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: 'Titre/objet de la demande'
    },
    
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Description détaillée, justification'
    },
    
    urgencyLevel: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'normal',
      validate: {
        isIn: [['low', 'normal', 'high', 'critical']]
      },
      comment: 'Niveau d\'urgence'
    },
    
    // 📄 DOCUMENTS & PREUVES
    documents: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'URLs documents justificatifs uploadés',
      // [{ type: "facture", url: "...", name: "facture_hopital.pdf" }]
    },
    
    externalReferences: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Références externes (factures, devis, IBAN destinataire)',
      // { invoiceNumber: "F-2024-001", vendorIban: "FR76...", etc. }
    },
    
    // ⚖️ WORKFLOW VALIDATION
    status: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'pending',
      validate: {
        isIn: [['pending', 'under_review', 'additional_info_needed', 'approved', 'rejected', 'paid', 'cancelled']]
      },
      comment: 'Statut de la demande'
    },
    
    // Configuration validation selon Association.workflowRules
    requiredValidators: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Liste des validateurs requis selon config association',
      // ["president", "tresorier", "secretaire"] ou selon config personnalisée
    },
    
    validationHistory: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Historique des validations',
      // [{ userId: 123, role: "president", decision: "approved", comment: "...", timestamp: "..." }]
    },
    
    rejectionReason: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Motif de refus si applicable'
    },
    
    // 💳 PAIEMENT HYBRIDE (Numérique + Manuel)
    paymentMode: {
      type: DataTypes.STRING(20),
      allowNull: true,
      validate: {
        isIn: [['digital', 'manual']]
      },
      comment: 'Mode de paiement choisi'
    },
    
    paymentMethod: {
      type: DataTypes.STRING(30),
      allowNull: true,
      validate: {
        isIn: [['stripe_transfer', 'bank_transfer', 'cash', 'check', 'mobile_money']]
      },
      comment: 'Méthode de paiement spécifique'
    },
    
    // Paiement numérique (futur)
    transactionId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'transactions',
        key: 'id'
      },
      comment: 'Lien vers transaction de paiement'
    },
    
    // Paiement manuel (actuel)
    manualPaymentReference: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Référence virement/paiement manuel (ex: numéro virement)'
    },
    
    manualPaymentDetails: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Détails paiement manuel',
      // { iban: "FR76...", date: "2024-12-01", reference: "VIR-...", notes: "..." }
    },
    
    paymentValidatedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'Qui a validé/confirmé le paiement'
    },
    
    paidAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date/heure du paiement effectif'
    },
    
    // 🔄 REMBOURSEMENT (pour prêts)
    isLoan: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Si c\'est un prêt à rembourser'
    },
    
    loanTerms: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Conditions du prêt si applicable',
      // { durationMonths: 12, interestRate: 0, monthlyPayment: 100, startDate: "..." }
    },
    
    repaymentStatus: {
      type: DataTypes.STRING(20),
      allowNull: true,
      validate: {
        isIn: [['not_started', 'in_progress', 'completed', 'defaulted']]
      },
      comment: 'Statut remboursement si prêt'
    },
    
    // 📊 IMPACT & SUIVI
    expectedImpact: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Impact attendu/justification projet'
    },
    
    actualImpact: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Impact réel une fois réalisé'
    },
    
    followUpRequired: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Nécessite un suivi post-paiement'
    },
    
    followUpDate: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date de suivi programmée'
    },
    
    // 🔍 MÉTADONNÉES & AUDIT
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Données additionnelles configurables par association'
    },
    
    internalNotes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Notes internes bureau (non visibles demandeur)'
    },
    
    publicVisible: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Visible dans transparence publique association'
    },
    
    auditTrail: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Journal des modifications'
    }
    
  }, {
    
    tableName: 'expense_requests',
    timestamps: true,
    
    indexes: [
  { fields: ['association_id'] },  // au lieu de 'associationId'
  { fields: ['requester_id'] },    // au lieu de 'requesterId'
  { fields: ['beneficiary_id'] },  // au lieu de 'beneficiaryId'
  { fields: ['status'] },
  { fields: ['expense_type'] },    // au lieu de 'expenseType'
  { fields: ['expense_subtype'] }, // au lieu de 'expenseSubtype'
  { fields: ['created_at'] },      // au lieu de 'createdAt'
  { fields: ['urgency_level'] },   // au lieu de 'urgencyLevel'
  { fields: ['amount_requested'] }, // au lieu de 'amountRequested'
  { fields: ['is_loan'] },         // au lieu de 'isLoan'
  { fields: ['repayment_status'] } // au lieu de 'repaymentStatus'
],
    
    hooks: {
      beforeCreate: async (expenseRequest) => {
        // Auto-générer validateurs requis selon config association
        if (!expenseRequest.requiredValidators) {
          const association = await sequelize.models.Association.findByPk(expenseRequest.associationId);
          expenseRequest.requiredValidators = await generateRequiredValidators(
            association,
            expenseRequest.expenseType, 
            expenseRequest.amountRequested
          );
        }
        
        // Initialiser audit trail
        expenseRequest.auditTrail = [{
          action: 'created',
          userId: expenseRequest.requesterId,
          timestamp: new Date(),
          details: {
            type: expenseRequest.expenseType,
            amount: expenseRequest.amountRequested
          }
        }];
      },
      
      afterCreate: async (expenseRequest) => {
        // Notification automatique aux validateurs
        await sendNotificationToValidators(expenseRequest);
      },
      
      beforeUpdate: async (expenseRequest, options) => {
        // Ajouter à l'audit trail
        if (expenseRequest.changed()) {
          const changes = {};
          expenseRequest._changed.forEach(field => {
            changes[field] = {
              from: expenseRequest._previousDataValues[field],
              to: expenseRequest.dataValues[field]
            };
          });
          
          const currentTrail = expenseRequest.auditTrail || [];
          currentTrail.push({
            action: 'updated',
            userId: options.userId || null, // Passé via options
            timestamp: new Date(),
            changes: changes
          });
          
          expenseRequest.auditTrail = currentTrail;
        }
      }
    }
  });
  
  // 🔗 ASSOCIATIONS
  ExpenseRequest.associate = (models) => {
    
    // Contexte Association
    ExpenseRequest.belongsTo(models.Association, {
      foreignKey: 'associationId',
      as: 'association'
    });
    
    ExpenseRequest.belongsTo(models.Section, {
      foreignKey: 'sectionId', 
      as: 'section'
    });
    
    // Acteurs
    ExpenseRequest.belongsTo(models.User, {
      foreignKey: 'requesterId',
      as: 'requester'
    });
    
    ExpenseRequest.belongsTo(models.User, {
      foreignKey: 'beneficiaryId',
      as: 'beneficiary'
    });
    
    ExpenseRequest.belongsTo(models.User, {
      foreignKey: 'paymentValidatedBy',
      as: 'paymentValidator'
    });
    
    // Transaction liée (si paiement numérique)
    ExpenseRequest.belongsTo(models.Transaction, {
      foreignKey: 'transactionId',
      as: 'transaction'
    });
    
    // Documents de suivi
    ExpenseRequest.hasMany(models.Document, {
      foreignKey: 'relatedId',
      scope: { relatedType: 'expense_request' },
      as: 'relatedDocuments'
    });
    
    // Remboursements si prêt
    ExpenseRequest.hasMany(models.LoanRepayment, {
      foreignKey: 'expenseRequestId',
      as: 'repayments'
    });
  };
  
  // 🔧 MÉTHODES D'INSTANCE
  ExpenseRequest.prototype.isFullyValidated = function() {
    const required = this.requiredValidators || [];
    const validated = (this.validationHistory || [])
      .filter(v => v.decision === 'approved')
      .map(v => v.role);
    
    return required.every(role => validated.includes(role));
  };
  
  ExpenseRequest.prototype.canBeModified = function() {
    return ['pending', 'under_review', 'additional_info_needed'].includes(this.status);
  };
  
  ExpenseRequest.prototype.getValidationProgress = function() {
    const required = this.requiredValidators || [];
    const validated = (this.validationHistory || [])
      .filter(v => v.decision === 'approved').length;
    
    return {
      completed: validated,
      total: required.length,
      percentage: required.length > 0 ? Math.round((validated / required.length) * 100) : 0
    };
  };
  
  return ExpenseRequest;
};

// 🔧 FONCTIONS UTILITAIRES

async function generateRequiredValidators(association, expenseType, amount) {
  // Logique selon Association.workflowRules ou règles par défaut
  const workflowRules = association.workflowRules || {};
  
  // Par défaut : président + trésorier + secrétaire (comme convenu)
  let validators = ['president', 'tresorier', 'secretaire'];
  
  // Règles personnalisées selon type/montant si configurées
  if (workflowRules[expenseType]) {
    validators = workflowRules[expenseType].validators || validators;
  }
  
  return validators;
}

async function sendNotificationToValidators(expenseRequest) {
  // Service de notification aux validateurs requis
  // Implémentation dans notificationService
  console.log(`📧 Notifications envoyées pour demande ${expenseRequest.id}`);
}