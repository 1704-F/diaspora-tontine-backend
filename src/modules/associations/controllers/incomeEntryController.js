// src/modules/associations/controllers/incomeEntryController.js

const { Op } = require('sequelize');
const { 
  IncomeEntry, 
  Association, 
  Section, 
  User, 
  Transaction,
  AssociationMember 
} = require('../../../models');

class IncomeEntryController {

  /**
   * 💰 Créer nouvelle entrée d'argent
   * POST /api/v1/associations/:associationId/income-entries
   */
  async createIncomeEntry(req, res) {
    try {
      const { associationId } = req.params;
      const {
        incomeType,
        incomeSubtype,
        amount,
        grossAmount,
        fees = 0,
        currency = 'EUR',
        sourceType,
        sourceName,
        sourceDetails,
        isAnonymous = false,
        title,
        description,
        purpose,
        receivedDate,
        paymentMethod,
        manualReference,
        bankDetails,
        designatedFor,
        restrictedUse = false,
        usageRestrictions,
        publiclyVisible = false,
        thanksRequired = false,
        tags,
        sectionId
      } = req.body;

      console.log(`💰 Création entrée d'argent - Association ${associationId}`);
      console.log(`   Montant: ${amount}€, Type: ${incomeType}`);

      // 🔍 Vérifications préliminaires
      const parsedAssociationId = parseInt(associationId);
      if (isNaN(parsedAssociationId)) {
        return res.status(400).json({
          error: 'ID association invalide',
          code: 'INVALID_ASSOCIATION_ID'
        });
      }

      // Vérifier que l'association existe
      const association = await Association.findByPk(parsedAssociationId);
      if (!association) {
        return res.status(404).json({
          error: 'Association non trouvée',
          code: 'ASSOCIATION_NOT_FOUND'
        });
      }

      // Vérifier membership et permissions
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId: parsedAssociationId,
          status: 'active'
        }
      });

      if (!membership) {
        return res.status(403).json({
          error: 'Accès refusé à cette association',
          code: 'ACCESS_DENIED'
        });
      }

      // Vérifier permissions d'enregistrement
      const userRoles = membership.roles || [];
      const canRegisterIncome = 
        userRoles.includes('admin_association') ||
        userRoles.includes('president') ||
        userRoles.includes('tresorier') ||
        userRoles.includes('secretaire') ||
        req.user.role === 'super_admin';

      if (!canRegisterIncome) {
        return res.status(403).json({
          error: 'Permissions insuffisantes pour enregistrer des entrées d\'argent',
          code: 'INSUFFICIENT_PERMISSIONS',
          requiredRoles: ['admin_association', 'president', 'tresorier', 'secretaire']
        });
      }

      // Vérifier que le type d'entrée est configuré
      const incomeTypes = association.incomeTypes || {};
      if (!incomeTypes[incomeType]) {
        return res.status(400).json({
          error: 'Type d\'entrée non configuré pour cette association',
          code: 'INCOME_TYPE_NOT_CONFIGURED',
          availableTypes: Object.keys(incomeTypes)
        });
      }

      // Vérifier section si spécifiée
      if (sectionId) {
        const section = await Section.findOne({
          where: { id: sectionId, associationId: parsedAssociationId }
        });
        if (!section) {
          return res.status(400).json({
            error: 'Section non trouvée',
            code: 'SECTION_NOT_FOUND'
          });
        }
      }

      // Calculer montant net
      const netAmount = parseFloat(amount) - parseFloat(fees);
      if (netAmount <= 0) {
        return res.status(400).json({
          error: 'Le montant net doit être positif',
          code: 'INVALID_NET_AMOUNT'
        });
      }

      // Créer l'entrée d'argent
      const incomeEntry = await IncomeEntry.create({
        associationId: parsedAssociationId,
        sectionId: sectionId || null,
        registeredBy: req.user.id,
        incomeType,
        incomeSubtype,
        amount: parseFloat(amount),
        grossAmount: grossAmount ? parseFloat(grossAmount) : parseFloat(amount),
        netAmount,
        fees: parseFloat(fees),
        currency,
        sourceType,
        sourceName: isAnonymous ? null : sourceName,
        sourceDetails: isAnonymous ? null : sourceDetails,
        isAnonymous,
        title,
        description,
        purpose,
        receivedDate: new Date(receivedDate),
        paymentMethod,
        manualReference,
        bankDetails,
        designatedFor,
        restrictedUse,
        usageRestrictions,
        publiclyVisible,
        thanksRequired,
        tags,
        status: 'pending', // Toujours en attente de validation
        metadata: {
          createdBy: req.user.id,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        }
      });

      // Inclure les relations pour la réponse
      const incomeEntryComplete = await IncomeEntry.findByPk(incomeEntry.id, {
        include: [
          {
            model: User,
            as: 'registeredByUser',
            attributes: ['id', 'firstName', 'lastName']
          },
          {
            model: Section,
            as: 'section',
            attributes: ['id', 'name']
          }
        ]
      });

      console.log(`✅ Entrée d'argent créée: ${incomeEntry.id}`);

      res.status(201).json({
        success: true,
        message: 'Entrée d\'argent créée avec succès',
        data: {
          incomeEntry: incomeEntryComplete,
          nextSteps: [
            'Attendre validation du bureau',
            'Télécharger justificatifs si nécessaire',
            'Génération reçu fiscal après validation'
          ]
        }
      });

    } catch (error) {
      console.error('Erreur création entrée d\'argent:', error);
      res.status(500).json({
        error: 'Erreur lors de la création de l\'entrée d\'argent',
        code: 'INCOME_ENTRY_CREATION_ERROR',
        details: error.message
      });
    }
  }

  /**
   * 📋 Lister les entrées d'argent
   * GET /api/v1/associations/:associationId/income-entries
   */
  async getIncomeEntries(req, res) {
    try {
      const { associationId } = req.params;
      const {
        page = 1,
        limit = 20,
        status = 'all',
        incomeType = 'all',
        sourceType = 'all',
        dateFrom,
        dateTo,
        minAmount,
        maxAmount,
        search
      } = req.query;

      const parsedAssociationId = parseInt(associationId);
      
      // Vérifier membership
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId: parsedAssociationId,
          status: 'active'
        }
      });

      if (!membership) {
        return res.status(403).json({
          error: 'Accès refusé à cette association',
          code: 'ACCESS_DENIED'
        });
      }

      // Vérifier permissions de lecture
      const userRoles = membership.roles || [];
      const canViewIncome = 
        userRoles.includes('admin_association') ||
        userRoles.includes('president') ||
        userRoles.includes('tresorier') ||
        userRoles.includes('secretaire') ||
        req.user.role === 'super_admin';

      if (!canViewIncome) {
        return res.status(403).json({
          error: 'Permissions insuffisantes pour voir les entrées d\'argent',
          code: 'INSUFFICIENT_PERMISSIONS'
        });
      }

      // Construire les filtres
      let whereClause = { associationId: parsedAssociationId };

      if (status !== 'all') {
        whereClause.status = status;
      }

      if (incomeType !== 'all') {
        whereClause.incomeType = incomeType;
      }

      if (sourceType !== 'all') {
        whereClause.sourceType = sourceType;
      }

      if (dateFrom && dateTo) {
        whereClause.receivedDate = {
          [Op.between]: [new Date(dateFrom), new Date(dateTo)]
        };
      }

      if (minAmount || maxAmount) {
        whereClause.amount = {};
        if (minAmount) whereClause.amount[Op.gte] = parseFloat(minAmount);
        if (maxAmount) whereClause.amount[Op.lte] = parseFloat(maxAmount);
      }

      if (search) {
        whereClause[Op.or] = [
          { title: { [Op.iLike]: `%${search}%` } },
          { description: { [Op.iLike]: `%${search}%` } },
          { sourceName: { [Op.iLike]: `%${search}%` } }
        ];
      }

      // Pagination
      const offset = (parseInt(page) - 1) * parseInt(limit);

      // Récupérer les entrées
      const { rows: incomeEntries, count } = await IncomeEntry.findAndCountAll({
        where: whereClause,
        include: [
          {
            model: User,
            as: 'registeredByUser',
            attributes: ['id', 'firstName', 'lastName']
          },
          {
            model: User,
            as: 'validatedByUser',
            attributes: ['id', 'firstName', 'lastName']
          },
          {
            model: Section,
            as: 'section',
            attributes: ['id', 'name']
          },
          {
            model: Transaction,
            as: 'transaction',
            attributes: ['id', 'status', 'pspTransactionId']
          }
        ],
        limit: parseInt(limit),
        offset: offset,
        order: [['receivedDate', 'DESC']]
      });

      // Calculer statistiques
      const stats = await this.getIncomeStatistics(parsedAssociationId, whereClause);

      res.status(200).json({
        success: true,
        data: {
          incomeEntries,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(count / parseInt(limit)),
            totalItems: count,
            itemsPerPage: parseInt(limit)
          },
          statistics: stats,
          filters: {
            status, incomeType, sourceType, dateFrom, dateTo, minAmount, maxAmount, search
          }
        }
      });

    } catch (error) {
      console.error('Erreur récupération entrées d\'argent:', error);
      res.status(500).json({
        error: 'Erreur lors de la récupération des entrées d\'argent',
        code: 'INCOME_ENTRIES_FETCH_ERROR'
      });
    }
  }

  /**
   * 🔍 Détails d'une entrée d'argent
   * GET /api/v1/associations/:associationId/income-entries/:entryId
   */
  async getIncomeEntryDetails(req, res) {
    try {
      const { associationId, entryId } = req.params;

      const incomeEntry = await IncomeEntry.findOne({
        where: {
          id: parseInt(entryId),
          associationId: parseInt(associationId)
        },
        include: [
          {
            model: Association,
            as: 'association',
            attributes: ['id', 'name']
          },
          {
            model: User,
            as: 'registeredByUser',
            attributes: ['id', 'firstName', 'lastName']
          },
          {
            model: User,
            as: 'validatedByUser',
            attributes: ['id', 'firstName', 'lastName']
          },
          {
            model: Section,
            as: 'section',
            attributes: ['id', 'name']
          },
          {
            model: Transaction,
            as: 'transaction',
            attributes: ['id', 'status', 'pspTransactionId', 'createdAt']
          }
        ]
      });

      if (!incomeEntry) {
        return res.status(404).json({
          error: 'Entrée d\'argent non trouvée',
          code: 'INCOME_ENTRY_NOT_FOUND'
        });
      }

      // Vérifier permissions
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId: parseInt(associationId),
          status: 'active'
        }
      });

      if (!membership) {
        return res.status(403).json({
          error: 'Accès refusé',
          code: 'ACCESS_DENIED'
        });
      }

      res.status(200).json({
        success: true,
        data: { incomeEntry }
      });

    } catch (error) {
      console.error('Erreur récupération détails entrée:', error);
      res.status(500).json({
        error: 'Erreur lors de la récupération des détails',
        code: 'INCOME_ENTRY_DETAILS_ERROR'
      });
    }
  }

  /**
   * ✅ Valider une entrée d'argent
   * POST /api/v1/associations/:associationId/income-entries/:entryId/validate
   */
  async validateIncomeEntry(req, res) {
    try {
      const { associationId, entryId } = req.params;
      const { validationNote } = req.body;

      const incomeEntry = await IncomeEntry.findOne({
        where: {
          id: parseInt(entryId),
          associationId: parseInt(associationId),
          status: 'pending'
        }
      });

      if (!incomeEntry) {
        return res.status(404).json({
          error: 'Entrée d\'argent non trouvée ou déjà traitée',
          code: 'INCOME_ENTRY_NOT_FOUND'
        });
      }

      // Vérifier permissions de validation
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId: parseInt(associationId),
          status: 'active'
        }
      });

      const userRoles = membership?.roles || [];
      const canValidate = 
        userRoles.includes('admin_association') ||
        userRoles.includes('president') ||
        userRoles.includes('tresorier') ||
        req.user.role === 'super_admin';

      if (!canValidate) {
        return res.status(403).json({
          error: 'Permissions insuffisantes pour valider',
          code: 'INSUFFICIENT_VALIDATION_RIGHTS'
        });
      }

      // Mettre à jour le statut
      await incomeEntry.update({
        status: 'validated',
        validatedBy: req.user.id,
        validatedAt: new Date(),
        internalNotes: validationNote || null
      });

      // Mettre à jour la transaction liée
      if (incomeEntry.transactionId) {
        await Transaction.update(
          { status: 'completed' },
          { where: { id: incomeEntry.transactionId } }
        );
      }

      console.log(`✅ Entrée d'argent validée: ${entryId} par ${req.user.id}`);

      res.status(200).json({
        success: true,
        message: 'Entrée d\'argent validée avec succès',
        data: { incomeEntry }
      });

    } catch (error) {
      console.error('Erreur validation entrée:', error);
      res.status(500).json({
        error: 'Erreur lors de la validation',
        code: 'INCOME_ENTRY_VALIDATION_ERROR'
      });
    }
  }

  /**
   * ❌ Rejeter une entrée d'argent
   * POST /api/v1/associations/:associationId/income-entries/:entryId/reject
   */
  async rejectIncomeEntry(req, res) {
    try {
      const { associationId, entryId } = req.params;
      const { rejectionReason } = req.body;

      if (!rejectionReason || rejectionReason.trim().length < 10) {
        return res.status(400).json({
          error: 'Motif de refus requis (minimum 10 caractères)',
          code: 'REJECTION_REASON_REQUIRED'
        });
      }

      const incomeEntry = await IncomeEntry.findOne({
        where: {
          id: parseInt(entryId),
          associationId: parseInt(associationId),
          status: 'pending'
        }
      });

      if (!incomeEntry) {
        return res.status(404).json({
          error: 'Entrée d\'argent non trouvée ou déjà traitée',
          code: 'INCOME_ENTRY_NOT_FOUND'
        });
      }

      // Vérifier permissions
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId: parseInt(associationId),
          status: 'active'
        }
      });

      const userRoles = membership?.roles || [];
      const canReject = 
        userRoles.includes('admin_association') ||
        userRoles.includes('president') ||
        userRoles.includes('tresorier') ||
        req.user.role === 'super_admin';

      if (!canReject) {
        return res.status(403).json({
          error: 'Permissions insuffisantes pour rejeter',
          code: 'INSUFFICIENT_VALIDATION_RIGHTS'
        });
      }

      // Mettre à jour le statut
      await incomeEntry.update({
        status: 'rejected',
        validatedBy: req.user.id,
        validatedAt: new Date(),
        rejectionReason: rejectionReason.trim()
      });

      // Mettre à jour la transaction liée
      if (incomeEntry.transactionId) {
        await Transaction.update(
          { status: 'cancelled' },
          { where: { id: incomeEntry.transactionId } }
        );
      }

      console.log(`❌ Entrée d'argent rejetée: ${entryId} par ${req.user.id}`);

      res.status(200).json({
        success: true,
        message: 'Entrée d\'argent rejetée',
        data: { incomeEntry }
      });

    } catch (error) {
      console.error('Erreur rejet entrée:', error);
      res.status(500).json({
        error: 'Erreur lors du rejet',
        code: 'INCOME_ENTRY_REJECTION_ERROR'
      });
    }
  }

  /**
   * 🧾 Générer reçu fiscal
   * POST /api/v1/associations/:associationId/income-entries/:entryId/generate-receipt
   */
  async generateReceipt(req, res) {
    try {
      const { associationId, entryId } = req.params;

      const incomeEntry = await IncomeEntry.findOne({
        where: {
          id: parseInt(entryId),
          associationId: parseInt(associationId),
          status: 'validated'
        },
        include: [
          {
            model: Association,
            as: 'association',
            attributes: ['id', 'name', 'legalStatus']
          }
        ]
      });

      if (!incomeEntry) {
        return res.status(404).json({
          error: 'Entrée d\'argent non trouvée ou non validée',
          code: 'INCOME_ENTRY_NOT_FOUND'
        });
      }

      // Générer le reçu
      const receiptNumber = await incomeEntry.generateReceipt();

      // TODO: Générer PDF du reçu fiscal
      const receiptPdfUrl = await generateReceiptPdf(incomeEntry);

      res.status(200).json({
        success: true,
        message: 'Reçu fiscal généré',
        data: {
          receiptNumber,
          receiptPdfUrl,
          incomeEntry
        }
      });

    } catch (error) {
      console.error('Erreur génération reçu:', error);
      res.status(500).json({
        error: 'Erreur lors de la génération du reçu',
        code: 'RECEIPT_GENERATION_ERROR'
      });
    }
  }

  /**
   * 📊 Statistiques entrées d'argent
   */
  async getIncomeStatistics(associationId, whereClause = {}) {
    try {
      whereClause.associationId = associationId;

      // Total par statut
      const byStatus = await IncomeEntry.findAll({
        where: whereClause,
        attributes: [
          'status',
          [IncomeEntry.sequelize.fn('COUNT', IncomeEntry.sequelize.col('id')), 'count'],
          [IncomeEntry.sequelize.fn('SUM', IncomeEntry.sequelize.col('amount')), 'total']
        ],
        group: ['status'],
        raw: true
      });

      // Total par type
      const byType = await IncomeEntry.findAll({
        where: whereClause,
        attributes: [
          'incomeType',
          [IncomeEntry.sequelize.fn('COUNT', IncomeEntry.sequelize.col('id')), 'count'],
          [IncomeEntry.sequelize.fn('SUM', IncomeEntry.sequelize.col('amount')), 'total']
        ],
        group: ['incomeType'],
        raw: true
      });

      // Total par source
      const bySource = await IncomeEntry.findAll({
        where: whereClause,
        attributes: [
          'sourceType',
          [IncomeEntry.sequelize.fn('COUNT', IncomeEntry.sequelize.col('id')), 'count'],
          [IncomeEntry.sequelize.fn('SUM', IncomeEntry.sequelize.col('amount')), 'total']
        ],
        group: ['sourceType'],
        raw: true
      });

      return {
        byStatus: byStatus.map(item => ({
          status: item.status,
          count: parseInt(item.count),
          total: parseFloat(item.total || 0)
        })),
        byType: byType.map(item => ({
          type: item.incomeType,
          count: parseInt(item.count),
          total: parseFloat(item.total || 0)
        })),
        bySource: bySource.map(item => ({
          source: item.sourceType,
          count: parseInt(item.count),
          total: parseFloat(item.total || 0)
        }))
      };

    } catch (error) {
      console.error('Erreur calcul statistiques:', error);
      return { byStatus: [], byType: [], bySource: [] };
    }
  }

  /**
 * ✏️ Modifier une entrée d'argent (avant validation)
 * PUT /api/v1/associations/:associationId/income-entries/:entryId
 */
