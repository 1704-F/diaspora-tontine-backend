// src/modules/associations/controllers/rolesController.js
// Contrôleur pour gestion des rôles et permissions RBAC

const { Association, AssociationMember, User } = require('../../../models');

class RolesController {
  
  // 📋 LISTER TOUS LES RÔLES D'UNE ASSOCIATION
  async getRoles(req, res) {
    try {
      const { id: associationId } = req.params;
      
      const association = await Association.findByPk(associationId, {
        attributes: ['id', 'name', 'rolesConfiguration']
      });
      
      if (!association) {
        return res.status(404).json({
          error: 'Association introuvable',
          code: 'ASSOCIATION_NOT_FOUND'
        });
      }
      
      const rolesConfig = association.rolesConfiguration || { roles: [], availablePermissions: [] };
      
      // Compter combien de membres ont chaque rôle
      const members = await AssociationMember.findAll({
        where: { associationId, status: 'active' },
        attributes: ['assignedRoles']
      });
      
      const roleUsageCount = {};
      members.forEach(member => {
        const roles = member.assignedRoles || [];
        roles.forEach(roleId => {
          roleUsageCount[roleId] = (roleUsageCount[roleId] || 0) + 1;
        });
      });
      
      // Enrichir les rôles avec le compteur d'utilisation
      const enrichedRoles = rolesConfig.roles.map(role => ({
        ...role,
        membersCount: roleUsageCount[role.id] || 0
      }));
      
      res.json({
        success: true,
        data: {
          roles: enrichedRoles,
          availablePermissions: rolesConfig.availablePermissions,
          totalRoles: enrichedRoles.length,
          totalPermissions: rolesConfig.availablePermissions.length
        }
      });
      
    } catch (error) {
      console.error('Erreur récupération rôles:', error);
      res.status(500).json({
        error: 'Erreur récupération rôles',
        code: 'ROLES_FETCH_ERROR',
        details: error.message
      });
    }
  }
  
  // 🔍 DÉTAILS D'UN RÔLE SPÉCIFIQUE
  async getRoleDetails(req, res) {
    try {
      const { id: associationId, roleId } = req.params;
      
      const association = await Association.findByPk(associationId);
      if (!association) {
        return res.status(404).json({
          error: 'Association introuvable',
          code: 'ASSOCIATION_NOT_FOUND'
        });
      }
      
      const rolesConfig = association.rolesConfiguration || { roles: [] };
      const role = rolesConfig.roles.find(r => r.id === roleId);
      
      if (!role) {
        return res.status(404).json({
          error: 'Rôle introuvable',
          code: 'ROLE_NOT_FOUND'
        });
      }
      
      // Récupérer les membres ayant ce rôle
      const membersWithRole = await AssociationMember.findAll({
        where: {
          associationId,
          status: 'active'
        },
        include: [{
          model: User,
          as: 'user',
          attributes: ['id', 'firstName', 'lastName', 'phoneNumber']
        }]
      });
      
      const filteredMembers = membersWithRole
        .filter(m => (m.assignedRoles || []).includes(roleId))
        .map(m => ({
          id: m.id,
          userId: m.userId,
          name: `${m.user.firstName} ${m.user.lastName}`,
          phoneNumber: m.user.phoneNumber,
          memberType: m.memberType,
          assignedAt: m.updatedAt
        }));
      
      res.json({
        success: true,
        data: {
          role,
          members: filteredMembers,
          membersCount: filteredMembers.length
        }
      });
      
    } catch (error) {
      console.error('Erreur détails rôle:', error);
      res.status(500).json({
        error: 'Erreur récupération détails rôle',
        code: 'ROLE_DETAILS_ERROR',
        details: error.message
      });
    }
  }
  
