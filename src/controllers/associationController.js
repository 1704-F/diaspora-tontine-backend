//src/controllers/associationController.js
const { Association, Section, AssociationMember, User, Transaction } = require('../models');
const { body, validationResult } = require('express-validator');

// Validation rules
const createAssociationValidation = [
  body('name')
    .isLength({ min: 3, max: 100 })
    .withMessage('Nom association requis (3-100 caractères)'),
  body('domiciliationCountry')
    .isLength({ min: 2, max: 2 })
    .withMessage('Code pays requis (2 lettres)'),
  body('legalStatus')
    .isIn(['association_1901', 'asbl', 'nonprofit_501c3', 'other'])
    .withMessage('Statut légal invalide'),
  body('primaryCurrency')
    .isIn(['EUR', 'USD', 'XOF', 'GBP', 'CAD'])
    .withMessage('Devise invalide')
];

// @desc    Créer une nouvelle association
// @route   POST /api/v1/associations
// @access  Private
const createAssociation = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Données invalides',
        errors: errors.array()
      });
    }

    const {
      name,
      description,
      legalStatus,
      domiciliationCountry,
      domiciliationCity,
      headquartersAddress,
      primaryCurrency,
      centralBoard,
      memberTypes,
      accessRights,
      contactInfo,
      isMultiSection
    } = req.body;

    // Créer l'association
    const association = await Association.create({
      name,
      description,
      legalStatus: legalStatus || 'association_1901',
      domiciliationCountry: domiciliationCountry || 'FR',
      domiciliationCity,
      headquartersAddress,
      primaryCurrency: primaryCurrency || 'EUR',
      centralBoard: centralBoard || {},
      memberTypes: memberTypes || {}, // Utilisera les valeurs par défaut
      accessRights: accessRights || {}, // Utilisera les valeurs par défaut
      contactInfo,
      isMultiSection: isMultiSection || false,
      status: 'pending_validation'
    });

    // Créer automatiquement le premier membre (créateur = président)
    await AssociationMember.create({
      userId: req.userId,
      associationId: association.id,
      memberType: 'cdi', // Par défaut
      status: 'active',
      role: 'president',
      joinDate: new Date(),
      validatedAt: new Date(),
      validatedBy: req.userId,
      permissions: {
        canVote: true,
        canViewFinances: true,
        canManageMembers: true,
        canOrganizeEvents: true,
        canApproveAids: true
      }
    });

    // Inclure les relations dans la réponse
    const associationWithDetails = await Association.findByPk(association.id, {
      include: [
        {
          model: AssociationMember,
          as: 'memberships',
          include: [{ model: User, as: 'user' }]
        }
      ]
    });

    res.status(201).json({
      success: true,
      message: 'Association créée avec succès',
      data: {
        association: associationWithDetails
      }
    });

  } catch (error) {
    console.error('Erreur création association:', error);
    
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({
        success: false,
        message: 'Une association avec ce nom existe déjà'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Erreur lors de la création de l\'association'
    });
  }
};

// @desc    Récupérer toutes les associations (public)
// @route   GET /api/v1/associations
// @access  Public
const getAssociations = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      country, 
      status = 'active',
      search 
    } = req.query;

    const offset = (page - 1) * limit;
    
    // Construire les conditions de recherche
    const whereConditions = { status };
    
    if (country) {
      whereConditions.domiciliationCountry = country;
    }
    
    if (search) {
      whereConditions.name = {
        [require('sequelize').Op.iLike]: `%${search}%`
      };
    }

    const { count, rows: associations } = await Association.findAndCountAll({
      where: whereConditions,
      include: [
        {
          model: Section,
          as: 'sections',
          attributes: ['id', 'name', 'country', 'currency']
        }
      ],
      attributes: [
        'id', 'name', 'description', 'domiciliationCountry', 'domiciliationCity',
        'primaryCurrency', 'isMultiSection', 'totalMembers', 'activeMembers',
        'created_at'
      ],
      limit: parseInt(limit),
      offset,
      order: [['created_at', 'DESC']]
    });

    res.status(200).json({
      success: true,
      data: {
        associations,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(count / limit),
          total: count,
          limit: parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error('Erreur récupération associations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des associations'
    });
  }
};

// @desc    Récupérer une association par ID
// @route   GET /api/v1/associations/:id
// @access  Public
const getAssociation = async (req, res) => {
  try {
    const { id } = req.params;
    
    const association = await Association.findByPk(id, {
      include: [
        {
          model: Section,
          as: 'sections',
          include: [
            {
              model: AssociationMember,
              as: 'members',
              attributes: ['id', 'memberType', 'status', 'role'],
              where: { status: 'active' },
              required: false
            }
          ]
        },
        {
          model: AssociationMember,
          as: 'memberships',
          where: { status: 'active' },
          required: false,
          include: [
            {
              model: User,
              as: 'user',
              attributes: ['id', 'firstName', 'lastName', 'phoneNumber']
            }
          ]
        }
      ]
    });

    if (!association) {
      return res.status(404).json({
        success: false,
        message: 'Association non trouvée'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        association
      }
    });

  } catch (error) {
    console.error('Erreur récupération association:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération de l\'association'
    });
  }
};