async updateIncomeEntry(req, res) {
  try {
    const { associationId, entryId } = req.params;
    const {
      incomeType,
      incomeSubtype,
      amount,
      grossAmount,
      fees,
      currency,
      sourceType,
      sourceName,
      sourceDetails,
      isAnonymous,
      title,
      description,
      purpose,
      receivedDate,
      paymentMethod,
      manualReference,
      bankDetails,
      designatedFor,
      restrictedUse,
      usageRestrictions,
      publiclyVisible,
      thanksRequired,
      tags
    } = req.body;

    console.log(`✏️ Modification entrée d'argent ${entryId}`);

    // Vérifier que l'entrée existe et peut être modifiée
    const incomeEntry = await IncomeEntry.findOne({
      where: {
        id: parseInt(entryId),
        associationId: parseInt(associationId),
        status: 'pending' // Seules les entrées en attente peuvent être modifiées
      }
    });

    if (!incomeEntry) {
      return res.status(404).json({
        error: 'Entrée d\'argent non trouvée ou non modifiable',
        code: 'INCOME_ENTRY_NOT_FOUND'
      });
    }

    // Vérifier permissions (fait par middleware)
    const membership = req.membership;
    const userRoles = membership.roles || [];

    // Seul le créateur ou admin peut modifier
    const canModify = 
      incomeEntry.registeredBy === req.user.id ||
      userRoles.includes('admin_association') ||
      userRoles.includes('president') ||
      req.user.role === 'super_admin';

    if (!canModify) {
      return res.status(403).json({
        error: 'Permissions insuffisantes pour modifier cette entrée',
        code: 'INSUFFICIENT_MODIFY_RIGHTS'
      });
    }

    // Préparer les données de mise à jour
    const updateData = {};
    
    if (incomeType !== undefined) updateData.incomeType = incomeType;
    if (incomeSubtype !== undefined) updateData.incomeSubtype = incomeSubtype;
    if (amount !== undefined) {
      updateData.amount = parseFloat(amount);
      updateData.netAmount = parseFloat(amount) - parseFloat(fees || incomeEntry.fees || 0);
    }
    if (grossAmount !== undefined) updateData.grossAmount = parseFloat(grossAmount);
    if (fees !== undefined) {
      updateData.fees = parseFloat(fees);
      updateData.netAmount = parseFloat(amount || incomeEntry.amount) - parseFloat(fees);
    }
    if (currency !== undefined) updateData.currency = currency;
    if (sourceType !== undefined) updateData.sourceType = sourceType;
    if (sourceName !== undefined) updateData.sourceName = isAnonymous ? null : sourceName;
    if (sourceDetails !== undefined) updateData.sourceDetails = isAnonymous ? null : sourceDetails;
    if (isAnonymous !== undefined) updateData.isAnonymous = isAnonymous;
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (purpose !== undefined) updateData.purpose = purpose;
    if (receivedDate !== undefined) updateData.receivedDate = new Date(receivedDate);
    if (paymentMethod !== undefined) updateData.paymentMethod = paymentMethod;
    if (manualReference !== undefined) updateData.manualReference = manualReference;
    if (bankDetails !== undefined) updateData.bankDetails = bankDetails;
    if (designatedFor !== undefined) updateData.designatedFor = designatedFor;
    if (restrictedUse !== undefined) updateData.restrictedUse = restrictedUse;
    if (usageRestrictions !== undefined) updateData.usageRestrictions = usageRestrictions;
    if (publiclyVisible !== undefined) updateData.publiclyVisible = publiclyVisible;
    if (thanksRequired !== undefined) updateData.thanksRequired = thanksRequired;
    if (tags !== undefined) updateData.tags = tags;

    // Mettre à jour
    await incomeEntry.update(updateData, {
      userId: req.user.id // Pour audit trail
    });

    // Récupérer l'entrée mise à jour avec relations
    const updatedEntry = await IncomeEntry.findByPk(incomeEntry.id, {
      include: [
        {
          model: User,
          as: 'registeredByUser',
          attributes: ['id', 'firstName', 'lastName']
        },
        {
          model: Section,
          as: 'section',
          attributes: ['id', 'name']
        }
      ]
    });

    console.log(`✅ Entrée d'argent ${entryId} modifiée avec succès`);

    res.status(200).json({
      success: true,
      message: 'Entrée d\'argent modifiée avec succès',
      data: { incomeEntry: updatedEntry }
    });

  } catch (error) {
    console.error('Erreur modification entrée:', error);
    res.status(500).json({
      error: 'Erreur lors de la modification',
      code: 'INCOME_ENTRY_UPDATE_ERROR',
      details: error.message
    });
  }
}

