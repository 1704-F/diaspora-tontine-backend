const { Association, AssociationMember, Section, User, Transaction } = require('../../../models');
const { Op } = require('sequelize');

class AssociationController {
  
  // 🏛️ CRÉER ASSOCIATION (avec KYB)
  async createAssociation(req, res) {
    try {
      const {
        name,
        description,
        legalStatus,
        country,
        city,
        registrationNumber,
        memberTypes,
        bureauCentral,
        permissionsMatrix,
        settings
      } = req.body;

      // Vérifier que l'utilisateur n'a pas déjà trop d'associations
      const userAssociations = await AssociationMember.count({
        where: { 
          userId: req.user.id,
          status: 'active'
        }
      });

      const maxAssociations = req.user.role === 'super_admin' ? 100 : 5;
      if (userAssociations >= maxAssociations) {
        return res.status(400).json({
          error: 'Limite d\'associations atteinte',
          code: 'MAX_ASSOCIATIONS_REACHED',
          current: userAssociations,
          max: maxAssociations
        });
      }

      // Configuration par défaut des types membres si non fournie
      const defaultMemberTypes = memberTypes || [
        {
          name: 'membre_simple',
          cotisationAmount: 10.00,
          permissions: ['view_profile', 'participate_events'],
          description: 'Membre standard'
        },
        {
          name: 'membre_actif', 
          cotisationAmount: 15.00,
          permissions: ['view_profile', 'participate_events', 'vote'],
          description: 'Membre avec droit de vote'
        }
      ];

      // Configuration bureau par défaut
      const defaultBureau = bureauCentral || {
        president: { userId: req.user.id, name: req.user.fullName },
        secretaire: { userId: null, name: null },
        tresorier: { userId: null, name: null }
      };

      // Créer l'association
      const association = await Association.create({
        name,
        description,
        legalStatus,
        country,
        city,
        registrationNumber,
        memberTypes: defaultMemberTypes,
        bureauCentral: defaultBureau,
        permissionsMatrix: permissionsMatrix || {},
        settings: settings || {},
        founderId: req.user.id,
        status: 'pending' // En attente validation KYB
      });

      // Ajouter le créateur comme membre fondateur
      await AssociationMember.create({
        userId: req.user.id,
        associationId: association.id,
        memberType: 'fondateur',
        status: 'active',
        roles: ['president'],
        joinDate: new Date(),
        approvedDate: new Date(),
        approvedBy: req.user.id
      });

      // Charger association complète pour retour
      const associationComplete = await Association.findByPk(association.id, {
        include: [
          {
            model: AssociationMember,
            as: 'members',
            include: [{ model: User, as: 'user', attributes: ['id', 'fullName', 'phoneNumber'] }]
          },
          {
            model: Section,
            as: 'sections'
          }
        ]
      });

      res.status(201).json({
        success: true,
        message: 'Association créée avec succès',
        data: {
          association: associationComplete,
          nextSteps: [
            'Télécharger documents KYB',
            'Compléter bureau association',
            'Configurer types membres',
            'Inviter premiers membres'
          ]
        }
      });

    } catch (error) {
      console.error('Erreur création association:', error);
      res.status(500).json({
        error: 'Erreur création association',
        code: 'ASSOCIATION_CREATION_ERROR',
        details: error.message
      });
    }
  }