// @desc    Mettre à jour une association
// @route   PUT /api/v1/associations/:id
// @access  Private (Bureau central)
const updateAssociation = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Vérifier que l'utilisateur est membre du bureau central
    const membership = await AssociationMember.findOne({
      where: {
        userId: req.userId,
        associationId: id,
        status: 'active',
        role: ['president', 'secretary', 'treasurer', 'central_board']
      }
    });

    if (!membership) {
      return res.status(403).json({
        success: false,
        message: 'Seuls les membres du bureau peuvent modifier l\'association'
      });
    }

    const association = await Association.findByPk(id);
    
    if (!association) {
      return res.status(404).json({
        success: false,
        message: 'Association non trouvée'
      });
    }

    const allowedUpdates = [
      'description', 'headquartersAddress', 'contactInfo', 'website',
      'memberTypes', 'accessRights', 'theme', 'centralBoard'
    ];

    const updates = {};
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    await association.update(updates);

    res.status(200).json({
      success: true,
      message: 'Association mise à jour avec succès',
      data: {
        association
      }
    });

  } catch (error) {
    console.error('Erreur mise à jour association:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la mise à jour'
    });
  }
};

// @desc    Rejoindre une association
// @route   POST /api/v1/associations/:id/join
// @access  Private
const joinAssociation = async (req, res) => {
  try {
    const { id } = req.params;
    const { sectionId, memberType, message } = req.body;

    const association = await Association.findByPk(id);
    
    if (!association || association.status !== 'active') {
      return res.status(404).json({
        success: false,
        message: 'Association non trouvée ou inactive'
      });
    }

    // Vérifier si déjà membre
    const existingMembership = await AssociationMember.findOne({
      where: {
        userId: req.userId,
        associationId: id
      }
    });

    if (existingMembership) {
      return res.status(400).json({
        success: false,
        message: 'Vous êtes déjà membre de cette association'
      });
    }

    // Créer la demande d'adhésion
    const membership = await AssociationMember.create({
      userId: req.userId,
      associationId: id,
      sectionId: sectionId || null,
      memberType: memberType || 'cdi',
      status: 'pending',
      joinDate: new Date(),
      notes: message
    });

    // Inclure les détails utilisateur
    const membershipWithUser = await AssociationMember.findByPk(membership.id, {
      include: [
        { model: User, as: 'user' },
        { model: Association, as: 'association' },
        { model: Section, as: 'section' }
      ]
    });

    res.status(201).json({
      success: true,
      message: 'Demande d\'adhésion envoyée avec succès',
      data: {
        membership: membershipWithUser
      }
    });

  } catch (error) {
    console.error('Erreur adhésion association:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'envoi de la demande'
    });
  }
};

// @desc    Valider/Rejeter un membre
// @route   PATCH /api/v1/associations/:id/members/:memberId/validate
// @access  Private (Bureau)
const validateMember = async (req, res) => {
  try {
    const { id, memberId } = req.params;
    const { action, reason } = req.body; // action: 'approve' | 'reject'

    // Vérifier droits bureau
    const adminMembership = await AssociationMember.findOne({
      where: {
        userId: req.userId,
        associationId: id,
        status: 'active',
        role: ['president', 'secretary', 'treasurer', 'central_board']
      }
    });

    if (!adminMembership) {
      return res.status(403).json({
        success: false,
        message: 'Droits insuffisants pour valider les membres'
      });
    }

    const membership = await AssociationMember.findByPk(memberId, {
      include: [{ model: User, as: 'user' }]
    });

    if (!membership || membership.associationId !== parseInt(id)) {
      return res.status(404).json({
        success: false,
        message: 'Membre non trouvé'
      });
    }

    if (action === 'approve') {
      await membership.update({
        status: 'active',
        validatedAt: new Date(),
        validatedBy: req.userId,
        statusReason: reason
      });

      res.status(200).json({
        success: true,
        message: 'Membre approuvé avec succès',
        data: { membership }
      });

    } else if (action === 'reject') {
      await membership.update({
        status: 'excluded',
        statusReason: reason,
        lastStatusChange: new Date()
      });

      res.status(200).json({
        success: true,
        message: 'Membre rejeté',
        data: { membership }
      });

    } else {
      return res.status(400).json({
        success: false,
        message: 'Action invalide (approve ou reject)'
      });
    }

  } catch (error) {
    console.error('Erreur validation membre:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la validation'
    });
  }
};

// @desc    Récupérer les membres d'une association
// @route   GET /api/v1/associations/:id/members
// @access  Private (Membres)
const getAssociationMembers = async (req, res) => {
  try {
    const { id } = req.params;
    const { status = 'active', page = 1, limit = 20 } = req.query;

    // Vérifier que l'utilisateur est membre
    const requesterMembership = await AssociationMember.findOne({
      where: {
        userId: req.userId,
        associationId: id,
        status: 'active'
      }
    });

    if (!requesterMembership) {
      return res.status(403).json({
        success: false,
        message: 'Vous devez être membre pour voir la liste'
      });
    }

    const offset = (page - 1) * limit;

    const { count, rows: members } = await AssociationMember.findAndCountAll({
      where: {
        associationId: id,
        status
      },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'firstName', 'lastName', 'phoneNumber']
        },
        {
          model: Section,
          as: 'section',
          attributes: ['id', 'name', 'country']
        }
      ],
      limit: parseInt(limit),
      offset,
      order: [['joinDate', 'ASC']]
    });

    res.status(200).json({
      success: true,
      data: {
        members,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(count / limit),
          total: count
        }
      }
    });

  } catch (error) {
    console.error('Erreur récupération membres:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des membres'
    });
  }
};

module.exports = {
  createAssociation,
  getAssociations,
  getAssociation,
  updateAssociation,
  joinAssociation,
  validateMember,
  getAssociationMembers,
  createAssociationValidation
};