/**
 * ❌ Annuler une entrée d'argent
 * DELETE /api/v1/associations/:associationId/income-entries/:entryId
 */
async cancelIncomeEntry(req, res) {
  try {
    const { associationId, entryId } = req.params;

    const incomeEntry = await IncomeEntry.findOne({
      where: {
        id: parseInt(entryId),
        associationId: parseInt(associationId),
        status: ['pending', 'rejected'] // Seules ces entrées peuvent être annulées
      }
    });

    if (!incomeEntry) {
      return res.status(404).json({
        error: 'Entrée d\'argent non trouvée ou non annulable',
        code: 'INCOME_ENTRY_NOT_FOUND'
      });
    }

    // Vérifier permissions
    const membership = req.membership;
    const userRoles = membership.roles || [];

    const canCancel = 
      incomeEntry.registeredBy === req.user.id ||
      userRoles.includes('admin_association') ||
      userRoles.includes('president') ||
      req.user.role === 'super_admin';

    if (!canCancel) {
      return res.status(403).json({
        error: 'Permissions insuffisantes pour annuler cette entrée',
        code: 'INSUFFICIENT_CANCEL_RIGHTS'
      });
    }

    // Annuler l'entrée
    await incomeEntry.update({
      status: 'cancelled',
      internalNotes: `Annulée par ${req.user.firstName} ${req.user.lastName} le ${new Date().toISOString()}`
    });

    // Annuler la transaction liée si elle existe
    if (incomeEntry.transactionId) {
      await Transaction.update(
        { status: 'cancelled' },
        { where: { id: incomeEntry.transactionId } }
      );
    }

    console.log(`❌ Entrée d'argent ${entryId} annulée`);

    res.status(200).json({
      success: true,
      message: 'Entrée d\'argent annulée avec succès',
      data: { incomeEntry }
    });

  } catch (error) {
    console.error('Erreur annulation entrée:', error);
    res.status(500).json({
      error: 'Erreur lors de l\'annulation',
      code: 'INCOME_ENTRY_CANCEL_ERROR'
    });
  }
}

