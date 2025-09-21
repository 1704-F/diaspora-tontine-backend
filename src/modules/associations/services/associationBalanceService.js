// src/modules/associations/services/associationBalanceService.js
// Service calcul solde association avec contrôle fonds disponibles

const { Op } = require('sequelize');
const { Transaction, ExpenseRequest, LoanRepayment } = require('../../../models');

class AssociationBalanceService {
  
  /**
   * 💰 Calculer le solde disponible d'une association
   */
  static async getAvailableBalance(associationId) {
    try {
      // 1. ENTRÉES D'ARGENT
      const totalIncome = await this.getTotalIncome(associationId);
      
      // 2. SORTIES D'ARGENT  
      const totalExpenses = await this.getTotalExpenses(associationId);
      
      // 3. PRÊTS EN COURS (non remboursés)
      const outstandingLoans = await this.getOutstandingLoans(associationId);
      
      // 4. CALCUL FINAL
      const availableBalance = totalIncome - totalExpenses - outstandingLoans;
      
      return {
        totalIncome,
        totalExpenses,
        outstandingLoans,
        availableBalance,
        lastCalculated: new Date()
      };
      
    } catch (error) {
      console.error('Erreur calcul solde association:', error);
      throw new Error('Impossible de calculer le solde');
    }
  }
  
  /**
   * 💰 Total des entrées d'argent
   */
  static async getTotalIncome(associationId) {
    // Pour l'instant, uniquement cotisations
    const cotisationsResult = await Transaction.findOne({
      where: {
        associationId,
        type: 'cotisation',
        status: 'completed'
      },
      attributes: [
        [Transaction.sequelize.fn('SUM', Transaction.sequelize.col('net_amount')), 'total']
      ],
      raw: true
    });
    
    const totalCotisations = parseFloat(cotisationsResult?.total || 0);
    
    // TODO: Ajouter autres types d'entrées personnalisées (IncomeEntry futur)
    const totalAutresEntrees = 0;
    
    return totalCotisations + totalAutresEntrees;
  }
  
  /**
   * 💸 Total des sorties d'argent (dépenses payées)
   */
  static async getTotalExpenses(associationId) {
    // Dépenses via ExpenseRequest payées
    const expensesResult = await ExpenseRequest.findOne({
      where: {
        associationId,
        status: 'paid'
      },
      attributes: [
        [ExpenseRequest.sequelize.fn('SUM', ExpenseRequest.sequelize.col('amount_approved')), 'total']
      ],
      raw: true
    });
    
    const totalExpenseRequests = parseFloat(expensesResult?.total || 0);
    
    // Autres sorties via Transaction directes (aides anciennes, etc.)
    const otherExpensesResult = await Transaction.findOne({
      where: {
        associationId,
        type: 'aide',
        status: 'completed'
      },
      attributes: [
        [Transaction.sequelize.fn('SUM', Transaction.sequelize.col('amount')), 'total']
      ],
      raw: true
    });
    
    const totalOtherExpenses = parseFloat(otherExpensesResult?.total || 0);
    
    return totalExpenseRequests + totalOtherExpenses;
  }
  
  /**
   * 🔄 Prêts en cours (non entièrement remboursés)
   */
  static async getOutstandingLoans(associationId) {
    // Récupérer tous les prêts approuvés
    const loans = await ExpenseRequest.findAll({
      where: {
        associationId,
        isLoan: true,
        status: 'paid',
        repaymentStatus: ['not_started', 'in_progress']
      },
      attributes: ['id', 'amountApproved', 'amountRequested']
    });
    
    let totalOutstanding = 0;
    
    for (const loan of loans) {
      const loanAmount = parseFloat(loan.amountApproved || loan.amountRequested);
      
      // Calculer le total remboursé pour ce prêt
      const repaymentsResult = await LoanRepayment.findOne({
        where: {
          expenseRequestId: loan.id,
          status: 'validated'
        },
        attributes: [
          [LoanRepayment.sequelize.fn('SUM', LoanRepayment.sequelize.col('principal_amount')), 'total']
        ],
        raw: true
      });
      
      const totalRepaid = parseFloat(repaymentsResult?.total || 0);
      const outstanding = loanAmount - totalRepaid;
      
      if (outstanding > 0) {
        totalOutstanding += outstanding;
      }
    }
    
    return totalOutstanding;
  }
  
  /**
   * ✅ Vérifier si fonds suffisants pour une dépense
   */
  static async checkSufficientFunds(associationId, requestedAmount) {
    const balance = await this.getAvailableBalance(associationId);
    
    return {
      sufficient: balance.availableBalance >= requestedAmount,
      availableBalance: balance.availableBalance,
      requestedAmount,
      shortage: Math.max(0, requestedAmount - balance.availableBalance)
    };
  }
  
  /**
   * 📊 Détail des finances association
   */
  static async getFinancialSummary(associationId, options = {}) {
    const { period = 'all', includeProjections = false } = options;
    
    // Calcul solde actuel
    const currentBalance = await this.getAvailableBalance(associationId);
    
    // Dépenses en attente d'approbation
    const pendingExpensesResult = await ExpenseRequest.findOne({
      where: {
        associationId,
        status: ['pending', 'under_review', 'approved']
      },
      attributes: [
        [ExpenseRequest.sequelize.fn('SUM', ExpenseRequest.sequelize.col('amount_requested')), 'total']
      ],
      raw: true
    });
    
    const pendingExpenses = parseFloat(pendingExpensesResult?.total || 0);
    
    // Prochaines échéances prêts
    const upcomingRepaymentsResult = await LoanRepayment.findOne({
      where: {
        dueDate: {
          [Op.between]: [new Date(), new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)] // 30 jours
        },
        status: 'pending'
      },
      include: [{
        model: ExpenseRequest,
        as: 'loan',
        where: { associationId },
        attributes: []
      }],
      attributes: [
        [LoanRepayment.sequelize.fn('SUM', LoanRepayment.sequelize.col('amount')), 'total']
      ],
      raw: true
    });
    
