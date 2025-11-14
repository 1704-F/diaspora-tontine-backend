// src/core/middleware/permissions.js
// Middleware de gestion des permissions pour DiasporaTontine

const { AssociationMember, Association, User } = require('../../models');

/**
 * 🔑 Vérifier si un utilisateur a une permission spécifique
 * RÈGLE PRIORITAIRE: admin_association a TOUJOURS tous les droits
 * 
 * @param {Array} userRoles - Rôles de l'utilisateur dans l'association
 * @param {Object} permissionConfig - Configuration de la permission
 * @param {String} superAdminRole - Rôle super admin de la plateforme
 * @returns {Boolean}
 */
function hasPermission(userRoles, permissionConfig, superAdminRole = null) {
  // 🔥 PRIORITÉ ABSOLUE: admin_association a TOUS les droits
  if (userRoles.includes('admin_association')) {
    return true;
  }
  
  // 🔥 PRIORITÉ 2: super_admin (rôle plateforme) 
  if (superAdminRole === 'super_admin') {
    return true;
  }
  
  // 🔍 Vérification permissions normales
  if (!permissionConfig || !permissionConfig.allowed_roles) {
    return false;
  }
  
  return permissionConfig.allowed_roles.some(role => userRoles.includes(role));
}

/**
 * 🛡️ Middleware pour vérifier l'appartenance à une association
 * Doit être utilisé AVANT les autres middlewares de permissions
 */
const checkAssociationMember = async (req, res, next) => {
  try {
    console.log('🔍 checkAssociationMember - Debug params:');
    console.log('   req.params:', req.params);
    console.log('   req.user:', req.user?.id);
    
    let associationId = req.params.associationId || req.params.id;
    
    if (!associationId && req.body.associationId) {
      associationId = req.body.associationId;
    }
    
    console.log('   associationId extracted:', associationId);
    
    if (!associationId) {
      return res.status(400).json({
        error: 'ID association manquant',
        code: 'MISSING_ASSOCIATION_ID'
      });
    }
    
    const parsedAssociationId = parseInt(associationId);
    if (isNaN(parsedAssociationId) || parsedAssociationId <= 0) {
      return res.status(400).json({
        error: 'ID association invalide',
        code: 'INVALID_ASSOCIATION_ID',
        received: associationId
      });
    }
    
    if (!req.user?.id) {
      return res.status(401).json({
        error: 'Utilisateur non authentifié',
        code: 'NOT_AUTHENTICATED'
      });
    }
    
    const userId = parseInt(req.user.id);
    if (isNaN(userId)) {
      return res.status(401).json({
        error: 'ID utilisateur invalide',
        code: 'INVALID_USER_ID'
      });
    }
    
    console.log('   Recherche membership pour userId:', userId, 'associationId:', parsedAssociationId);
    
    const { AssociationMember, Association, User } = require('../../models');
    
    // ✅ CORRECTION: Ne pas demander workflowRules qui n'existe pas
    const membership = await AssociationMember.findOne({
      where: {
        userId: userId,
        associationId: parsedAssociationId,
        status: 'active'
      },
      include: [
        {
          model: Association,
          as: 'association',
          attributes: ['id', 'name', 'permissionsMatrix'], // ❌ Retirer 'workflowRules'
          required: true
        },
        {
          model: User,
          as: 'user',
          attributes: ['id', 'firstName', 'lastName'],
          required: true
        }
      ]
    });
    
    console.log('   Membership trouvé:', !!membership);
    
    if (!membership) {
      return res.status(403).json({
        error: 'Accès refusé à cette association',
        code: 'ACCESS_DENIED'
      });
    }
    
    req.membership = membership;
    req.associationId = parsedAssociationId;
    req.userRoles = membership.roles || [];
    
    console.log('   ✅ Membership validé. Rôles:', req.userRoles);
    
    next();
    
  } catch (error) {
    console.error('❌ Erreur vérification membre:', error);
    res.status(500).json({
      error: 'Erreur vérification membre',
      code: 'MEMBERSHIP_CHECK_ERROR'
    });
  }
};

/**
 * 🛡️ Middleware générique pour vérifier une permission spécifique
 * @param {String} requiredPermission - Nom de la permission à vérifier
 */