/**
 * 🔄 Resoumettre une entrée après rejet
 * POST /api/v1/associations/:associationId/income-entries/:entryId/resubmit
 */
async resubmitIncomeEntry(req, res) {
  try {
    const { associationId, entryId } = req.params;
    const { updatedReason } = req.body;

    const incomeEntry = await IncomeEntry.findOne({
      where: {
        id: parseInt(entryId),
        associationId: parseInt(associationId),
        status: 'rejected'
      }
    });

    if (!incomeEntry) {
      return res.status(404).json({
        error: 'Entrée d\'argent non trouvée ou non rejetée',
        code: 'INCOME_ENTRY_NOT_FOUND'
      });
    }

    // Vérifier permissions
    const membership = req.membership;
    const userRoles = membership.roles || [];

    const canResubmit = 
      incomeEntry.registeredBy === req.user.id ||
      userRoles.includes('admin_association') ||
      userRoles.includes('president') ||
      req.user.role === 'super_admin';

    if (!canResubmit) {
      return res.status(403).json({
        error: 'Permissions insuffisantes pour resoumettre',
        code: 'INSUFFICIENT_RESUBMIT_RIGHTS'
      });
    }

    // Remettre en attente
    await incomeEntry.update({
      status: 'pending',
      rejectionReason: null,
      validatedBy: null,
      validatedAt: null,
      internalNotes: updatedReason ? 
        `Resoumise: ${updatedReason}` : 
        'Resoumise après corrections'
    });

    // Réactiver la transaction liée
    if (incomeEntry.transactionId) {
      await Transaction.update(
        { status: 'pending' },
        { where: { id: incomeEntry.transactionId } }
      );
    }

    console.log(`🔄 Entrée d'argent ${entryId} resoumise`);

    res.status(200).json({
      success: true,
      message: 'Entrée d\'argent resoumise avec succès',
      data: { incomeEntry }
    });

  } catch (error) {
    console.error('Erreur resoumission entrée:', error);
    res.status(500).json({
      error: 'Erreur lors de la resoumission',
      code: 'INCOME_ENTRY_RESUBMIT_ERROR'
    });
  }
}