    const upcomingRepayments = parseFloat(upcomingRepaymentsResult?.total || 0);
    
    // Breakdown par type de dépense
    const expensesByType = await this.getExpensesByType(associationId, period);
    
    return {
      currentBalance,
      pendingExpenses,
      upcomingRepayments,
      projectedBalance: currentBalance.availableBalance - pendingExpenses + upcomingRepayments,
      expensesByType,
      lastCalculated: new Date()
    };
  }
  
  /**
   * 📈 Répartition dépenses par type
   */
  static async getExpensesByType(associationId, period = 'all') {
    let whereClause = { associationId, status: 'paid' };
    
    // Filtre période si spécifié
    if (period !== 'all') {
      const periodMap = {
        'month': 30,
        'quarter': 90,
        'year': 365
      };
      
      const days = periodMap[period] || 30;
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      
      whereClause.createdAt = {
        [Op.gte]: startDate
      };
    }
    
    const expensesByType = await ExpenseRequest.findAll({
      where: whereClause,
      attributes: [
        'expenseType',
        [ExpenseRequest.sequelize.fn('COUNT', ExpenseRequest.sequelize.col('id')), 'count'],
        [ExpenseRequest.sequelize.fn('SUM', ExpenseRequest.sequelize.col('amount_approved')), 'total']
      ],
      group: ['expenseType'],
      raw: true
    });
    
    return expensesByType.map(item => ({
      type: item.expenseType,
      count: parseInt(item.count),
      total: parseFloat(item.total || 0)
    }));
  }
  
  /**
   * 🚨 Alertes financières
   */
  static async getFinancialAlerts(associationId) {
    const alerts = [];
    const balance = await this.getAvailableBalance(associationId);
    
    // Alerte solde faible
    if (balance.availableBalance < 500) {
      alerts.push({
        type: 'low_balance',
        severity: 'warning',
        message: `Solde faible: ${balance.availableBalance.toFixed(2)}€`,
        value: balance.availableBalance
      });
    }
    
    // Alerte solde négatif
    if (balance.availableBalance < 0) {
      alerts.push({
        type: 'negative_balance',
        severity: 'critical',
        message: `Solde négatif: ${balance.availableBalance.toFixed(2)}€`,
        value: balance.availableBalance
      });
    }
    
    // Prêts en retard
    const lateRepayments = await LoanRepayment.count({
      where: {
        dueDate: { [Op.lt]: new Date() },
        status: 'pending'
      },
      include: [{
        model: ExpenseRequest,
        as: 'loan',
        where: { associationId },
        attributes: []
      }]
    });
    
    if (lateRepayments > 0) {
      alerts.push({
        type: 'late_repayments',
        severity: 'warning',
        message: `${lateRepayments} remboursement(s) en retard`,
        value: lateRepayments
      });
    }
    
    // Dépenses en attente importantes
    const largePendingExpenses = await ExpenseRequest.count({
      where: {
        associationId,
        status: ['pending', 'under_review', 'approved'],
        amountRequested: { [Op.gt]: balance.availableBalance }
      }
    });
    
    if (largePendingExpenses > 0) {
      alerts.push({
        type: 'large_pending_expenses',
        severity: 'info',
        message: `${largePendingExpenses} dépense(s) en attente dépassent le solde`,
        value: largePendingExpenses
      });
    }
    
    return alerts;
  }
  
  /**
   * 📊 Historique évolution solde
   */
  static async getBalanceHistory(associationId, months = 12) {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);
    
    const history = [];
    
    // Calculer solde pour chaque mois
    for (let i = 0; i < months; i++) {
      const monthStart = new Date(startDate);
      monthStart.setMonth(startDate.getMonth() + i);
      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      
      // Revenus du mois
      const monthlyIncome = await Transaction.findOne({
        where: {
          associationId,
          type: 'cotisation',
          status: 'completed',
          createdAt: {
            [Op.between]: [monthStart, monthEnd]
          }
        },
        attributes: [
          [Transaction.sequelize.fn('SUM', Transaction.sequelize.col('net_amount')), 'total']
        ],
        raw: true
      });
      
      // Dépenses du mois
      const monthlyExpenses = await ExpenseRequest.findOne({
        where: {
          associationId,
          status: 'paid',
          paidAt: {
            [Op.between]: [monthStart, monthEnd]
          }
        },
        attributes: [
          [ExpenseRequest.sequelize.fn('SUM', ExpenseRequest.sequelize.col('amount_approved')), 'total']
        ],
        raw: true
      });
      
      history.push({
        month: monthStart.toISOString().substring(0, 7), // YYYY-MM
        income: parseFloat(monthlyIncome?.total || 0),
        expenses: parseFloat(monthlyExpenses?.total || 0),
        net: parseFloat(monthlyIncome?.total || 0) - parseFloat(monthlyExpenses?.total || 0)
      });
    }
    
    return history;
  }
  
  /**
   * 🔄 Mise à jour cache solde (pour performance)
   */
  static async updateBalanceCache(associationId) {
    // TODO: Implémenter cache Redis si nécessaire
    // Pour l'instant, calcul en temps réel
    return await this.getAvailableBalance(associationId);
  }
}

module.exports = AssociationBalanceService;