  // ➕ CRÉER UN NOUVEAU RÔLE
  async createRole(req, res) {
    try {
      const { id: associationId } = req.params;
      const { name, description, permissions, color, icon, isUnique } = req.body;
      
      const association = await Association.findByPk(associationId);
      if (!association) {
        return res.status(404).json({
          error: 'Association introuvable',
          code: 'ASSOCIATION_NOT_FOUND'
        });
      }
      
      const rolesConfig = association.rolesConfiguration || { 
        version: '1.0',
        roles: [], 
        availablePermissions: [] 
      };
      
      // Générer ID unique pour le rôle
      const roleId = `${name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;
      
      // Vérifier que le nom n'existe pas déjà
      const nameExists = rolesConfig.roles.some(r => 
        r.name.toLowerCase() === name.toLowerCase()
      );
      
      if (nameExists) {
        return res.status(400).json({
          error: 'Un rôle avec ce nom existe déjà',
          code: 'ROLE_NAME_EXISTS'
        });
      }
      
      // Valider que les permissions existent
      const validPermissions = rolesConfig.availablePermissions.map(p => p.id);
      const invalidPermissions = permissions.filter(p => !validPermissions.includes(p));
      
      if (invalidPermissions.length > 0) {
        return res.status(400).json({
          error: 'Permissions invalides',
          code: 'INVALID_PERMISSIONS',
          invalid: invalidPermissions
        });
      }
      
      // Créer le nouveau rôle
      const newRole = {
        id: roleId,
        name,
        description: description || '',
        permissions: permissions || [],
        isUnique: isUnique || false,
        isMandatory: false,
        canBeRenamed: true,
        canBeDeleted: true,
        color: color || '#6B7280',
        icon: icon || '👤',
        createdAt: new Date().toISOString(),
        createdBy: req.user.id
      };
      
      rolesConfig.roles.push(newRole);
      
      // Sauvegarder
      association.rolesConfiguration = rolesConfig;
      association.changed('rolesConfiguration', true);
      await association.save();
      
      console.log(`✅ Rôle "${name}" créé par user ${req.user.id} dans association ${associationId}`);
      
      res.status(201).json({
        success: true,
        message: 'Rôle créé avec succès',
        data: { role: newRole }
      });
      
    } catch (error) {
      console.error('Erreur création rôle:', error);
      res.status(500).json({
        error: 'Erreur création rôle',
        code: 'ROLE_CREATE_ERROR',
        details: error.message
      });
    }
  }
  
  // ✏️ MODIFIER UN RÔLE
  async updateRole(req, res) {
    try {
      const { id: associationId, roleId } = req.params;
      const { name, description, permissions, color, icon } = req.body;
      
      const association = await Association.findByPk(associationId);
      if (!association) {
        return res.status(404).json({
          error: 'Association introuvable',
          code: 'ASSOCIATION_NOT_FOUND'
        });
      }
      
      const rolesConfig = association.rolesConfiguration || { roles: [] };
      const roleIndex = rolesConfig.roles.findIndex(r => r.id === roleId);
      
      if (roleIndex === -1) {
        return res.status(404).json({
          error: 'Rôle introuvable',
          code: 'ROLE_NOT_FOUND'
        });
      }
      
      const role = rolesConfig.roles[roleIndex];
      
      // Vérifier si le rôle peut être modifié
      if (role.canBeRenamed === false && name && name !== role.name) {
        return res.status(403).json({
          error: 'Ce rôle ne peut pas être renommé',
          code: 'ROLE_CANNOT_BE_RENAMED'
        });
      }
      
      // Valider permissions si fournies
      if (permissions) {
        const validPermissions = rolesConfig.availablePermissions.map(p => p.id);
        const invalidPermissions = permissions.filter(p => !validPermissions.includes(p));
        
        if (invalidPermissions.length > 0) {
          return res.status(400).json({
            error: 'Permissions invalides',
            code: 'INVALID_PERMISSIONS',
            invalid: invalidPermissions
          });
        }
      }
      
      // Mettre à jour le rôle
      rolesConfig.roles[roleIndex] = {
        ...role,
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(permissions && { permissions }),
        ...(color && { color }),
        ...(icon && { icon }),
        updatedAt: new Date().toISOString(),
        updatedBy: req.user.id
      };
      
      // Sauvegarder
      association.rolesConfiguration = rolesConfig;
      association.changed('rolesConfiguration', true);
      await association.save();
      
      console.log(`✅ Rôle "${roleId}" modifié par user ${req.user.id}`);
      
      res.json({
        success: true,
        message: 'Rôle modifié avec succès',
        data: { role: rolesConfig.roles[roleIndex] }
      });
      
    } catch (error) {
      console.error('Erreur modification rôle:', error);
      res.status(500).json({
        error: 'Erreur modification rôle',
        code: 'ROLE_UPDATE_ERROR',
        details: error.message
      });
    }
  }
  
  // 🗑️ SUPPRIMER UN RÔLE
  async deleteRole(req, res) {
    try {
      const { id: associationId, roleId } = req.params;
      const { force = false } = req.query;
      
      const association = await Association.findByPk(associationId);
      if (!association) {
        return res.status(404).json({
          error: 'Association introuvable',
          code: 'ASSOCIATION_NOT_FOUND'
        });
      }
      
      const rolesConfig = association.rolesConfiguration || { roles: [] };
      const role = rolesConfig.roles.find(r => r.id === roleId);
      
      if (!role) {
        return res.status(404).json({
          error: 'Rôle introuvable',
          code: 'ROLE_NOT_FOUND'
        });
      }
      
      // Vérifier si le rôle peut être supprimé
      if (role.canBeDeleted === false) {
        return res.status(403).json({
          error: 'Ce rôle ne peut pas être supprimé (rôle système)',
          code: 'ROLE_CANNOT_BE_DELETED'
        });
      }
      
      if (role.isMandatory) {
        return res.status(403).json({
          error: 'Ce rôle est obligatoire et ne peut pas être supprimé',
          code: 'ROLE_IS_MANDATORY'
        });
      }
      
      // Vérifier si des membres utilisent ce rôle
      const members = await AssociationMember.findAll({
        where: { associationId, status: 'active' }
      });
      
      const membersUsingRole = members.filter(m => 
        (m.assignedRoles || []).includes(roleId)
      );
      
      if (membersUsingRole.length > 0 && force !== 'true') {
        return res.status(400).json({
          error: 'Ce rôle est utilisé par des membres',
          code: 'ROLE_IN_USE',
          membersCount: membersUsingRole.length,
          hint: 'Retirez d\'abord ce rôle aux membres ou utilisez force=true'
        });
      }
      
      // Si force=true, retirer le rôle de tous les membres
      if (membersUsingRole.length > 0 && force === 'true') {
        for (const member of membersUsingRole) {
          const updatedRoles = member.assignedRoles.filter(r => r !== roleId);
          await member.update({ assignedRoles: updatedRoles });
        }
        console.log(`⚠️ Rôle "${roleId}" retiré de ${membersUsingRole.length} membres`);
      }
      
      // Supprimer le rôle
      rolesConfig.roles = rolesConfig.roles.filter(r => r.id !== roleId);
      
      // Sauvegarder
      association.rolesConfiguration = rolesConfig;
      association.changed('rolesConfiguration', true);
      await association.save();
      
      console.log(`🗑️ Rôle "${roleId}" supprimé par user ${req.user.id}`);
      
      res.json({
        success: true,
        message: 'Rôle supprimé avec succès',
        data: {
          deletedRoleId: roleId,
          membersAffected: membersUsingRole.length
        }
      });
      
    } catch (error) {
      console.error('Erreur suppression rôle:', error);
      res.status(500).json({
        error: 'Erreur suppression rôle',
        code: 'ROLE_DELETE_ERROR',
        details: error.message
      });
    }
  }
  
  // 👥 ATTRIBUER RÔLES À UN MEMBRE
  async assignRolesToMember(req, res) {
    try {
      const { id: associationId, memberId } = req.params;
      const { roleIds } = req.body;
      
      if (!Array.isArray(roleIds)) {
        return res.status(400).json({
          error: 'roleIds doit être un tableau',
          code: 'INVALID_ROLE_IDS'
        });
      }
      
      const member = await AssociationMember.findOne({
        where: { id: memberId, associationId }
      });
      
      if (!member) {
        return res.status(404).json({
          error: 'Membre introuvable',
          code: 'MEMBER_NOT_FOUND'
        });
      }
      
      const association = await Association.findByPk(associationId);
      const rolesConfig = association.rolesConfiguration || { roles: [] };
      
      // Valider que tous les roleIds existent
      const validRoleIds = rolesConfig.roles.map(r => r.id);
      const invalidRoleIds = roleIds.filter(id => !validRoleIds.includes(id));
      
      if (invalidRoleIds.length > 0) {
        return res.status(400).json({
          error: 'Rôles invalides',
          code: 'INVALID_ROLE_IDS',
          invalid: invalidRoleIds
        });
      }
      
      // Vérifier contraintes rôles uniques
      const uniqueRoles = rolesConfig.roles.filter(r => r.isUnique);
      for (const uniqueRole of uniqueRoles) {
        if (roleIds.includes(uniqueRole.id)) {
          // Vérifier qu'aucun autre membre n'a ce rôle
          const otherMembers = await AssociationMember.findAll({
            where: { 
              associationId, 
              status: 'active',
              id: { [require('sequelize').Op.ne]: memberId }
            }
          });
          
          const roleAlreadyAssigned = otherMembers.some(m => 
            (m.assignedRoles || []).includes(uniqueRole.id)
          );
          
          if (roleAlreadyAssigned) {
            return res.status(400).json({
              error: `Le rôle "${uniqueRole.name}" est unique et déjà attribué à un autre membre`,
              code: 'UNIQUE_ROLE_VIOLATION',
              roleName: uniqueRole.name
            });
          }
        }
      }
      
      // Attribuer les rôles
      await member.update({ assignedRoles: roleIds });
      
      console.log(`✅ Rôles attribués au membre ${memberId} par user ${req.user.id}`);
      
      res.json({
        success: true,
        message: 'Rôles attribués avec succès',
        data: {
          memberId: member.id,
          assignedRoles: roleIds
        }
      });
      
    } catch (error) {
      console.error('Erreur attribution rôles:', error);
      res.status(500).json({
        error: 'Erreur attribution rôles',
        code: 'ROLES_ASSIGN_ERROR',
        details: error.message
      });
    }
  }
  
  // ➖ RETIRER UN RÔLE D'UN MEMBRE
  async removeRoleFromMember(req, res) {
    try {
      const { id: associationId, memberId, roleId } = req.params;
      
      const member = await AssociationMember.findOne({
        where: { id: memberId, associationId }
      });
      
      if (!member) {
        return res.status(404).json({
          error: 'Membre introuvable',
          code: 'MEMBER_NOT_FOUND'
        });
      }
      
      const currentRoles = member.assignedRoles || [];
      
      if (!currentRoles.includes(roleId)) {
        return res.status(400).json({
          error: 'Le membre n\'a pas ce rôle',
          code: 'ROLE_NOT_ASSIGNED'
        });
      }
      
      const updatedRoles = currentRoles.filter(r => r !== roleId);
      await member.update({ assignedRoles: updatedRoles });
      
      console.log(`➖ Rôle ${roleId} retiré du membre ${memberId} par user ${req.user.id}`);
      
      res.json({
        success: true,
        message: 'Rôle retiré avec succès',
        data: {
          memberId: member.id,
          removedRole: roleId,
          remainingRoles: updatedRoles
        }
      });
      
    } catch (error) {
      console.error('Erreur retrait rôle:', error);
      res.status(500).json({
        error: 'Erreur retrait rôle',
        code: 'ROLE_REMOVE_ERROR',
        details: error.message
      });
    }
  }
  
  // 🔓 ACCORDER PERMISSION INDIVIDUELLE
  async grantPermission(req, res) {
    try {
      const { id: associationId, memberId } = req.params;
      const { permissionId } = req.body;
      
      const member = await AssociationMember.findOne({
        where: { id: memberId, associationId },
        include: [{ model: Association, as: 'association' }]
      });
      
      if (!member) {
        return res.status(404).json({
          error: 'Membre introuvable',
          code: 'MEMBER_NOT_FOUND'
        });
      }
      
      // Valider que la permission existe
      const validPermissions = member.association.rolesConfiguration?.availablePermissions?.map(p => p.id) || [];
      if (!validPermissions.includes(permissionId)) {
        return res.status(400).json({
          error: 'Permission invalide',
          code: 'INVALID_PERMISSION'
        });
      }
      
      const customPerms = member.customPermissions || { granted: [], revoked: [] };
      
      // Ajouter à granted si pas déjà présent
      if (!customPerms.granted.includes(permissionId)) {
        customPerms.granted.push(permissionId);
      }
      
      // Retirer de revoked si présent
      customPerms.revoked = customPerms.revoked.filter(p => p !== permissionId);
      
      await member.update({ customPermissions: customPerms });
      
      console.log(`✅ Permission "${permissionId}" accordée au membre ${memberId}`);
      
      res.json({
        success: true,
        message: 'Permission accordée avec succès',
        data: {
          memberId: member.id,
          grantedPermission: permissionId,
          allGrantedPermissions: customPerms.granted
        }
      });
      
    } catch (error) {
      console.error('Erreur accord permission:', error);
      res.status(500).json({
        error: 'Erreur accord permission',
        code: 'PERMISSION_GRANT_ERROR',
        details: error.message
      });
    }
  }
  
  // 🔒 RÉVOQUER PERMISSION INDIVIDUELLE
  async revokePermission(req, res) {
    try {
      const { id: associationId, memberId } = req.params;
      const { permissionId } = req.body;
      
      const member = await AssociationMember.findOne({
        where: { id: memberId, associationId }
      });
      
      if (!member) {
        return res.status(404).json({
          error: 'Membre introuvable',
          code: 'MEMBER_NOT_FOUND'
        });
      }
      
      const customPerms = member.customPermissions || { granted: [], revoked: [] };
      
      // Retirer de granted si présent
      customPerms.granted = customPerms.granted.filter(p => p !== permissionId);
      
      // Ajouter à revoked si pas déjà présent
      if (!customPerms.revoked.includes(permissionId)) {
        customPerms.revoked.push(permissionId);
      }
      
      await member.update({ customPermissions: customPerms });
      
      console.log(`🔒 Permission "${permissionId}" révoquée au membre ${memberId}`);
      
      res.json({
        success: true,
        message: 'Permission révoquée avec succès',
        data: {
          memberId: member.id,
          revokedPermission: permissionId,
          allRevokedPermissions: customPerms.revoked
        }
      });
      
    } catch (error) {
      console.error('Erreur révocation permission:', error);
      res.status(500).json({
        error: 'Erreur révocation permission',
        code: 'PERMISSION_REVOKE_ERROR',
        details: error.message
      });
    }
  }
  
  // 👑 TRANSFÉRER STATUT ADMIN À UN AUTRE MEMBRE
  async transferAdmin(req, res) {
    try {
      const { id: associationId } = req.params;
      const { newAdminMemberId } = req.body;
      
      // Vérifier que le demandeur est bien l'admin actuel
      const currentAdmin = await AssociationMember.findOne({
        where: { 
          userId: req.user.id, 
          associationId, 
          isAdmin: true, 
          status: 'active' 
        }
      });
      
      if (!currentAdmin) {
        return res.status(403).json({
          error: 'Seul l\'admin peut transférer son statut',
          code: 'NOT_ADMIN'
        });
      }
      
      // Vérifier que le nouveau membre existe
      const newAdmin = await AssociationMember.findOne({
        where: { id: newAdminMemberId, associationId, status: 'active' },
        include: [{ model: User, as: 'user' }]
      });
      
      if (!newAdmin) {
        return res.status(404).json({
          error: 'Nouveau membre admin introuvable',
          code: 'NEW_ADMIN_NOT_FOUND'
        });
      }
      
      // Transférer le statut admin
      await currentAdmin.update({ isAdmin: false });
      await newAdmin.update({ 
        isAdmin: true,
        customPermissions: {
          granted: ['manage_roles', 'manage_association_settings'],
          revoked: []
        }
      });
      
      console.log(`👑 Statut admin transféré de membre ${currentAdmin.id} vers ${newAdmin.id} dans association ${associationId}`);
      
      res.json({
        success: true,
        message: 'Statut admin transféré avec succès',
        data: {
          previousAdmin: {
            id: currentAdmin.id,
            userId: currentAdmin.userId
          },
          newAdmin: {
            id: newAdmin.id,
            userId: newAdmin.userId,
            name: `${newAdmin.user.firstName} ${newAdmin.user.lastName}`
          }
        }
      });
      
    } catch (error) {
      console.error('Erreur transfert admin:', error);
      res.status(500).json({
        error: 'Erreur transfert statut admin',
        code: 'ADMIN_TRANSFER_ERROR',
        details: error.message
      });
    }
  }
  
  // 📊 VOIR LES RÔLES D'UN MEMBRE
  async getMemberRoles(req, res) {
    try {
      const { id: associationId, memberId } = req.params;
      
      const member = await AssociationMember.findOne({
        where: { id: memberId, associationId },
        include: [
          { 
            model: User, 
            as: 'user',
            attributes: ['id', 'firstName', 'lastName', 'phoneNumber']
          },
          {
            model: Association,
            as: 'association',
            attributes: ['id', 'name', 'rolesConfiguration']
          }
        ]
      });
      
      if (!member) {
        return res.status(404).json({
          error: 'Membre introuvable',
          code: 'MEMBER_NOT_FOUND'
        });
      }
      
      const rolesConfig = member.association.rolesConfiguration || { roles: [], availablePermissions: [] };
      const assignedRoleIds = member.assignedRoles || [];
      
      // Récupérer détails des rôles attribués
      const assignedRoles = assignedRoleIds.map(roleId => {
        return rolesConfig.roles.find(r => r.id === roleId);
      }).filter(Boolean);
      
      // Calculer permissions effectives
      const effectivePermissions = new Set();
      
      // Permissions des rôles
      assignedRoles.forEach(role => {
        role.permissions.forEach(p => effectivePermissions.add(p));
      });
      
      // Ajouter custom granted
      (member.customPermissions?.granted || []).forEach(p => effectivePermissions.add(p));
      
      // Retirer custom revoked
      (member.customPermissions?.revoked || []).forEach(p => effectivePermissions.delete(p));
      
      res.json({
        success: true,
        data: {
          member: {
            id: member.id,
            userId: member.userId,
            name: `${member.user.firstName} ${member.user.lastName}`,
            memberType: member.memberType,
            isAdmin: member.isAdmin
          },
          assignedRoles,
          customPermissions: member.customPermissions,
          effectivePermissions: Array.from(effectivePermissions)
        }
      });
      
    } catch (error) {
      console.error('Erreur récupération rôles membre:', error);
      res.status(500).json({
        error: 'Erreur récupération rôles membre',
        code: 'MEMBER_ROLES_ERROR',
        details: error.message
      });
    }
  }
}

module.exports = new RolesController();