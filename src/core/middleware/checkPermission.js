// src/core/middleware/checkPermission.js
// 🔐 Middleware RBAC moderne pour DiasporaTontine
// Utilise le système de rôles et permissions dynamiques configurables

const { AssociationMember, Association, User } = require('../../models');

/**
 * 🛡️ Middleware pour vérifier l'appartenance à une association
 * Doit être utilisé AVANT checkPermission
 */
const checkAssociationMember = async (req, res, next) => {
  try {
    console.log('🔍 checkAssociationMember - Vérification membership');
    
    // Extraire associationId de différentes sources
    let associationId = req.params.associationId || req.params.id;
    
    if (!associationId && req.body.associationId) {
      associationId = req.body.associationId;
    }
    
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
        code: 'INVALID_ASSOCIATION_ID'
      });
    }
    
    if (!req.user?.id) {
      return res.status(401).json({
        error: 'Utilisateur non authentifié',
        code: 'NOT_AUTHENTICATED'
      });
    }
    
    const userId = parseInt(req.user.id);
    
    // Récupérer membership avec association et rolesConfiguration
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
          attributes: ['id', 'name', 'rolesConfiguration'],
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
    
    if (!membership) {
      return res.status(403).json({
        error: 'Vous n\'êtes pas membre de cette association',
        code: 'NOT_ASSOCIATION_MEMBER'
      });
    }
    
    // Attacher au request pour usage dans les routes
    req.membership = membership;
    req.associationId = parsedAssociationId;
    req.isAdmin = membership.isAdmin;
    
    console.log('   ✅ Membership validé');
    console.log('   - User:', userId);
    console.log('   - Association:', parsedAssociationId);
    console.log('   - isAdmin:', membership.isAdmin);
    console.log('   - assignedRoles:', membership.assignedRoles);
    
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
 * 🔐 Middleware moderne pour vérifier une permission spécifique
 * Utilise le système RBAC dynamique avec rolesConfiguration
 * 
 * @param {String} requiredPermission - ID de la permission requise
 * @returns {Function} Middleware Express
 */
function checkPermission(requiredPermission) {
  return async (req, res, next) => {
    try {
      const membership = req.membership;
      
      if (!membership) {
        return res.status(403).json({
          error: 'Membership non trouvé. Utilisez checkAssociationMember avant.',
          code: 'MEMBERSHIP_REQUIRED'
        });
      }
      
      console.log(`🔍 Vérification permission: "${requiredPermission}"`);
      
      // ✅ RÈGLE 1 : Admin association a TOUTES les permissions
      if (membership.isAdmin) {
        console.log('   ✅ isAdmin=true - Accès automatique accordé');
        req.hasPermission = true;
        req.grantedBy = 'admin';
        return next();
      }
      
      // ✅ RÈGLE 2 : Vérifier customPermissions.granted (override)
      const customGranted = membership.customPermissions?.granted || [];
      if (customGranted.includes(requiredPermission)) {
        console.log('   ✅ Permission dans customPermissions.granted');
        req.hasPermission = true;
        req.grantedBy = 'custom_granted';
        return next();
      }
      
      // ❌ RÈGLE 3 : Vérifier customPermissions.revoked (blocage)
      const customRevoked = membership.customPermissions?.revoked || [];
      if (customRevoked.includes(requiredPermission)) {
        console.log('   ❌ Permission dans customPermissions.revoked');
        return res.status(403).json({
          error: 'Cette permission vous a été retirée',
          code: 'PERMISSION_REVOKED',
          required: requiredPermission
        });
      }
      
      // ✅ RÈGLE 4 : Vérifier dans les rôles attribués
      const assignedRoles = membership.assignedRoles || [];
      const rolesConfig = membership.association?.rolesConfiguration?.roles || [];
      
      console.log('   - assignedRoles:', assignedRoles);
      console.log('   - rolesConfig disponibles:', rolesConfig.length);
      
      let hasPermissionViaRole = false;
      let grantedByRole = null;
      
      for (const roleId of assignedRoles) {
        const role = rolesConfig.find(r => r.id === roleId);
        
        if (role) {
          console.log(`   - Vérification rôle "${role.name}" (${roleId})`);
          console.log(`     Permissions du rôle:`, role.permissions);
          
          if (role.permissions?.includes(requiredPermission)) {
            hasPermissionViaRole = true;
            grantedByRole = role.name;
            break;
          }
        }
      }
      
      if (hasPermissionViaRole) {
        console.log(`   ✅ Permission accordée via rôle: ${grantedByRole}`);
        req.hasPermission = true;
        req.grantedBy = `role:${grantedByRole}`;
        return next();
      }
      
      // ❌ Aucune permission trouvée
      console.log('   ❌ Permission refusée - Aucun accès trouvé');
      
      return res.status(403).json({
        error: 'Permissions insuffisantes pour cette action',
        code: 'INSUFFICIENT_PERMISSIONS',
        required: requiredPermission,
        yourRoles: assignedRoles,
        hint: 'Contactez un administrateur pour obtenir les permissions nécessaires'
      });
      
    } catch (error) {
      console.error('❌ Erreur vérification permission:', error);
      res.status(500).json({
        error: 'Erreur vérification permissions',
        code: 'PERMISSION_CHECK_ERROR',
        details: error.message
      });
    }
  };
}

