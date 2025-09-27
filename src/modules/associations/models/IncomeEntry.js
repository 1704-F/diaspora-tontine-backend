//src/modules/association/models/IncomeEntry.js

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const IncomeEntry = sequelize.define('IncomeEntry', {
    
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
      comment: 'Section si revenus spécifiques (optionnel)'
    },
    
    // 👤 ENREGISTREMENT
    registeredBy: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'Qui a enregistré cette entrée (bureau)'
    },
    
    // 🏷️ CATÉGORISATION CONFIGURABLE
    incomeType: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: 'Type d\'entrée configurable par association',
      // Ex: "don_particulier", "subvention_mairie", "vente_event", "partenariat", "cotisation_exceptionnelle"
    },
    
    incomeSubtype: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Sous-catégorie pour classification fine'
    },
    
    // 💰 MONTANTS
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        min: 0.01
      },
      comment: 'Montant reçu'
    },
    
    grossAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      comment: 'Montant brut (avant déductions/frais)'
    },
    
    netAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      comment: 'Montant net reçu (after frais)'
    },
    
    fees: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      comment: 'Frais prélevés (si applicable)'
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
    
    // 🏢 SOURCE & DONATEUR
    sourceType: {
      type: DataTypes.STRING(30),
      allowNull: false,
      validate: {
        isIn: [['individual', 'company', 'government', 'ngo', 'foundation', 'member', 'anonymous']]
      },
      comment: 'Type de source'
    },
    
    sourceName: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Nom du donateur/source (si pas anonyme)'
    },
    
    sourceDetails: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Détails source (contact, adresse, etc.)',
      // { name: "Mairie 19ème", contact: "maire@paris19.fr", address: "...", siret: "..." }
    },
    
    isAnonymous: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Don anonyme'
    },
    
    // 📝 DESCRIPTION & JUSTIFICATION
    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: 'Titre/objet de l\'entrée'
    },
    
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Description détaillée'
    },
    
    purpose: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Objectif/utilisation prévue des fonds'
    },
    
    // 📄 DOCUMENTS & PREUVES
    documents: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Documents justificatifs',
      // [{ type: "recu_don", url: "...", name: "recu_mairie.pdf" }]
    },
    
    receiptGenerated: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Reçu fiscal généré'
    },
    
    receiptNumber: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Numéro reçu fiscal (si généré)'
    },
    
    // 📅 DATES
    receivedDate: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: 'Date de réception effective'
    },
    
    promisedDate: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date promise (si différente)'
    },
    
    // 💳 MÉTHODE RÉCEPTION
    paymentMethod: {
      type: DataTypes.STRING(30),
      allowNull: false,
      validate: {
        isIn: [['bank_transfer', 'check', 'cash', 'card_payment', 'mobile_money', 'crypto', 'other']]
      },
      comment: 'Méthode de réception'
    },
    
    // 🔗 TRANSACTION LIÉE
    transactionId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'transactions',
        key: 'id'
      },
      comment: 'Transaction associée (si paiement numérique)'
    },
    
    // 📝 DÉTAILS MANUELS
    manualReference: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Référence manuelle (numéro chèque, virement, etc.)'
    },
    
    bankDetails: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Détails bancaires (si applicable)',
      // { bank: "BNP", iban: "FR76...", reference: "VIR-DON-001" }
    },
    
    // ⚖️ VALIDATION & STATUT
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'pending',
      validate: {
        isIn: [['pending', 'validated', 'rejected', 'cancelled']]
      },
      comment: 'Statut de l\'entrée'
    },
    
    validatedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'Qui a validé (trésorier/président)'
    },
    
    validatedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date de validation'
    },
    
    rejectionReason: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Motif de refus si applicable'
    },
    
    // 🔄 RÉCURRENCE (pour subventions régulières)
    isRecurring: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Entrée récurrente'
    },
    
    recurringPattern: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Modèle de récurrence',
      // { frequency: "monthly", duration: 12, nextDate: "2024-02-01" }
    },
    
    parentIncomeId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'income_entries',
        key: 'id'
      },
      comment: 'Entrée parent (si récurrence)'
    },
    
    // 🎯 AFFECTATION & UTILISATION
    designatedFor: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Affectation spécifique des fonds',
      // { project: "construction_ecole", percentage: 100 }
    },
    
    restrictedUse: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Usage restreint selon donateur'
    },
    
    usageRestrictions: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Restrictions d\'usage si applicable'
    },
    
    // 📊 STATISTIQUES & REMERCIEMENTS
    publiclyVisible: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Visible publiquement (avec accord donateur)'
    },
    
    thanksRequired: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Remerciement requis'
    },
    
    thanksSent: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Remerciement envoyé'
    },
    
    // 🔍 MÉTADONNÉES
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Données additionnelles'
    },
    
    internalNotes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Notes internes bureau'
    },
    
    tags: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Tags pour classification'
    }
    
  }, {
    
    tableName: 'income_entries',
    timestamps: true,
    
    indexes: [
      { fields: ['associationId'] },
      { fields: ['registeredBy'] },
      { fields: ['incomeType'] },
      { fields: ['sourceType'] },
      { fields: ['receivedDate'] },
      { fields: ['status'] },
      { fields: ['amount'] },
      { fields: ['isRecurring'] },
      { fields: ['parentIncomeId'] }
    ],
    
    hooks: {
      beforeCreate: async (incomeEntry) => {
        // Calculer montant net si pas fourni
        if (!incomeEntry.netAmount) {
          incomeEntry.netAmount = incomeEntry.amount - (incomeEntry.fees || 0);
        }
        
        // Générer numéro de reçu si nécessaire
        if (incomeEntry.receiptGenerated && !incomeEntry.receiptNumber) {
          incomeEntry.receiptNumber = await generateReceiptNumber(incomeEntry.associationId);
        }
      },
      
      afterCreate: async (incomeEntry) => {
        // Créer transaction dans le système unifié
        await createLinkedTransaction(incomeEntry);
        
        // Notification bureau si montant important
        if (incomeEntry.amount > 1000) {
          await notifyBoardOfLargeIncome(incomeEntry);
        }
      },
      
      afterUpdate: async (incomeEntry) => {
        // Mettre à jour transaction liée si montant change
        if (incomeEntry.changed('amount') && incomeEntry.transactionId) {
          await updateLinkedTransaction(incomeEntry);
        }
      }
    }
  });
  
  // 🔗 ASSOCIATIONS
  IncomeEntry.associate = (models) => {
    
    // Contexte Association
    IncomeEntry.belongsTo(models.Association, {
      foreignKey: 'associationId',
      as: 'association'
    });
    
    IncomeEntry.belongsTo(models.Section, {
      foreignKey: 'sectionId',
      as: 'section'
    });
    
    // Enregistrement & Validation
    IncomeEntry.belongsTo(models.User, {
      foreignKey: 'registeredBy',
      as: 'registeredByUser'
    });
    
    IncomeEntry.belongsTo(models.User, {
      foreignKey: 'validatedBy',
      as: 'validatedByUser'
    });
    
    // Transaction liée
    IncomeEntry.belongsTo(models.Transaction, {
      foreignKey: 'transactionId',
      as: 'transaction'
    });
    
    // Récurrence
    IncomeEntry.belongsTo(models.IncomeEntry, {
      foreignKey: 'parentIncomeId',
      as: 'parentIncome'
    });
    
    IncomeEntry.hasMany(models.IncomeEntry, {
      foreignKey: 'parentIncomeId',
      as: 'childIncomes'
    });
    
    // Documents liés
    IncomeEntry.hasMany(models.Document, {
      foreignKey: 'relatedId',
      scope: { relatedType: 'income_entry' },
      as: 'relatedDocuments'
    });
  };
  
  // 🔧 MÉTHODES D'INSTANCE
  IncomeEntry.prototype.generateReceipt = async function() {
    if (!this.receiptGenerated) {
      this.receiptNumber = await generateReceiptNumber(this.associationId);
      this.receiptGenerated = true;
      await this.save();
    }
    return this.receiptNumber;
  };
  
  IncomeEntry.prototype.sendThanks = async function() {
    if (this.thanksRequired && !this.thanksSent) {
      // Logique envoi remerciements
      this.thanksSent = true;
      await this.save();
    }
  };
  
  IncomeEntry.prototype.canBeModified = function() {
    return ['pending'].includes(this.status);
  };
  
  return IncomeEntry;
};

