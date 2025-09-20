// src/core/services/userDataSearchService.js

const { User, AssociationMember, Association, Section, TontineParticipant, Tontine } = require('../../models');
const { Op } = require('sequelize');

/**
 * Service pour rechercher les données utilisateur existantes 
 * à travers tous les modules de la plateforme
 */
class UserDataSearchService {

  /**
   * Recherche les données d'un utilisateur à travers tous les modules actifs
   * @param {string} phoneNumber - Numéro de téléphone formaté
   * @returns {Array} Données trouvées triées par priorité
   */
  static async searchUserDataAcrossModules(phoneNumber) {
    try {
      console.log(`🔍 Recherche données existantes pour: ${phoneNumber}`);
      
      const results = [];

      // 🏛️ MODULE ASSOCIATIONS
      const associationData = await this.searchInAssociationsModule(phoneNumber);
      if (associationData.length > 0) {
        results.push(...associationData);
      }

      // 💰 MODULE TONTINES  
      const tontineData = await this.searchInTontinesModule(phoneNumber);
      if (tontineData.length > 0) {
        results.push(...tontineData);
      }

      // 🔮 MODULES FUTURS (famille, commerce, etc.)
      // Cette architecture permet d'ajouter facilement de nouveaux modules
      // await this.searchInFamilyModule(phoneNumber);
      // await this.searchInCommerceModule(phoneNumber);

      // Trier par priorité + fraîcheur
      const sortedResults = this.prioritizeResults(results);
      
      console.log(`📊 ${results.length} source(s) de données trouvée(s)`);
      return sortedResults;

    } catch (error) {
      console.error('Erreur recherche données utilisateur:', error);
      return [];
    }
  }

  /**
   * Recherche dans le module Associations
   */
  static async searchInAssociationsModule(phoneNumber) {
    try {
      const associationUsers = await User.findAll({
        where: { phoneNumber },
        include: [{
          model: AssociationMember,
          as: 'associationMemberships',
          include: [{
            model: Association,
            as: 'association',
            attributes: ['id', 'name', 'legalStatus']
          }, {
            model: Section,
            as: 'section',
            attributes: ['id', 'name', 'country', 'city']
          }]
        }],
        attributes: ['id', 'firstName', 'lastName', 'email', 'dateOfBirth', 'gender', 'address', 'city', 'country', 'postalCode', 'createdAt', 'updatedAt']
      });

      const results = [];

      for (const user of associationUsers) {
        if (user.associationMemberships && user.associationMemberships.length > 0) {
          for (const membership of user.associationMemberships) {
            
            // Déterminer qui a ajouté ce membre (pour la source)
            const sourceType = this.determineSourceType(user, 'association');
            const addedByInfo = await this.getAddedByInfo(membership, 'association');

            results.push({
              module: 'associations',
              moduleIcon: '🏛️',
              source: membership.association.name,
              sourceType: sourceType,
              addedBy: addedByInfo,
              data: this.extractUserData(user),
              membershipData: {
                memberType: membership.memberType,
                status: membership.status,
                joinDate: membership.joinDate,
                roles: membership.roles
              },
              section: membership.section ? {
                id: membership.section.id,
                name: membership.section.name,
                location: `${membership.section.city}, ${membership.section.country}`
              } : null,
              priority: this.calculatePriority(sourceType, user.updatedAt),
              lastUpdated: user.updatedAt,
              userId: user.id
            });
          }
        }
      }

      return results;

    } catch (error) {
      console.error('Erreur recherche module associations:', error);
      return [];
    }
  }

  /**
   * Recherche dans le module Tontines
   */
  static async searchInTontinesModule(phoneNumber) {
    try {
      const tontineUsers = await User.findAll({
        where: { phoneNumber },
        include: [{
          model: TontineParticipant,
          as: 'tontineParticipations',
          include: [{
            model: Tontine,
            as: 'tontine',
            attributes: ['id', 'name', 'type', 'status', 'organizerId']
          }]
        }],
        attributes: ['id', 'firstName', 'lastName', 'email', 'dateOfBirth', 'gender', 'address', 'city', 'country', 'postalCode', 'createdAt', 'updatedAt']
      });

      const results = [];

      for (const user of tontineUsers) {
        if (user.tontineParticipations && user.tontineParticipations.length > 0) {
          for (const participation of user.tontineParticipations) {
            
            const sourceType = this.determineSourceType(user, 'tontine');
            const addedByInfo = await this.getAddedByInfo(participation, 'tontine');

            results.push({
              module: 'tontines',
              moduleIcon: '💰',
              source: participation.tontine.name,
              sourceType: sourceType,
              addedBy: addedByInfo,
              data: this.extractUserData(user),
              participationData: {
                status: participation.status,
                position: participation.position,
                reputation: participation.reputation,
                joinDate: participation.joinDate
              },
              tontineInfo: {
                type: participation.tontine.type,
                status: participation.tontine.status
              },
              priority: this.calculatePriority(sourceType, user.updatedAt),
              lastUpdated: user.updatedAt,
              userId: user.id
            });
          }
        }
      }

      return results;

    } catch (error) {
      console.error('Erreur recherche module tontines:', error);
      return [];
    }
  }

  /**
   * MODULES FUTURS - Template pour extension
   */
  