function checkAssociationPermission(requiredPermission) {
  return async (req, res, next) => {
    try {
      const membership = req.membership;
      if (!membership) {
        return res.status(403).json({
          error: 'Membership non trouvé',
          code: 'MEMBERSHIP_REQUIRED'
        });
      }
      
      const userRoles = membership.roles || [];
      const association = membership.association;
      const permissionsMatrix = association.permissionsMatrix || {};
      
      console.log(`🔍 Vérification permission "${requiredPermission}":`);
      console.log('   User roles:', userRoles);
      console.log('   Permission config:', permissionsMatrix[requiredPermission]);
      
      // Vérification avec admin_association prioritaire
      const hasAccess = hasPermission(
        userRoles, 
        permissionsMatrix[requiredPermission],
        req.user?.role
      );
      
      if (!hasAccess) {
        return res.status(403).json({
          error: 'Droits insuffisants pour cette action',
          code: 'INSUFFICIENT_PERMISSIONS',
          required: requiredPermission,
          userRoles: userRoles,
          allowedRoles: permissionsMatrix[requiredPermission]?.allowed_roles || []
        });
      }
      
      console.log('   ✅ Permission accordée');
      next();
      
    } catch (error) {
      console.error('Erreur vérification permission:', error);
      res.status(500).json({
        error: 'Erreur vérification permissions',
        code: 'PERMISSION_CHECK_ERROR'
      });
    }
  };
}

/**
 * 💰 Middleware pour vérifier les droits de validation financière
 */
const checkFinancialValidationRights = () => {
  return async (req, res, next) => {
    try {
      const membership = req.membership;
      if (!membership) {
        return res.status(403).json({
          error: 'Membership requis',
          code: 'MEMBERSHIP_REQUIRED'
        });
      }
      
      const userRoles = membership.roles || [];
      const association = membership.association;
      
      console.log('🔍 Vérification droits validation financière:');
      console.log('   User roles:', userRoles);
      
      // 🔥 RÈGLE PRIORITAIRE: admin_association a TOUS les droits
      if (userRoles.includes('admin_association')) {
        console.log('   ✅ admin_association - Accès total accordé');
        req.canValidateFinances = true;
        return next();
      }
      
      // 🔥 RÈGLE 2: super_admin plateforme
      if (req.user?.role === 'super_admin') {
        console.log('   ✅ super_admin - Accès total accordé');
        req.canValidateFinances = true;
        return next();
      }
      
      // ✅ CORRECTION: Utiliser permissionsMatrix au lieu de workflowRules
      const permissionsMatrix = association.permissionsMatrix || {};
      
      // Chercher permission de validation financière dans permissionsMatrix
      let allowedValidators = ['president', 'tresorier', 'secretaire']; // Par défaut
      
      // Si permission approve_aids existe, l'utiliser
      if (permissionsMatrix.approve_aids) {
        allowedValidators = permissionsMatrix.approve_aids.allowed_roles || allowedValidators;
      }
      
      // Toujours inclure admin_association
      if (!allowedValidators.includes('admin_association')) {
        allowedValidators.unshift('admin_association');
      }
      
      console.log('   Validateurs autorisés:', allowedValidators);
      
      const canValidate = allowedValidators.some(role => userRoles.includes(role));
      
      if (!canValidate) {
        return res.status(403).json({
          error: 'Droits insuffisants pour validation',
          code: 'INSUFFICIENT_VALIDATION_RIGHTS',
          userRoles: userRoles,
          requiredRoles: allowedValidators
        });
      }
      
      console.log('   ✅ Droits validation accordés');
      req.canValidateFinances = true;
      next();
      
    } catch (error) {
      console.error('Erreur vérification droits validation:', error);
      res.status(500).json({
        error: 'Erreur vérification droits validation',
        code: 'VALIDATION_RIGHTS_CHECK_ERROR'
      });
    }
  };
};

/**
 * 📊 Middleware pour vérifier les droits de consultation financière
 */