// 🔧 FONCTIONS UTILITAIRES

async function generateReceiptNumber(associationId) {
  const year = new Date().getFullYear();
  const count = await IncomeEntry.count({
    where: {
      associationId,
      receiptGenerated: true,
      createdAt: {
        [sequelize.Sequelize.Op.gte]: new Date(`${year}-01-01`)
      }
    }
  });
  
  return `RECU-${associationId}-${year}-${String(count + 1).padStart(4, '0')}`;
}

async function createLinkedTransaction(incomeEntry) {
  const { Transaction } = require('./index');
  
  const transaction = await Transaction.create({
    userId: incomeEntry.registeredBy,
    associationId: incomeEntry.associationId,
    sectionId: incomeEntry.sectionId,
    type: 'income_entry',
    amount: incomeEntry.amount,
    netAmount: incomeEntry.netAmount,
    commissionAmount: incomeEntry.fees,
    status: incomeEntry.status === 'validated' ? 'completed' : 'pending',
    description: `${incomeEntry.title} - ${incomeEntry.incomeType}`,
    paymentMethod: incomeEntry.paymentMethod,
    source: 'manual',
    metadata: {
      incomeEntryId: incomeEntry.id,
      sourceType: incomeEntry.sourceType,
      sourceName: incomeEntry.sourceName
    }
  });
  
  // Lier la transaction
  await incomeEntry.update({ transactionId: transaction.id });
}

async function updateLinkedTransaction(incomeEntry) {
  if (incomeEntry.transactionId) {
    const { Transaction } = require('./index');
    await Transaction.update({
      amount: incomeEntry.amount,
      netAmount: incomeEntry.netAmount,
      status: incomeEntry.status === 'validated' ? 'completed' : 'pending'
    }, {
      where: { id: incomeEntry.transactionId }
    });
  }
}

async function notifyBoardOfLargeIncome(incomeEntry) {
  // Service de notification pour entrées importantes
  console.log(`💰 Entrée importante: ${incomeEntry.amount}€ - ${incomeEntry.title}`);
}