  // 📋 OBTENIR DÉTAILS ASSOCIATION
  async getAssociation(req, res) {
    try {
      const { id } = req.params;
      const { includeMembers = false, includeFinances = false } = req.query;

      // Vérifier accès à l'association
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId: id,
          status: 'active'
        }
      });

      if (!membership && req.user.role !== 'super_admin') {
        return res.status(403).json({
          error: 'Accès association non autorisé',
          code: 'ASSOCIATION_ACCESS_DENIED'
        });
      }

      // Construire includes selon permissions
      const includes = [
        {
          model: Section,
          as: 'sections',
          attributes: ['id', 'name', 'country', 'city', 'membersCount']
        }
      ];

      // Inclure membres si autorisé
      if (includeMembers === 'true') {
        const canViewMembers = this.checkPermission(membership, 'view_member_list');
        if (canViewMembers || req.user.role === 'super_admin') {
          includes.push({
            model: AssociationMember,
            as: 'members',
            include: [{ 
              model: User, 
              as: 'user', 
              attributes: ['id', 'fullName', 'phoneNumber', 'profilePicture'] 
            }]
          });
        }
      }

      const association = await Association.findByPk(id, { include: includes });

      if (!association) {
        return res.status(404).json({
          error: 'Association introuvable',
          code: 'ASSOCIATION_NOT_FOUND'
        });
      }

      // Masquer informations sensibles selon permissions
      const response = association.toJSON();
      
      if (!this.checkPermission(membership, 'view_finances') && req.user.role !== 'super_admin') {
        delete response.totalBalance;
        delete response.monthlyRevenue;
        delete response.iban;
      }

      res.json({
        success: true,
        data: {
          association: response,
          userMembership: membership,
          userPermissions: await this.getUserPermissions(req.user.id, id)
        }
      });

    } catch (error) {
      console.error('Erreur récupération association:', error);
      res.status(500).json({
        error: 'Erreur récupération association',
        code: 'ASSOCIATION_FETCH_ERROR',
        details: error.message
      });
    }
  }

  // 📝 MODIFIER ASSOCIATION
  async updateAssociation(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;

      // Vérifier permissions modification
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId: id,
          status: 'active'
        }
      });

      const canModify = membership && 
        (['president', 'central_board'].includes(membership.roles?.[0]) || 
         req.user.role === 'super_admin');

      if (!canModify) {
        return res.status(403).json({
          error: 'Permissions insuffisantes pour modifier',
          code: 'INSUFFICIENT_PERMISSIONS',
          required: 'president ou central_board'
        });
      }

      // Validation spéciale pour modification critique
      const criticalFields = ['memberTypes', 'bureauCentral', 'permissionsMatrix'];
      const hasCriticalChanges = Object.keys(updates).some(key => criticalFields.includes(key));

      if (hasCriticalChanges && membership.roles?.[0] !== 'president' && req.user.role !== 'super_admin') {
        return res.status(403).json({
          error: 'Seul le président peut modifier la configuration',
          code: 'PRESIDENT_ONLY_CONFIG'
        });
      }

      // Mise à jour
      const [updatedCount] = await Association.update(updates, {
        where: { id },
        returning: true
      });

      if (updatedCount === 0) {
        return res.status(404).json({
          error: 'Association introuvable',
          code: 'ASSOCIATION_NOT_FOUND'
        });
      }

      // Retourner association mise à jour
      const updatedAssociation = await Association.findByPk(id, {
        include: [
          { model: Section, as: 'sections' },
          { 
            model: AssociationMember, 
            as: 'members',
            include: [{ model: User, as: 'user', attributes: ['id', 'fullName'] }]
          }
        ]
      });

      res.json({
        success: true,
        message: 'Association mise à jour avec succès',
        data: { association: updatedAssociation }
      });

    } catch (error) {
      console.error('Erreur modification association:', error);
      res.status(500).json({
        error: 'Erreur modification association',
        code: 'ASSOCIATION_UPDATE_ERROR',
        details: error.message
      });
    }
  }

  // 📋 LISTER ASSOCIATIONS DE L'UTILISATEUR
  async listUserAssociations(req, res) {
    try {
      const { page = 1, limit = 20, status = 'active' } = req.query;
      const offset = (page - 1) * limit;

      // Récupérer associations de l'utilisateur
      const { rows: memberships, count } = await AssociationMember.findAndCountAll({
        where: {
          userId: req.user.id,
          ...(status !== 'all' && { status })
        },
        include: [
          {
            model: Association,
            as: 'association',
            include: [
              { model: Section, as: 'sections' }
            ]
          },
          {
            model: Section,
            as: 'section'
          }
        ],
        limit: parseInt(limit),
        offset: parseInt(offset),
        order: [['created_at', 'DESC']]
      });

      // Formater réponse avec stats
      const associations = memberships.map(membership => {
        const assoc = membership.association;
        return {
          id: assoc.id,
          name: assoc.name,
          description: assoc.description,
          country: assoc.country,
          status: assoc.status,
          sectionsCount: assoc.sections?.length || 0,
          membersCount: assoc.membersCount || 0,
          userMembership: {
            memberType: membership.memberType,
            roles: membership.roles,
            status: membership.status,
            seniority: membership.getTotalSeniority(),
            section: membership.section
          },
          createdAt: assoc.createdAt
        };
      });

      res.json({
        success: true,
        data: {
          associations,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: count,
            pages: Math.ceil(count / limit)
          }
        }
      });

    } catch (error) {
      console.error('Erreur liste associations:', error);
      res.status(500).json({
        error: 'Erreur récupération associations',
        code: 'ASSOCIATIONS_FETCH_ERROR',
        details: error.message
      });
    }
  }

  // 🗑️ SUPPRIMER ASSOCIATION (soft delete)
  async deleteAssociation(req, res) {
    try {
      const { id } = req.params;

      // Seul le président ou super admin peut supprimer
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId: id,
          status: 'active'
        }
      });

      const canDelete = (membership && membership.roles?.includes('president')) || 
                       req.user.role === 'super_admin';

      if (!canDelete) {
        return res.status(403).json({
          error: 'Seul le président peut supprimer l\'association',
          code: 'PRESIDENT_ONLY_DELETE'
        });
      }

      // Vérifier s'il y a des transactions en cours
      const pendingTransactions = await Transaction.count({
        where: {
          associationId: id,
          status: ['pending', 'processing']
        }
      });

      if (pendingTransactions > 0) {
        return res.status(400).json({
          error: 'Impossible de supprimer: transactions en cours',
          code: 'PENDING_TRANSACTIONS',
          count: pendingTransactions
        });
      }

      // Soft delete
      await Association.update(
        { status: 'deleted' },
        { where: { id } }
      );

      // Désactiver tous les membres
      await AssociationMember.update(
        { status: 'inactive' },
        { where: { associationId: id } }
      );

      res.json({
        success: true,
        message: 'Association supprimée avec succès'
      });

    } catch (error) {
      console.error('Erreur suppression association:', error);
      res.status(500).json({
        error: 'Erreur suppression association',
        code: 'ASSOCIATION_DELETE_ERROR',
        details: error.message
      });
    }
  }

  // 📊 STATISTIQUES ASSOCIATION
  async getAssociationStats(req, res) {
    try {
      const { id } = req.params;

      // Vérifier accès
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId: id,
          status: 'active'
        }
      });

      if (!membership && req.user.role !== 'super_admin') {
        return res.status(403).json({
          error: 'Accès non autorisé',
          code: 'ACCESS_DENIED'
        });
      }

      // Calculer statistiques
      const [
        totalMembers,
        activeMembers,
        monthlyRevenue,
        totalTransactions,
        sectionsCount
      ] = await Promise.all([
        AssociationMember.count({ where: { associationId: id } }),
        AssociationMember.count({ where: { associationId: id, status: 'active' } }),
        Transaction.sum('amount', {
          where: {
            associationId: id,
            type: 'cotisation',
            status: 'completed',
            createdAt: {
              [Op.gte]: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
            }
          }
        }),
        Transaction.count({
          where: {
            associationId: id,
            status: 'completed'
          }
        }),
        Section.count({ where: { associationId: id } })
      ]);

      res.json({
        success: true,
        data: {
          members: {
            total: totalMembers,
            active: activeMembers,
            inactive: totalMembers - activeMembers
          },
          finances: {
            monthlyRevenue: parseFloat(monthlyRevenue || 0),
            totalTransactions
          },
          structure: {
            sectionsCount,
            type: sectionsCount > 0 ? 'multi-sections' : 'simple'
          },
          lastUpdated: new Date()
        }
      });

    } catch (error) {
      console.error('Erreur statistiques association:', error);
      res.status(500).json({
        error: 'Erreur récupération statistiques',
        code: 'STATS_FETCH_ERROR',
        details: error.message
      });
    }
  }

  // 🔧 METTRE À JOUR CONFIGURATION
  async updateConfiguration(req, res) {
    try {
      const { id } = req.params;
      const { memberTypes, bureauCentral, permissionsMatrix, settings } = req.body;

      // Vérifier permissions (président uniquement)
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId: id,
          status: 'active'
        }
      });

      const canModifyConfig = (membership && membership.roles?.includes('president')) || 
                             req.user.role === 'super_admin';

      if (!canModifyConfig) {
        return res.status(403).json({
          error: 'Seul le président peut modifier la configuration',
          code: 'PRESIDENT_ONLY_CONFIG'
        });
      }

      // Préparer mise à jour
      const updates = {};
      if (memberTypes) updates.memberTypes = memberTypes;
      if (bureauCentral) updates.bureauCentral = bureauCentral;
      if (permissionsMatrix) updates.permissionsMatrix = permissionsMatrix;
      if (settings) updates.settings = settings;

      // Mettre à jour
      await Association.update(updates, { where: { id } });

      // Si modification types membres, mettre à jour cotisations existantes
      if (memberTypes) {
        await this.updateMemberCotisations(id, memberTypes);
      }

      res.json({
        success: true,
        message: 'Configuration mise à jour avec succès',
        updated: Object.keys(updates)
      });

    } catch (error) {
      console.error('Erreur mise à jour configuration:', error);
      res.status(500).json({
        error: 'Erreur mise à jour configuration',
        code: 'CONFIG_UPDATE_ERROR',
        details: error.message
      });
    }
  }

  // 🔍 RECHERCHER ASSOCIATIONS PUBLIQUES
  async searchPublicAssociations(req, res) {
    try {
      const { q, country, city, page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      const whereClause = {
        status: 'active',
        isPublic: true
      };

      if (q) {
        whereClause[Op.or] = [
          { name: { [Op.iLike]: `%${q}%` } },
          { description: { [Op.iLike]: `%${q}%` } }
        ];
      }

      if (country) whereClause.country = country;
      if (city) whereClause.city = { [Op.iLike]: `%${city}%` };

      const { rows: associations, count } = await Association.findAndCountAll({
        where: whereClause,
        attributes: ['id', 'name', 'description', 'country', 'city', 'membersCount', 'createdAt'],
        include: [
          {
            model: Section,
            as: 'sections',
            attributes: ['id', 'name', 'country', 'city']
          }
        ],
        limit: parseInt(limit),
        offset: parseInt(offset),
        order: [['membersCount', 'DESC'], ['createdAt', 'DESC']]
      });

      res.json({
        success: true,
        data: {
          associations,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: count,
            pages: Math.ceil(count / limit)
          }
        }
      });

    } catch (error) {
      console.error('Erreur recherche associations:', error);
      res.status(500).json({
        error: 'Erreur recherche associations',
        code: 'SEARCH_ERROR',
        details: error.message
      });
    }
  }

  // 🔐 UTILITAIRES PERMISSIONS
  checkPermission(membership, action) {
    if (!membership || !membership.association) return false;
    
    const permissions = membership.association.permissionsMatrix || {};
    const actionConfig = permissions[action];
    
    if (!actionConfig) return false;
    
    const userRoles = membership.roles || [];
    const allowedRoles = actionConfig.allowed_roles || [];
    
    return userRoles.some(role => allowedRoles.includes(role));
  }

  async getUserPermissions(userId, associationId) {
    try {
      const membership = await AssociationMember.findOne({
        where: { userId, associationId, status: 'active' },
        include: [{ model: Association, as: 'association' }]
      });

      if (!membership) return {};

      const permissionsMatrix = membership.association.permissionsMatrix || {};
      const userRoles = membership.roles || [];
      const userPermissions = {};

      // Calculer permissions effectives
      Object.keys(permissionsMatrix).forEach(action => {
        const config = permissionsMatrix[action];
        const allowedRoles = config.allowed_roles || [];
        userPermissions[action] = userRoles.some(role => allowedRoles.includes(role));
      });

      return userPermissions;
    } catch (error) {
      console.error('Erreur calcul permissions:', error);
      return {};
    }
  }

  // 🔄 Mettre à jour cotisations suite changement types membres
  async updateMemberCotisations(associationId, newMemberTypes) {
    try {
      const members = await AssociationMember.findAll({
        where: { associationId, status: 'active' }
      });

      for (const member of members) {
        const memberTypeConfig = newMemberTypes.find(type => type.name === member.memberType);
        
        if (memberTypeConfig) {
          await member.update({
            cotisationAmount: memberTypeConfig.cotisationAmount
          });
        }
      }
    } catch (error) {
      console.error('Erreur mise à jour cotisations membres:', error);
      throw error;
    }
  }
}

module.exports = new AssociationController();