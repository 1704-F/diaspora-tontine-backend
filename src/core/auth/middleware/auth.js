// middleware/auth.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { User, AssociationMember, TontineParticipant } = require('../../../models');
const redisConfig = require('../../redis/redis');

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-diaspora-tontine';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

class AuthService {
  
  // Générer tokens JWT
  generateTokens(user, sessionInfo = {}) {
    const payload = {
      userId: user.id,
      phoneNumber: user.phoneNumber,
      role: user.role || 'member',
      sessionId: sessionInfo.sessionId || Date.now().toString(),
      iat: Math.floor(Date.now() / 1000)
    };

    const accessToken = jwt.sign(payload, JWT_SECRET, { 
      expiresIn: JWT_EXPIRES_IN 
    });
    
    const refreshToken = jwt.sign({
      userId: user.id,
      sessionId: payload.sessionId,
      type: 'refresh'
    }, JWT_SECRET, { 
      expiresIn: JWT_REFRESH_EXPIRES_IN 
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: JWT_EXPIRES_IN,
      tokenType: 'Bearer'
    };
  }

  // Vérifier et décoder token
  async verifyToken(token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      
      // Vérifier si token en blacklist (Redis)
      if (redisConfig.isAvailable()) {
        const redis = redisConfig.getClient();
        const isBlacklisted = await redis.get(`blacklist:${token}`);
        if (isBlacklisted) {
          throw new Error('Token révoqué');
        }
      }
      
      return decoded;
    } catch (error) {
      throw new Error('Token invalide: ' + error.message);
    }
  }

  // Révoquer token (blacklist)
  async revokeToken(token) {
    try {
      const decoded = jwt.decode(token);
      if (!decoded || !decoded.exp) return false;

      if (redisConfig.isAvailable()) {
        const redis = redisConfig.getClient();
        const ttl = decoded.exp - Math.floor(Date.now() / 1000);
        if (ttl > 0) {
          await redis.setex(`blacklist:${token}`, ttl, 'revoked');
        }
      }
      
      return true;
    } catch (error) {
      console.error('Erreur révocation token:', error);
      return false;
    }
  }

  // Hash PIN code
  async hashPIN(pin) {
    const saltRounds = 12;
    return bcrypt.hash(pin.toString(), saltRounds);
  }

  // Vérifier PIN
  async verifyPIN(pin, hashedPIN) {
    return bcrypt.compare(pin.toString(), hashedPIN);
  }

  // Obtenir permissions utilisateur pour contexte
  async getUserPermissions(userId, context = 'platform') {
    try {
      const user = await User.findByPk(userId, {
        include: [
          {
            model: AssociationMember,
            as: 'associationMemberships',
            include: ['association', 'section']
          },
          {
            model: TontineParticipant,
            as: 'tontineParticipations', 
            include: ['tontine']
          }
        ]
      });

      if (!user) throw new Error('Utilisateur introuvable');

      const permissions = {
        platform: {
          role: user.role || 'member',
          canAccessPlatform: true
        },
        associations: {},
        tontines: {},
        sections: {}
      };

      // Permissions associations
      if (user.associationMemberships) {
        for (const membership of user.associationMemberships) {
          const assocId = membership.associationId;
          permissions.associations[assocId] = {
            role: membership.role,
            status: membership.status,
            canViewFinances: ['treasurer', 'president', 'central_board'].includes(membership.role),
            canManageMembers: ['president', 'secretary', 'central_board'].includes(membership.role),
            canApproveAids: ['president', 'treasurer', 'central_board'].includes(membership.role)
          };

          // Permissions section si applicable
          if (membership.sectionId) {
            permissions.sections[membership.sectionId] = {
              role: membership.role,
              associationId: assocId,
              canManageSection: ['president', 'secretary'].includes(membership.role)
            };
          }
        }
      }

      // Permissions tontines
      if (user.tontineParticipations) {
        for (const participation of user.tontineParticipations) {
          const tontineId = participation.tontineId;
          const isOrganizer = participation.tontine?.organizerId === userId;
          
          permissions.tontines[tontineId] = {
            role: isOrganizer ? 'organizer' : 'participant',
            status: participation.status,
            canManageTontine: isOrganizer,
            canViewFinances: isOrganizer,
            canApproveParticipants: isOrganizer
          };
        }
      }

      return permissions;
    } catch (error) {
      console.error('Erreur récupération permissions:', error);
      throw error;
    }
  }
}

// Instance singleton
const authService = new AuthService();

// Middleware d'authentification principal
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Token d\'authentification requis',
        code: 'MISSING_TOKEN'
      });
    }

    const token = authHeader.substring(7);
    const decoded = await authService.verifyToken(token);
    
    // Récupérer utilisateur complet
    const user = await User.findByPk(decoded.userId);
    if (!user) {
      return res.status(401).json({
        error: 'Utilisateur introuvable',
        code: 'USER_NOT_FOUND'
      });
    }

    // Ajouter infos à la requête
    req.user = user;
    req.token = token;
    req.authInfo = {
      userId: decoded.userId,
      sessionId: decoded.sessionId,
      role: decoded.role
    };

    next();
  } catch (error) {
    console.error('Erreur authentification:', error);
    return res.status(401).json({
      error: 'Token invalide ou expiré',
      code: 'INVALID_TOKEN',
      details: error.message
    });
  }
};

