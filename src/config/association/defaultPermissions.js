// src/config/association/defaultPermissions.js

/**
 * 🔐 Liste complète des permissions disponibles dans le système
 * Ces permissions sont initialisées pour TOUTES les associations
 */

module.exports = {
  availablePermissions: [
    // 💰 FINANCES
    {
      id: 'finances.view_treasury',
      name: 'Voir la trésorerie',
      category: 'finances',
      description: 'Consulter le solde et l\'historique des transactions'
    },
    {
      id: 'finances.manage_budgets',
      name: 'Gérer les budgets',
      category: 'finances',
      description: 'Créer et modifier les budgets de l\'association'
    },
    {
      id: 'finances.validate_expenses',
      name: 'Valider les dépenses',
      category: 'finances',
      description: 'Approuver ou refuser les demandes de dépenses'
    },
    {
      id: 'finances.create_income',
      name: 'Créer des recettes',
      category: 'finances',
      description: 'Enregistrer les revenus de l\'association'
    },
    {
      id: 'finances.export_data',
      name: 'Exporter les données financières',
      category: 'finances',
      description: 'Télécharger les rapports financiers en Excel/PDF'
    },
    
    // 👥 MEMBRES
    {
      id: 'membres.view_list',
      name: 'Voir la liste des membres',
      category: 'membres',
      description: 'Accéder à la liste complète des membres'
    },
    {
      id: 'membres.manage_members',
      name: 'Gérer les membres',
      category: 'membres',
      description: 'Ajouter, modifier ou supprimer des membres'
    },
    {
      id: 'membres.approve_members',
      name: 'Approuver les membres',
      category: 'membres',
      description: 'Valider les demandes d\'adhésion'
    },
    {
      id: 'membres.view_details',
      name: 'Voir les détails des membres',
      category: 'membres',
      description: 'Accéder aux informations personnelles des membres'
    },
    
    // 🏛️ ADMINISTRATION
    {
      id: 'administration.manage_roles',
      name: 'Gérer les rôles',
      category: 'administration',
      description: 'Créer et modifier les rôles et permissions'
    },
    {
      id: 'administration.modify_settings',
      name: 'Modifier les paramètres',
      category: 'administration',
      description: 'Changer les paramètres de l\'association'
    },
    {
      id: 'administration.view_reports',
      name: 'Voir les rapports',
      category: 'administration',
      description: 'Accéder aux rapports d\'activité'
    },
    {
      id: 'administration.manage_sections',
      name: 'Gérer les sections',
      category: 'administration',
      description: 'Créer et administrer les sections géographiques'
    },
    
    // 📄 DOCUMENTS
    {
      id: 'documents.upload',
      name: 'Télécharger des documents',
      category: 'documents',
      description: 'Ajouter des documents à l\'association'
    },
    {
      id: 'documents.manage',
      name: 'Gérer les documents',
      category: 'documents',
      description: 'Modifier ou supprimer des documents'
    },
    {
      id: 'documents.validate',
      name: 'Valider les documents',
      category: 'documents',
      description: 'Approuver les documents officiels'
    },
    
    // 📅 ÉVÉNEMENTS
    {
      id: 'evenements.create',
      name: 'Créer des événements',
      category: 'evenements',
      description: 'Organiser des événements pour l\'association'
    },
    {
      id: 'evenements.manage',
      name: 'Gérer les événements',
      category: 'evenements',
      description: 'Modifier ou annuler des événements'
    },
    {
      id: 'evenements.view_attendance',
      name: 'Voir les présences',
      category: 'evenements',
      description: 'Consulter les listes de présence aux événements'
    }
  ]
};