  // static async searchInFamilyModule(phoneNumber) {
  //   // TODO: Implémenter quand module famille sera créé
  //   try {
  //     const familyUsers = await User.findAll({
  //       where: { phoneNumber },
  //       include: [{
  //         model: FamilyMember,
  //         as: 'familyMemberships',
  //         include: [{ model: Family, as: 'family' }]
  //       }]
  //     });
  //     
  //     // Logic similaire...
  //     return results;
  //   } catch (error) {
  //     return [];
  //   }
  // }

  // static async searchInCommerceModule(phoneNumber) {
  //   // TODO: Implémenter quand module commerce sera créé
  //   return [];
  // }

  /**
   * Extraire les données utilisateur pertinentes
   */
  static extractUserData(user) {
    return {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      dateOfBirth: user.dateOfBirth,
      gender: user.gender,
      address: user.address,
      city: user.city,
      country: user.country,
      postalCode: user.postalCode
    };
  }

  /**
   * Déterminer le type de source des données
   */
  static determineSourceType(user, moduleType) {
    // Logique pour déterminer comment l'utilisateur a été ajouté
    const timeSinceCreation = Date.now() - new Date(user.createdAt).getTime();
    const daysSinceCreation = timeSinceCreation / (1000 * 60 * 60 * 24);

    // Si créé récemment avec données complètes → probablement auto-inscription
    if (daysSinceCreation < 7 && user.firstName !== 'Utilisateur' && user.lastName !== 'Temporaire') {
      return 'self_registered';
    }

    // Si données temporaires → ajouté par admin
    if (user.firstName === 'Utilisateur' || user.lastName === 'Temporaire') {
      return 'admin_added';
    }

    // Si ancien avec données complètes → import ou admin vérifié
    if (daysSinceCreation > 30) {
      return 'import_old';
    }

    // Par défaut
    return 'admin_added';
  }

  /**
   * Obtenir info sur qui a ajouté ce membre
   */
  static async getAddedByInfo(membership, moduleType) {
    try {
      if (moduleType === 'association') {
        // TODO: Ajouter champ addedBy dans AssociationMember si pas existant
        return 'Admin association';
      } else if (moduleType === 'tontine') {
        // Récupérer info organisateur tontine
        const organizer = await User.findByPk(membership.tontine.organizerId, {
          attributes: ['firstName', 'lastName']
        });
        return organizer ? `${organizer.firstName} ${organizer.lastName} (Organisateur)` : 'Organisateur tontine';
      }
      
      return 'Système';
    } catch (error) {
      return 'Source inconnue';
    }
  }

  /**
   * Calculer la priorité d'une source de données
   */
  static calculatePriority(sourceType, lastUpdated) {
    const basePriorities = {
      'self_registered': 100,    // User lui-même = priorité max
      'admin_verified': 80,      // Admin qui connaît la personne  
      'admin_added': 70,         // Admin standard
      'import_recent': 60,       // Import < 6 mois
      'import_old': 40           // Import > 6 mois
    };

    const basePriority = basePriorities[sourceType] || 50;
    
    // Bonus fraîcheur (max 20 points)
    const daysSinceUpdate = (Date.now() - new Date(lastUpdated).getTime()) / (1000 * 60 * 60 * 24);
    const freshnessBonus = Math.max(0, Math.min(20, 20 - daysSinceUpdate));
    
    return Math.round(basePriority + freshnessBonus);
  }

  /**
   * Trier et prioriser les résultats
   */
  static prioritizeResults(results) {
    return results.sort((a, b) => {
      // D'abord par priorité (décroissant)
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      
      // Puis par date de mise à jour (plus récent en premier)
      return new Date(b.lastUpdated) - new Date(a.lastUpdated);
    });
  }

  /**
   * Fusionner les données de multiples sources (logique avancée)
   */
  static mergeUserDataSources(results) {
    if (results.length === 0) return null;
    if (results.length === 1) return results[0].data;

    // Prendre la source avec la plus haute priorité comme base
    const primarySource = results[0];
    const mergedData = { ...primarySource.data };

    // Compléter avec les données manquantes des autres sources
    for (let i = 1; i < results.length; i++) {
      const source = results[i];
      
      Object.keys(source.data).forEach(key => {
        // Si donnée manquante dans source primaire, prendre de source secondaire
        if (!mergedData[key] && source.data[key]) {
          mergedData[key] = source.data[key];
        }
      });
    }

    return {
      mergedData,
      sources: results.map(r => ({
        module: r.module,
        source: r.source,
        priority: r.priority
      }))
    };
  }

  /**
   * Formater les résultats pour l'affichage frontend
   */
  static formatResultsForFrontend(results) {
    return results.map(result => ({
      module: {
        name: result.module,
        icon: result.moduleIcon,
        displayName: result.module === 'associations' ? 'Association' : 
                    result.module === 'tontines' ? 'Tontine' : 
                    result.module
      },
      source: {
        name: result.source,
        addedBy: result.addedBy,
        type: result.sourceType
      },
      data: result.data,
      metadata: {
        priority: result.priority,
        lastUpdated: result.lastUpdated,
        userId: result.userId
      },
      // Données spécifiques au module
      ...(result.membershipData && { membershipInfo: result.membershipData }),
      ...(result.participationData && { participationInfo: result.participationData }),
      ...(result.section && { section: result.section })
    }));
  }
}

module.exports = UserDataSearchService;