// Middleware RBAC - Vérifier rôles platform
const requireRole = (...allowedRoles) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: 'Authentification requise',
          code: 'AUTH_REQUIRED'
        });
      }

      const userRole = req.user.role || 'member';
      
      if (!allowedRoles.includes(userRole)) {
        return res.status(403).json({
          error: 'Permissions insuffisantes',
          code: 'INSUFFICIENT_PERMISSIONS',
          required: allowedRoles,
          current: userRole
        });
      }

      next();
    } catch (error) {
      console.error('Erreur vérification rôle:', error);
      return res.status(500).json({
        error: 'Erreur vérification permissions'
      });
    }
  };
};

// Middleware RBAC - Vérifier permissions association
const requireAssociationPermission = (associationParam = 'associationId', requiredRole = 'member') => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: 'Authentification requise',
          code: 'AUTH_REQUIRED'
        });
      }

      const associationId = req.params[associationParam] || req.body[associationParam];
      
      if (!associationId) {
        return res.status(400).json({
          error: 'ID association requis',
          code: 'MISSING_ASSOCIATION_ID'
        });
      }

      // Vérifier membership
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId: associationId,
          status: 'active'
        }
      });

      if (!membership) {
        return res.status(403).json({
          error: 'Accès association non autorisé',
          code: 'NOT_ASSOCIATION_MEMBER'
        });
      }

      // Vérifier niveau de permissions
      const roleHierarchy = {
        'member': 1,
        'active_member': 2,
        'delegate': 3,
        'board_member': 4,
        'secretary': 5,
        'treasurer': 5,
        'president': 6,
        'central_board': 7,
        'founder': 8
      };

      const userLevel = roleHierarchy[membership.role] || 1;
      const requiredLevel = roleHierarchy[requiredRole] || 1;

      if (userLevel < requiredLevel) {
        return res.status(403).json({
          error: 'Niveau de permissions insuffisant',
          code: 'INSUFFICIENT_ASSOCIATION_PERMISSIONS',
          required: requiredRole,
          current: membership.role
        });
      }

      // Ajouter membership à la requête
      req.associationMembership = membership;
      
      next();
    } catch (error) {
      console.error('Erreur vérification permission association:', error);
      return res.status(500).json({
        error: 'Erreur vérification permissions association'
      });
    }
  };
};

// Middleware RBAC - Vérifier permissions tontine
const requireTontinePermission = (tontineParam = 'tontineId', requiredRole = 'participant') => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: 'Authentification requise',
          code: 'AUTH_REQUIRED'
        });
      }

      const tontineId = req.params[tontineParam] || req.body[tontineParam];
      
      if (!tontineId) {
        return res.status(400).json({
          error: 'ID tontine requis',
          code: 'MISSING_TONTINE_ID'
        });
      }

      // Vérifier participation ou organisation
      const [participation, tontine] = await Promise.all([
        TontineParticipant.findOne({
          where: {
            userId: req.user.id,
            tontineId: tontineId
          }
        }),
        require('../../../models').Tontine.findByPk(tontineId)
      ]);

      const isOrganizer = tontine?.organizerId === req.user.id;
      
      if (!participation && !isOrganizer) {
        return res.status(403).json({
          error: 'Accès tontine non autorisé',
          code: 'NOT_TONTINE_MEMBER'
        });
      }

      // Vérifier niveau requis
      if (requiredRole === 'organizer' && !isOrganizer) {
        return res.status(403).json({
          error: 'Seul l\'organisateur peut effectuer cette action',
          code: 'ORGANIZER_ONLY'
        });
      }

      // Ajouter infos à la requête
      req.tontineParticipation = participation;
      req.isTontineOrganizer = isOrganizer;
      req.tontine = tontine;
      
      next();
    } catch (error) {
      console.error('Erreur vérification permission tontine:', error);
      return res.status(500).json({
        error: 'Erreur vérification permissions tontine'
      });
    }
  };
};

// Middleware optionnel - Authentification si présente
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const decoded = await authService.verifyToken(token);
        const user = await User.findByPk(decoded.userId);
        if (user) {
          req.user = user;
          req.authInfo = {
            userId: decoded.userId,
            sessionId: decoded.sessionId,
            role: decoded.role
          };
        }
      } catch (error) {
        // Ignorer erreurs token pour auth optionnelle
      }
    }
    
    next();
  } catch (error) {
    next();
  }
};

module.exports = {
  authService,
  authenticate,
  requireRole,
  requireAssociationPermission,
  requireTontinePermission,
  optionalAuth
};