/**
 * 🔧 Fonction helper pour vérifier une permission sans middleware
 * Utile dans les controllers pour logique conditionnelle
 * 
 * @param {Object} membership - Instance AssociationMember
 * @param {String} permission - Permission à vérifier
 * @returns {Boolean}
 */
function hasPermission(membership, permission) {
  if (!membership) return false;
  
  // Admin a tout
  if (membership.isAdmin) return true;
  
  // Custom granted
  const customGranted = membership.customPermissions?.granted || [];
  if (customGranted.includes(permission)) return true;
  
  // Custom revoked
  const customRevoked = membership.customPermissions?.revoked || [];
  if (customRevoked.includes(permission)) return false;
  
  // Vérifier rôles
  const assignedRoles = membership.assignedRoles || [];
  const rolesConfig = membership.association?.rolesConfiguration?.roles || [];
  
  for (const roleId of assignedRoles) {
    const role = rolesConfig.find(r => r.id === roleId);
    if (role?.permissions?.includes(permission)) {
      return true;
    }
  }
  
  return false;
}

/**
 * 📊 Fonction helper pour récupérer toutes les permissions d'un membre
 * 
 * @param {Object} membership - Instance AssociationMember
 * @returns {Array<String>} Liste des IDs de permissions
 */
function getEffectivePermissions(membership) {
  if (!membership) return [];
  
  // Admin a toutes les permissions disponibles
  if (membership.isAdmin) {
    const availablePermissions = membership.association?.rolesConfiguration?.availablePermissions || [];
    return availablePermissions.map(p => p.id);
  }
  
  const permissions = new Set();
  
  // Permissions des rôles
  const assignedRoles = membership.assignedRoles || [];
  const rolesConfig = membership.association?.rolesConfiguration?.roles || [];
  
  for (const roleId of assignedRoles) {
    const role = rolesConfig.find(r => r.id === roleId);
    if (role?.permissions) {
      role.permissions.forEach(p => permissions.add(p));
    }
  }
  
  // Ajouter custom granted
  const customGranted = membership.customPermissions?.granted || [];
  customGranted.forEach(p => permissions.add(p));
  
  // Retirer custom revoked
  const customRevoked = membership.customPermissions?.revoked || [];
  customRevoked.forEach(p => permissions.delete(p));
  
  return Array.from(permissions);
}

/**
 * 🎯 Middleware combiné pour les routes communes
 * Vérifie membership + permission en une seule chaîne
 * 
 * @param {String|null} permission - Permission optionnelle
 * @returns {Array<Function>} Tableau de middlewares
 */
const requireAssociationAccess = (permission = null) => {
  const middlewares = [checkAssociationMember];
  
  if (permission) {
    middlewares.push(checkPermission(permission));
  }
  
  return middlewares;
};

/**
 * 🔄 Middleware de rétrocompatibilité
 * Permet migration douce depuis ancien système
 */
const checkFinancialValidationRights = () => {
  console.warn('⚠️  checkFinancialValidationRights() est déprécié. Utilisez checkPermission("validate_expenses")');
  return checkPermission('validate_expenses');
};

const checkFinancialViewRights = () => {
  console.warn('⚠️  checkFinancialViewRights() est déprécié. Utilisez checkPermission("view_finances")');
  return checkPermission('view_finances');
};

const checkMemberManagementRights = () => {
  console.warn('⚠️  checkMemberManagementRights() est déprécié. Utilisez checkPermission("manage_members")');
  return checkPermission('manage_members');
};

/**
 * 🧪 Fonction de test pour débugger les permissions
 * Usage : await debugPermissions(req.membership)
 */
async function debugPermissions(membership) {
  if (!membership) {
    console.log('❌ Aucun membership fourni');
    return;
  }
  
  console.log('\n🔍 DEBUG PERMISSIONS');
  console.log('═══════════════════════════════════');
  console.log('User ID:', membership.userId);
  console.log('Association ID:', membership.associationId);
  console.log('isAdmin:', membership.isAdmin);
  console.log('assignedRoles:', membership.assignedRoles);
  console.log('customPermissions:', membership.customPermissions);
  
  const effectivePerms = getEffectivePermissions(membership);
  console.log('\n✅ Permissions effectives:');
  effectivePerms.forEach(p => console.log(`  - ${p}`));
  
  console.log('═══════════════════════════════════\n');
}

// Exports
module.exports = {
  // Middlewares principaux (NOUVEAUX)
  checkAssociationMember,
  checkPermission,
  requireAssociationAccess,
  
  // Fonctions helper
  hasPermission,
  getEffectivePermissions,
  debugPermissions,
  
  // Rétrocompatibilité (DÉPRÉCIÉS - à supprimer après migration)
  checkFinancialValidationRights,
  checkFinancialViewRights,
  checkMemberManagementRights
};