const checkFinancialViewRights = () => {
  return async (req, res, next) => {
    try {
      const membership = req.membership;
      if (!membership) {
        return res.status(403).json({
          error: 'Membership requis',
          code: 'MEMBERSHIP_REQUIRED'
        });
      }
      
      const userRoles = membership.roles || [];
      const association = membership.association;
      const permissionsMatrix = association.permissionsMatrix || {};
      
      console.log('🔍 Vérification droits vue financière:');
      console.log('   User roles:', userRoles);
      
      // 🔥 PRIORITÉ: admin_association a TOUS les droits
      if (userRoles.includes('admin_association')) {
        console.log('   ✅ admin_association - Accès finances accordé');
        return next();
      }
      
      // 🔥 PRIORITÉ 2: super_admin
      if (req.user?.role === 'super_admin') {
        console.log('   ✅ super_admin - Accès finances accordé');
        return next();
      }
      
      // Vérifier selon configuration permissions
      const financePermissions = permissionsMatrix.view_finances || {
        allowed_roles: ['president', 'tresorier', 'secretaire']
      };
      
      // Toujours inclure admin_association
      if (!financePermissions.allowed_roles.includes('admin_association')) {
        financePermissions.allowed_roles.unshift('admin_association');
      }
      
      console.log('   Rôles autorisés pour finances:', financePermissions.allowed_roles);
      
      const hasFinanceAccess = financePermissions.allowed_roles.some(role => 
        userRoles.includes(role)
      );
      
      if (!hasFinanceAccess) {
        return res.status(403).json({
          error: 'Permissions insuffisantes pour voir les finances',
          code: 'INSUFFICIENT_PERMISSIONS',
          userRoles: userRoles,
          requiredRoles: financePermissions.allowed_roles
        });
      }
      
      console.log('   ✅ Accès finances accordé');
      next();
      
    } catch (error) {
      console.error('Erreur vérification droits finances:', error);
      res.status(500).json({
        error: 'Erreur vérification droits finances',
        code: 'FINANCE_RIGHTS_CHECK_ERROR'
      });
    }
  };
};

/**
 * 👥 Middleware pour vérifier les droits de gestion des membres
 */
const checkMemberManagementRights = () => {
  return checkAssociationPermission('manage_members');
};

/**
 * 📊 Middleware pour vérifier les droits d'export de données
 */
const checkDataExportRights = () => {
  return checkAssociationPermission('export_data');
};

/**
 * 📅 Middleware pour vérifier les droits de gestion des événements
 */
const checkEventManagementRights = () => {
  return checkAssociationPermission('manage_events');
};

/**
 * 🔧 Fonction utilitaire pour s'assurer que admin_association est dans toutes les permissions
 * @param {Object} permissionsMatrix - Matrice des permissions
 * @returns {Object} Matrice mise à jour
 */
function ensureAdminInPermissions(permissionsMatrix) {
  if (!permissionsMatrix || typeof permissionsMatrix !== 'object') {
    return permissionsMatrix;
  }
  
  Object.keys(permissionsMatrix).forEach(permission => {
    const config = permissionsMatrix[permission];
    if (config && config.allowed_roles && Array.isArray(config.allowed_roles)) {
      if (!config.allowed_roles.includes('admin_association')) {
        config.allowed_roles.unshift('admin_association');
      }
    }
  });
  
  return permissionsMatrix;
}

/**
 * 🎯 Middleware combiné pour les routes communes
 */
const requireAssociationAccess = (permission = null) => {
  const middlewares = [checkAssociationMember];
  
  if (permission) {
    middlewares.push(checkAssociationPermission(permission));
  }
  
  return middlewares;
};

/**
 * 💰 Middleware combiné pour les routes financières
 */
const requireFinancialAccess = (type = 'view') => {
  const middlewares = [checkAssociationMember];
  
  if (type === 'validate') {
    middlewares.push(checkFinancialValidationRights());
  } else {
    middlewares.push(checkFinancialViewRights());
  }
  
  return middlewares;
};

module.exports = {
  // Fonctions utilitaires
  hasPermission,
  ensureAdminInPermissions,
  
  // Middlewares de base
  checkAssociationMember,
  checkAssociationPermission,
  
  // Middlewares spécialisés
  checkFinancialValidationRights,
  checkFinancialViewRights,
  checkMemberManagementRights,
  checkDataExportRights,
  checkEventManagementRights,
  
  // Middlewares combinés
  requireAssociationAccess,
  requireFinancialAccess
};