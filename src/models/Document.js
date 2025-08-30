'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Document extends Model {
    static associate(models) {
      // Un document appartient à un utilisateur
      Document.belongsTo(models.User, {
        foreignKey: 'userId',
        as: 'user'
      });
      
      // Document peut concerner une association
      Document.belongsTo(models.Association, {
        foreignKey: 'associationId',
        as: 'association'
      });
      
      // Document peut concerner une tontine
      Document.belongsTo(models.Tontine, {
        foreignKey: 'tontineId',
        as: 'tontine'
      });
      
      // Document peut être lié à une transaction
      Document.belongsTo(models.Transaction, {
        foreignKey: 'transactionId',
        as: 'transaction'
      });
    }

    // Générer URL d'accès sécurisé
    getSecureUrl() {
      if (!this.fileUrl) return null;
      
      // TODO: Implémenter signature temporaire pour sécurité
      return this.fileUrl;
    }

    // Vérifier si document est valide (non expiré)
    isValid() {
      if (!this.expiresAt) return true;
      return new Date() < new Date(this.expiresAt);
    }

    // Vérifier intégrité avec hash blockchain
    async verifyIntegrity() {
      if (!this.blockchainHash) return false;
      
      // TODO: Implémenter vérification hash blockchain
      return true;
    }

    // Obtenir statut formaté
    getFormattedStatus() {
      const statuses = {
        'pending': 'En attente',
        'validated': 'Validé',
        'rejected': 'Rejeté',
        'expired': 'Expiré',
        'processing': 'En cours'
      };
      
      return statuses[this.status] || this.status;
    }

    // Vérifier si téléchargeable
    isDownloadable() {
      return ['validated', 'pending'].includes(this.status) && 
             this.fileUrl && 
             this.isValid();
    }
  }

  Document.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    
    // 🔗 RELATIONS CONTEXTUELLES
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'Propriétaire du document'
    },
    
    associationId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'associations',
        key: 'id'
      },
      comment: 'Association concernée (si applicable)'
    },
    
    tontineId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'tontines',
        key: 'id'
      },
      comment: 'Tontine concernée (si applicable)'
    },
    
    transactionId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'transactions',
        key: 'id'
      },
      comment: 'Transaction liée (pour attestations)'
    },
    
    // 🏷️ CLASSIFICATION DOCUMENT
    type: {
      type: DataTypes.ENUM(
        // 📄 KYC/KYB
        'identity_card',          // Carte identité
        'passport',              // Passeport
        'driver_license',        // Permis conduire
        'residence_permit',      // Titre séjour
        'proof_address',         // Justificatif domicile
        'iban_proof',           // RIB
        
        // 🏛️ Association
        'association_statuts',   // Statuts association
        'association_receipt',   // Récépissé déclaration
        'meeting_minutes',       // PV réunions
        'financial_report',      // Rapport financier
        
        // 💰 Tontine
        'tontine_rules',        // Règlement tontine
        'debt_attestation',     // Attestation dette
        'completion_certificate', // Attestation fin tontine
        'default_notice',       // Avis défaillance
        
        // 📊 Attestations générées
        'contribution_certificate', // Attestation cotisations
        'membership_certificate',   // Attestation adhésion
        'payment_receipt',          // Reçu paiement
        
        // 📁 Autres
        'contract',             // Contrat
        'invoice',              // Facture
        'other'                 // Autre
      ),
      allowNull: false,
      comment: 'Type de document'
    },
    
    category: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Catégorie spécifique (configurable)'
    },
    
    // 📋 MÉTADONNÉES DOCUMENT
    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: 'Titre du document'
    },
    
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Description détaillée'
    },
    
    // 📁 FICHIER
    fileName: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: 'Nom original du fichier'
    },
    
    fileUrl: {
      type: DataTypes.STRING(500),
      allowNull: false,
      comment: 'URL d\'accès au fichier (Cloudinary, S3, etc.)'
    },
    
    filePath: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: 'Chemin stockage local (backup)'
    },
    
    fileSize: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Taille fichier en bytes'
    },
    
    mimeType: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: 'Type MIME (application/pdf, image/jpeg, etc.)'
    },
    
    fileHash: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Hash SHA256 du fichier (intégrité)'
    },
    
    // 🔐 SÉCURITÉ & VALIDATION
    status: {
      type: DataTypes.ENUM('pending', 'validated', 'rejected', 'expired', 'processing'),
      allowNull: false,
      defaultValue: 'pending',
      comment: 'Statut de validation'
    },
    
    validatedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'Utilisateur ayant validé'
    },
    
    validatedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date validation'
    },
    
    rejectionReason: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Raison du rejet'
    },
    
    // 📅 DATES VALIDITÉ
    issuedDate: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date émission document'
    },
    
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date expiration (si applicable)'
    },
    
    // 🔗 BLOCKCHAIN & AUDIT
    blockchainHash: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Hash blockchain pour preuve légale'
    },
    
    blockchainNetwork: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Réseau blockchain utilisé'
    },
    
    transactionHash: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Hash transaction blockchain'
    },
    
    // 🎯 GÉNÉRATION AUTOMATIQUE
    isGenerated: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'Document généré automatiquement par app'
    },
    
    templateUsed: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Template utilisé pour génération'
    },
    
    generationData: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Données utilisées pour génération'
    },
    
    // 👁️ ACCÈS & VISIBILITÉ
    visibility: {
      type: DataTypes.ENUM('private', 'association', 'tontine', 'bureau', 'public'),
      allowNull: false,
      defaultValue: 'private',
      comment: 'Niveau visibilité document'
    },
    
    accessCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: 'Nombre d\'accès au document'
    },
    
    lastAccessedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Dernier accès'
    },
    
    // 📱 MÉTADONNÉES UPLOAD
    uploadedFrom: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'mobile',
      comment: 'Source upload (mobile, web, admin)'
    },
    
    deviceInfo: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Info appareil upload (debug)'
    },
    
    // 🔄 VERSIONING
    version: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      comment: 'Version du document'
    },
    
    parentDocumentId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'documents',
        key: 'id'
      },
      comment: 'Document parent (pour versions)'
    },
    
    // 📝 NOTES & COMMENTAIRES
    adminNotes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Notes internes admin'
    },
    
    publicComments: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Commentaires visibles utilisateur'
    },
    
    // 📊 MÉTADONNÉES ADDITIONNELLES
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Métadonnées spécifiques au type document'
    },
    
    tags: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Tags pour recherche et classification'
    }
  }, {
    sequelize,
    modelName: 'Document',
    tableName: 'documents',
    underscored: true,
    timestamps: true,
    
    indexes: [
      {
        fields: ['user_id']
      },
      {
        fields: ['association_id']
      },
      {
        fields: ['tontine_id']
      },
      {
        fields: ['type']
      },
      {
        fields: ['status']
      },
      {
        fields: ['file_hash']
      },
      {
        fields: ['blockchain_hash']
      },
      {
        fields: ['expires_at']
      },
      {
        fields: ['validated_at']
      },
      {
        fields: ['visibility']
      }
    ]
  });

  return Document;
};