/**
 * 📎 Upload document justificatif
 * POST /api/v1/associations/:associationId/income-entries/:entryId/documents
 */
async uploadDocument(req, res) {
  try {
    const { associationId, entryId } = req.params;
    
    // TODO: Intégrer avec Cloudinary upload middleware
    // const uploadedFile = req.file;
    
    const incomeEntry = await IncomeEntry.findOne({
      where: {
        id: parseInt(entryId),
        associationId: parseInt(associationId)
      }
    });

    if (!incomeEntry) {
      return res.status(404).json({
        error: 'Entrée d\'argent non trouvée',
        code: 'INCOME_ENTRY_NOT_FOUND'
      });
    }

    // Simulation upload (à remplacer par vraie logique Cloudinary)
    const simulatedUpload = {
      type: req.body.documentType || 'justificatif',
      url: `https://cdn.diasporatontine.com/income-docs/${entryId}_${Date.now()}.pdf`,
      name: req.body.documentName || 'document.pdf',
      uploadedAt: new Date().toISOString(),
      uploadedBy: req.user.id
    };

    // Ajouter aux documents existants
    const currentDocs = incomeEntry.documents || [];
    currentDocs.push(simulatedUpload);

    await incomeEntry.update({
      documents: currentDocs
    });

    console.log(`📎 Document uploadé pour entrée ${entryId}`);

    res.status(200).json({
      success: true,
      message: 'Document uploadé avec succès',
      data: {
        document: simulatedUpload,
        totalDocuments: currentDocs.length
      }
    });

  } catch (error) {
    console.error('Erreur upload document:', error);
    res.status(500).json({
      error: 'Erreur lors de l\'upload',
      code: 'DOCUMENT_UPLOAD_ERROR'
    });
  }
}

