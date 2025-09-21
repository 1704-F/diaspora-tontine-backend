//src/modules/association/models/LoanRepayment.js
// Suivi des remboursements de prêts

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const LoanRepayment = sequelize.define('LoanRepayment', {
    
    // 🆔 IDENTIFIANTS
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    
    // 🔗 LIEN VERS PRÊT
    expenseRequestId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'expense_requests',
        key: 'id'
      },
      comment: 'Prêt concerné'
    },
    
    // 💰 MONTANT REMBOURSÉ
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        min: 0.01
      },
      comment: 'Montant remboursé'
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
    
    // 📅 ÉCHÉANCE & PAIEMENT
    dueDate: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date d\'échéance prévue'
    },
    
    paymentDate: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: 'Date effective du remboursement'
    },
    
    // 💳 MÉTHODE PAIEMENT (Hybride)
    paymentMode: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'manual',
      validate: {
        isIn: [['digital', 'manual']]
      },
      comment: 'Mode de paiement'
    },
    
    paymentMethod: {
      type: DataTypes.STRING(30),
      allowNull: false,
      validate: {
        isIn: [['bank_transfer', 'card_payment', 'cash', 'check', 'mobile_money']]
      },
      comment: 'Méthode de paiement spécifique'
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
      comment: 'Référence paiement manuel (numéro virement, etc.)'
    },
    
    manualDetails: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Détails paiement manuel',
      // { iban: "FR76...", reference: "VIR-...", bank: "Crédit Agricole" }
    },
    
    // ⚖️ VALIDATION
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'pending',
      validate: {
        isIn: [['pending', 'validated', 'rejected', 'disputed']]
      },
      comment: 'Statut du remboursement'
    },
    
    validatedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'Trésorier ayant validé'
    },
    
    validatedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date de validation'
    },
    
    // 📝 NOTES & COMMENTAIRES
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Notes/commentaires sur le remboursement'
    },
    
    // 🔢 SUIVI ÉCHÉANCIER
    installmentNumber: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Numéro d\'échéance (si remboursement échelonné)'
    },
    
    isPartialPayment: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Remboursement partiel'
    },
    
    // 📊 CALCULS
    interestAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      comment: 'Montant des intérêts (si applicable)'
    },
    
    principalAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      comment: 'Montant du capital remboursé'
    },
    
    penaltyAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      comment: 'Pénalités de retard (si applicable)'
    },
    
    // 🕒 RETARD
    daysLate: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: 'Nombre de jours de retard'
    }
    
  }, {
    
    tableName: 'loan_repayments',
    timestamps: true,
    
    indexes: [
      { fields: ['expenseRequestId'] },
      { fields: ['paymentDate'] },
      { fields: ['dueDate'] },
      { fields: ['status'] },
      { fields: ['validatedBy'] },
      { fields: ['installmentNumber'] }
    ],
    
    hooks: {
      beforeCreate: async (repayment) => {
        // Calculer automatiquement capital vs intérêts
        if (!repayment.principalAmount && !repayment.interestAmount) {
          repayment.principalAmount = repayment.amount;
          repayment.interestAmount = 0;
        }
        
        // Calculer jours de retard si applicable
        if (repayment.dueDate && repayment.paymentDate) {
          const dueDate = new Date(repayment.dueDate);
          const paymentDate = new Date(repayment.paymentDate);
          
          if (paymentDate > dueDate) {
            const diffTime = paymentDate - dueDate;
            repayment.daysLate = Math.floor(diffTime / (1000 * 60 * 60 * 24));
          }
        }
      },
      
      afterCreate: async (repayment) => {
        // Mettre à jour le statut du prêt parent
        await updateLoanStatus(repayment.expenseRequestId);
      },
      
      afterUpdate: async (repayment) => {
        // Mettre à jour le statut du prêt parent si changement
        if (repayment.changed('status') || repayment.changed('amount')) {
          await updateLoanStatus(repayment.expenseRequestId);
        }
      }
    }
  });
  
  // 🔗 ASSOCIATIONS
  LoanRepayment.associate = (models) => {
    
    // Prêt parent
    LoanRepayment.belongsTo(models.ExpenseRequest, {
      foreignKey: 'expenseRequestId',
      as: 'loan'
    });
    
    // Validateur
    LoanRepayment.belongsTo(models.User, {
      foreignKey: 'validatedBy',
      as: 'validator'
    });
    
    // Transaction si paiement numérique
    LoanRepayment.belongsTo(models.Transaction, {
      foreignKey: 'transactionId',
      as: 'transaction'
    });
  };
  
  // 🔧 MÉTHODES D'INSTANCE
  LoanRepayment.prototype.isLate = function() {
    return this.daysLate > 0;
  };
  
  LoanRepayment.prototype.calculatePenalty = function(penaltyRate = 0.05) {
    if (this.daysLate > 0) {
      return this.principalAmount * (penaltyRate / 365) * this.daysLate;
    }
    return 0;
  };
  
  return LoanRepayment;
};

// 🔧 FONCTION UTILITAIRE
async function updateLoanStatus(expenseRequestId) {
  const { ExpenseRequest, LoanRepayment } = require('./index');
  
  const loan = await ExpenseRequest.findByPk(expenseRequestId);
  if (!loan || !loan.isLoan) return;
  
  const repayments = await LoanRepayment.findAll({
    where: { 
      expenseRequestId,
      status: 'validated'
    }
  });
  
  const totalRepaid = repayments.reduce((sum, r) => sum + parseFloat(r.amount), 0);
  const loanAmount = parseFloat(loan.amountApproved || loan.amountRequested);
  
  let newStatus = 'not_started';
  if (totalRepaid > 0) {
    newStatus = totalRepaid >= loanAmount ? 'completed' : 'in_progress';
  }
  
  await loan.update({ repaymentStatus: newStatus });
}