/**
 * 📊 Export données entrées d'argent
 * GET /api/v1/associations/:associationId/income-entries/export
 */
async exportIncomeData(req, res) {
  try {
    const { associationId } = req.params;
    const { 
      format = 'excel', 
      dateFrom, 
      dateTo, 
      includeDetails = true 
    } = req.query;

    // Construire filtres
    let whereClause = { 
      associationId: parseInt(associationId),
      status: 'validated' // Seulement les entrées validées
    };

    if (dateFrom && dateTo) {
      whereClause.receivedDate = {
        [Op.between]: [new Date(dateFrom), new Date(dateTo)]
      };
    }

    // Récupérer les données
    const incomeEntries = await IncomeEntry.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'registeredByUser',
          attributes: ['firstName', 'lastName']
        },
        {
          model: User,
          as: 'validatedByUser',
          attributes: ['firstName', 'lastName']
        },
        {
          model: Section,
          as: 'section',
          attributes: ['name']
        }
      ],
      order: [['receivedDate', 'DESC']]
    });

    // Formater données pour export
    const exportData = incomeEntries.map(entry => ({
      Date: entry.receivedDate.toISOString().split('T')[0],
      Titre: entry.title,
      Type: entry.incomeType,
      'Type Source': entry.sourceType,
      'Nom Source': entry.isAnonymous ? 'Anonyme' : entry.sourceName,
      'Montant Brut': entry.grossAmount || entry.amount,
      'Frais': entry.fees,
      'Montant Net': entry.netAmount,
      'Devise': entry.currency,
      'Méthode': entry.paymentMethod,
      'Section': entry.section?.name || 'Centrale',
      'Enregistré par': `${entry.registeredByUser.firstName} ${entry.registeredByUser.lastName}`,
      'Validé par': entry.validatedByUser ? `${entry.validatedByUser.firstName} ${entry.validatedByUser.lastName}` : '',
      'Date validation': entry.validatedAt ? entry.validatedAt.toISOString().split('T')[0] : '',
      ...(includeDetails && {
        'Description': entry.description,
        'Objectif': entry.purpose,
        'Référence': entry.manualReference,
        'Usage restreint': entry.restrictedUse ? 'Oui' : 'Non'
      })
    }));

    // Générer le fichier selon le format
    let exportResult;
    switch (format) {
      case 'csv':
        exportResult = await generateCSVExport(exportData);
        break;
      case 'excel':
        exportResult = await generateExcelExport(exportData);
        break;
      case 'pdf':
        exportResult = await generatePDFExport(exportData, associationId);
        break;
      default:
        exportResult = await generateExcelExport(exportData);
    }

    res.status(200).json({
      success: true,
      message: 'Export généré avec succès',
      data: {
        downloadUrl: exportResult.url,
        filename: exportResult.filename,
        format: format,
        totalEntries: exportData.length,
        dateRange: { dateFrom, dateTo }
      }
    });

  } catch (error) {
    console.error('Erreur export données:', error);
    res.status(500).json({
      error: 'Erreur lors de l\'export',
      code: 'EXPORT_ERROR'
    });
  }
}

/**
 * ⏳ Entrées en attente de validation
 * GET /api/v1/associations/:associationId/income-entries/pending-validation
 */
async getPendingValidations(req, res) {
  try {
    const { associationId } = req.params;

    // Récupérer entrées en attente
    const pendingEntries = await IncomeEntry.findAll({
      where: {
        associationId: parseInt(associationId),
        status: 'pending'
      },
      include: [
        {
          model: User,
          as: 'registeredByUser',
          attributes: ['id', 'firstName', 'lastName']
        },
        {
          model: Section,
          as: 'section',
          attributes: ['id', 'name']
        }
      ],
      order: [['createdAt', 'ASC']] // Plus anciennes en premier
    });

    // Calculer statistiques
    const stats = {
      total: pendingEntries.length,
      totalAmount: pendingEntries.reduce((sum, entry) => sum + parseFloat(entry.amount), 0),
      byType: {},
      byUrgency: {
        normal: 0,
        urgent: 0 // Entries créées il y a plus de 7 jours
      }
    };

    // Grouper par type
    pendingEntries.forEach(entry => {
      stats.byType[entry.incomeType] = (stats.byType[entry.incomeType] || 0) + 1;
      
      // Vérifier urgence (plus de 7 jours)
      const daysSinceCreation = Math.floor((new Date() - entry.createdAt) / (1000 * 60 * 60 * 24));
      if (daysSinceCreation > 7) {
        stats.byUrgency.urgent++;
      } else {
        stats.byUrgency.normal++;
      }
    });

    res.status(200).json({
      success: true,
      data: {
        pendingEntries,
        statistics: stats
      }
    });

  } catch (error) {
    console.error('Erreur récupération validations en attente:', error);
    res.status(500).json({
      error: 'Erreur lors de la récupération',
      code: 'PENDING_VALIDATIONS_ERROR'
    });
  }
}

/**
 * 🏷️ Lister types d'entrées configurés
 * GET /api/v1/associations/:associationId/income-types
 */
async getIncomeTypes(req, res) {
  try {
    const { associationId } = req.params;

    const association = await Association.findByPk(parseInt(associationId), {
      attributes: ['id', 'name', 'incomeTypes']
    });

    if (!association) {
      return res.status(404).json({
        error: 'Association non trouvée',
        code: 'ASSOCIATION_NOT_FOUND'
      });
    }

    const incomeTypes = association.incomeTypes || {};

    // Enrichir avec statistiques d'utilisation
    const typeStats = await IncomeEntry.findAll({
      where: { associationId: parseInt(associationId) },
      attributes: [
        'incomeType',
        [IncomeEntry.sequelize.fn('COUNT', IncomeEntry.sequelize.col('id')), 'count'],
        [IncomeEntry.sequelize.fn('SUM', IncomeEntry.sequelize.col('amount')), 'totalAmount']
      ],
      group: ['incomeType'],
      raw: true
    });

    // Mapper les stats
    const statsMap = {};
    typeStats.forEach(stat => {
      statsMap[stat.incomeType] = {
        count: parseInt(stat.count),
        totalAmount: parseFloat(stat.totalAmount || 0)
      };
    });

    // Formater la réponse
    const formattedTypes = Object.keys(incomeTypes).map(typeKey => ({
      key: typeKey,
      ...incomeTypes[typeKey],
      statistics: statsMap[typeKey] || { count: 0, totalAmount: 0 }
    }));

    res.status(200).json({
      success: true,
      data: {
        incomeTypes: formattedTypes,
        totalTypes: formattedTypes.length,
        association: {
          id: association.id,
          name: association.name
        }
      }
    });

  } catch (error) {
    console.error('Erreur récupération types entrées:', error);
    res.status(500).json({
      error: 'Erreur lors de la récupération des types',
      code: 'INCOME_TYPES_FETCH_ERROR'
    });
  }
}

/**
 * ➕ Créer nouveau type d'entrée
 * POST /api/v1/associations/:associationId/income-types
 */
async createIncomeType(req, res) {
  try {
    const { associationId } = req.params;
    const {
      typeName,
      typeLabel,
      description,
      defaultSourceType,
      requiresReceipt = false,
      maxAmount,
      requiredDocuments = [],
      allowAnonymous = true
    } = req.body;

    const association = await Association.findByPk(parseInt(associationId));
    if (!association) {
      return res.status(404).json({
        error: 'Association non trouvée',
        code: 'ASSOCIATION_NOT_FOUND'
      });
    }

    // Vérifier permissions admin
    const membership = req.membership;
    const userRoles = membership.roles || [];

    const canCreateType = 
      userRoles.includes('admin_association') ||
      userRoles.includes('president') ||
      req.user.role === 'super_admin';

    if (!canCreateType) {
      return res.status(403).json({
        error: 'Permissions insuffisantes pour créer des types',
        code: 'INSUFFICIENT_CREATE_TYPE_RIGHTS'
      });
    }

    // Récupérer types existants
    const currentTypes = association.incomeTypes || {};

    // Vérifier que le type n'existe pas déjà
    if (currentTypes[typeName]) {
      return res.status(400).json({
        error: 'Type d\'entrée déjà existant',
        code: 'INCOME_TYPE_EXISTS'
      });
    }

    // Créer le nouveau type
    const newType = {
      label: typeLabel,
      description,
      defaultSourceType,
      requiresReceipt,
      maxAmount: maxAmount ? parseFloat(maxAmount) : null,
      requiredDocuments,
      allowAnonymous,
      createdBy: req.user.id,
      createdAt: new Date().toISOString()
    };

    // Ajouter aux types existants
    currentTypes[typeName] = newType;

    // Sauvegarder
    await association.update({
      incomeTypes: currentTypes
    });

    console.log(`➕ Nouveau type d'entrée créé: ${typeName} pour association ${associationId}`);

    res.status(201).json({
      success: true,
      message: 'Type d\'entrée créé avec succès',
      data: {
        typeName,
        typeConfig: newType,
        totalTypes: Object.keys(currentTypes).length
      }
    });

  } catch (error) {
    console.error('Erreur création type entrée:', error);
    res.status(500).json({
      error: 'Erreur lors de la création du type',
      code: 'INCOME_TYPE_CREATION_ERROR'
    });
  }
}

/**
 * 📤 Envoyer remerciements
 * POST /api/v1/associations/:associationId/income-entries/:entryId/send-thanks
 */
async sendThanks(req, res) {
  try {
    const { associationId, entryId } = req.params;
    const { thanksMessage } = req.body;

    const incomeEntry = await IncomeEntry.findOne({
      where: {
        id: parseInt(entryId),
        associationId: parseInt(associationId),
        status: 'validated',
        thanksRequired: true,
        thanksSent: false
      }
    });

    if (!incomeEntry) {
      return res.status(404).json({
        error: 'Entrée non trouvée ou remerciements déjà envoyés',
        code: 'INCOME_ENTRY_NOT_FOUND'
      });
    }

    // TODO: Intégrer avec service d'envoi (email, SMS)
    // await emailService.sendThanks(incomeEntry, thanksMessage);

    // Marquer comme envoyé
    await incomeEntry.update({
      thanksSent: true,
      metadata: {
        ...incomeEntry.metadata,
        thanksMessage,
        thanksSentAt: new Date().toISOString(),
        thanksSentBy: req.user.id
      }
    });

    console.log(`📤 Remerciements envoyés pour entrée ${entryId}`);

    res.status(200).json({
      success: true,
      message: 'Remerciements envoyés avec succès',
      data: { incomeEntry }
    });

  } catch (error) {
    console.error('Erreur envoi remerciements:', error);
    res.status(500).json({
      error: 'Erreur lors de l\'envoi des remerciements',
      code: 'THANKS_SEND_ERROR'
    });
  }
}


}
// 🔧 FONCTIONS UTILITAIRES
async function generateReceiptPdf(incomeEntry) {
  // TODO: Implémenter génération PDF avec Puppeteer
  console.log(`📄 Génération PDF reçu pour entrée ${incomeEntry.id}`);
  return `https://cdn.diasporatontine.com/receipts/${incomeEntry.receiptNumber}.pdf`;
}

// 🔧 FONCTIONS UTILITAIRES EXPORT
async function generateCSVExport(data) {
  // TODO: Implémenter génération CSV
  console.log('📊 Génération export CSV...');
  return {
    url: `https://cdn.diasporatontine.com/exports/income_entries_${Date.now()}.csv`,
    filename: `income_entries_${new Date().toISOString().split('T')[0]}.csv`
  };
}

async function generateExcelExport(data) {
  // TODO: Implémenter génération Excel avec exceljs
  console.log('📊 Génération export Excel...');
  return {
    url: `https://cdn.diasporatontine.com/exports/income_entries_${Date.now()}.xlsx`,
    filename: `income_entries_${new Date().toISOString().split('T')[0]}.xlsx`
  };
}

async function generatePDFExport(data, associationId) {
  // TODO: Implémenter génération PDF avec Puppeteer
  console.log('📊 Génération export PDF...');
  return {
    url: `https://cdn.diasporatontine.com/exports/income_entries_${associationId}_${Date.now()}.pdf`,
    filename: `income_entries_${new Date().toISOString().split('T')[0]}.pdf`
  };
}


module.exports = new IncomeEntryController();