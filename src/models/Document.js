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
      
      // Un document peut appartenir à une association
      Document.belongsTo(models.Association, {
        foreignKey: 'associationId',
        as: 'association'
      });
      
      // Un document peut appartenir à une tontine
      Document.belongsTo(models.Tontine, {
        foreignKey: 'tontineId',
        as: 'tontine'
      });
      
      // Un document peut être lié à un membership
      Document.belongsTo(models.AssociationMember, {
        foreignKey: 'membershipId',
        as: 'membership'
      });
      
      // Un document peut être lié à un participant tontine
      Document.belongsTo(models.TontineParticipant, {
        foreignKey: 'participantId',
        as: 'participant'
      });
    }

    // Vérifier si document est expiré
    isExpired() {
      if (!this.expiresAt) return false;
      return new Date() > this.expiresAt;
    }

    // Générer URL de téléchargement sécurisée
    getSecureDownloadUrl() {
      if (!this.fileUrl) return null;
      
      // TODO: Implémenter génération URL signée temporaire
      return this.fileUrl;
    }

    // Obtenir taille formatée
    getFormattedSize() {
      if (!this.fileSize) return 'N/A';
      
      const bytes = parseInt(this.fileSize);
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      
      if (bytes === 0) return '0 Bytes';
      
      const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
      return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }

    // Vérifier si utilisateur peut accéder
    async canUserAccess(userId) {
      // Propriétaire du document
      if (this.userId === userId) return true;
      
      // Admin platform
      const user = await sequelize.models.User.findByPk(userId);
      if (user && user.role === 'platform_admin') return true;
      
      // Membres bureau association si document association
      if (this.associationId) {
        const membership = await sequelize.models.AssociationMember.findOne({
          where: { 
            userId, 
            associationId: this.associationId,
            role: ['president', 'secretary', 'treasurer', 'central_board']
          }
        });
        if (membership) return true;
      }
      
      // Organisateur tontine si document tontine
      if (this.tontineId) {
        const tontine = await sequelize.models.Tontine.findByPk(this.tontineId);
        if (tontine && tontine.organizerId === userId) return true;
      }
      
      return false;
    }
  }

  Document.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    
    // 🔗 RELATIONS FLEXIBLES
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'Propriétaire/créateur du document'
    },
    
    associationId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'associations',
        key: 'id'
      },
      comment: 'Association concernée si applicable'
    },
    
    tontineId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'tontines',
        key: 'id'
      },
      comment: 'Tontine concernée si applicable'
    },
    
    membershipId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'association_members',
        key: 'id'
      },
      comment: 'Membership concerné si applicable'
    },
    
    participantId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'tontine_participants',
        key: 'id'
      },
      comment: 'Participant tontine concerné si applicable'
    },
    
    // 🏷️ IDENTIFICATION DOCUMENT
    documentNumber: {
  type: DataTypes.STRING(255),
  allowNull: false,
  field: 'document_number',
  // unique: true,  // <-- SUPPRIMER CETTE LIGNE
  comment: 'Numéro unique: DOC20250824001'
},
    
    type: {
  type: DataTypes.STRING,
  allowNull: false,
  validate: {
    isIn: [[
      'association_statuts', 'association_receipisse', 'association_rib', 'association_pv_creation',
      'association_pv_assembly', 'association_delegation', 'association_insurance',
      'kyc_identity', 'kyc_residence_permit', 'kyc_address_proof', 'kyc_income_proof', 'kyc_bank_statement',
      'attestation_membership', 'attestation_cotisations', 'attestation_debt', 'attestation_completion',
      'report_financial', 'report_members', 'report_activities', 'export_transactions', 'export_statistics',
      'tontine_rules', 'tontine_participant_list', 'tontine_draw_proof', 'tontine_completion_report',
      'contract', 'invoice', 'receipt', 'legal_notice', 'other'
    ]]
  }
},
    
    subType: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Sous-type pour précision'
    },
    
    // 📄 INFORMATIONS FICHIER
    title: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        len: [1, 200]
      }
    },
    
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    
    fileName: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Nom fichier original'
    },
    
    fileUrl: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'URL stockage (S3, Cloudinary, etc.)'
    },
    
    fileSize: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: 'Taille en bytes'
    },
    
    mimeType: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'application/pdf, image/jpeg, etc.'
    },
    
    fileExtension: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        len: [1, 10]
      }
    },
    
    // 🔐 SÉCURITÉ & ACCÈS
    accessLevel: {
  type: DataTypes.STRING,
  allowNull: false,
  defaultValue: 'owner_only',
  validate: {
    isIn: [['public', 'association_only', 'board_only', 'owner_only', 'platform_admin']]
  }
},

    
    isEncrypted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    
    encryptionKey: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Clé chiffrement si fichier sensible'
    },
    
    // 📊 STATUT & VALIDATION
   status: {
  type: DataTypes.STRING,
  allowNull: false,
  defaultValue: 'uploaded',
  validate: {
    isIn: [['uploaded', 'processing', 'validated', 'rejected', 'expired', 'archived', 'deleted']]
  }
},

    
    validatedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    validatedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'ID utilisateur qui a validé'
    },
    
    rejectionReason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    
    // 📅 DATES IMPORTANTES
    issuedDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: 'Date émission document'
    },
    
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date expiration (CNI, titre séjour, etc.)'
    },
    
    // 📑 METADATA DOCUMENT
    version: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      comment: 'Version du document'
    },
    
    language: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'fr',
      validate: {
        isIn: [['fr', 'en', 'it', 'es']]
      }
    },
    
    pageCount: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Nombre de pages (PDF)'
    },
    
    // 🔍 RECHERCHE & CLASSIFICATION
    tags: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
      comment: 'Tags recherche: ["statuts", "2024", "officiel"]'
    },
    
    category: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Catégorie libre'
    },
    
    searchableContent: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Contenu indexé pour recherche'
    },
    
    // 📈 ANALYTICS & USAGE
    downloadCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    
    lastAccessedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    lastAccessedBy: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    
    // ✍️ SIGNATURE ÉLECTRONIQUE
    isSigned: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    
    signatureData: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Données signature électronique'
    },
    
    signedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    signedBy: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Liste des signataires'
    },
    
    // 🔗 BLOCKCHAIN & PROOF
    blockchainHash: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Hash blockchain pour preuve d\'existence'
    },
    
    ipfsHash: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Hash IPFS pour stockage décentralisé'
    },
    
    // 📋 COMPLIANCE & LEGAL
 legalValue: {
  type: DataTypes.STRING,
  allowNull: false,
  defaultValue: 'informative',
  validate: {
    isIn: [['none', 'informative', 'probative', 'authentic']]
  },
  comment: 'Valeur légale du document'
},
    retentionPolicy: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Politique conservation: durée, suppression auto'
    },
    
 gdprCategory: {
  type: DataTypes.STRING,
  allowNull: false,
  defaultValue: 'personal',
  validate: {
    isIn: [['personal', 'sensitive', 'anonymous', 'public']]
  },
  comment: 'Catégorie RGPD'
},

    
    // 🔄 HISTORIQUE & VERSIONS
    parentDocumentId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'documents',
        key: 'id'
      },
      comment: 'Document parent si nouvelle version'
    },
    
    versionHistory: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: [],
      comment: 'Historique des versions'
    },
    
    // 📧 NOTIFICATIONS & WORKFLOWS
    autoNotifyExpiry: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: 'Notification auto avant expiration'
    },
    
    expiryNotificationSent: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    
    workflowStatus: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'État workflow validation/approbation'
    },
    
    // ⚙️ TECHNICAL METADATA
    uploadedFrom: {
  type: DataTypes.STRING,
  allowNull: false,
  defaultValue: 'web',
  validate: {
    isIn: [['web', 'mobile', 'api', 'import', 'system']]
  }
},

    
    processingLogs: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Logs traitement (OCR, validation, etc.)'
    },
    
    checksum: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Checksum MD5/SHA256 pour intégrité'
    },
    
    // 📊 BUSINESS METRICS
    businessValue: {
  type: DataTypes.STRING,
  allowNull: false,
  defaultValue: 'medium',
  validate: {
    isIn: [['low', 'medium', 'high', 'critical']]
  },
  comment: 'Importance business du document'
},
    
    generationCost: {
      type: DataTypes.DECIMAL(6, 2),
      defaultValue: 0.00,
      comment: 'Coût génération (API, processing)'
    }
    
  }, {
    sequelize,
    modelName: 'Document',
    tableName: 'documents',
    underscored: true,
    timestamps: true,
    paranoid: true, // Soft delete
    
    hooks: {
      beforeCreate: (document) => {
        // Générer numéro document unique
        if (!document.documentNumber) {
          const date = new Date();
          const year = date.getFullYear();
          const month = (date.getMonth() + 1).toString().padStart(2, '0');
          const day = date.getDate().toString().padStart(2, '0');
          const timestamp = Date.now().toString().slice(-6);
          document.documentNumber = `DOC${year}${month}${day}${timestamp}`;
        }
        
        // Extraire extension du filename
        if (!document.fileExtension && document.fileName) {
          const parts = document.fileName.split('.');
          document.fileExtension = parts.length > 1 ? parts.pop().toLowerCase() : '';
        }
        
        // Générer checksum si pas fourni
        if (!document.checksum && document.fileUrl) {
          // TODO: Implémenter génération checksum
          document.checksum = `temp_${Date.now()}`;
        }
        
        // Tags automatiques selon type
        if (!document.tags || document.tags.length === 0) {
          const autoTags = [];
          if (document.type.includes('association')) autoTags.push('association');
          if (document.type.includes('kyc')) autoTags.push('kyc');
          if (document.type.includes('attestation')) autoTags.push('attestation');
          if (document.type.includes('tontine')) autoTags.push('tontine');
          autoTags.push(new Date().getFullYear().toString());
          
          document.tags = autoTags;
        }
      },
      
      beforeUpdate: (document) => {
        // Mettre à jour version si fichier changé
        if (document.changed('fileUrl')) {
          document.version = (document.version || 1) + 1;
          
          // Ajouter à historique versions
          const history = document.versionHistory || [];
          history.push({
            version: document.version - 1,
            fileUrl: document._previousDataValues.fileUrl,
            updatedAt: new Date(),
            updatedBy: document.userId
          });
          document.versionHistory = history;
        }
        
        // Marquer comme expiré si date dépassée
        if (document.expiresAt && new Date() > document.expiresAt && document.status !== 'expired') {
          document.status = 'expired';
        }
      },
      
      afterCreate: (document) => {
        console.log(`📄 Document créé: ${document.documentNumber} - ${document.title} (${document.type})`);
      },
      
      afterUpdate: async (document) => {
        // Incrémenter compteur accès si consulté
        if (document.changed('lastAccessedAt')) {
          await document.increment('downloadCount');
        }
        
        // Notification expiration si nécessaire
        if (document.status === 'expired' && !document.expiryNotificationSent) {
          // TODO: Implémenter notification expiration
          console.log(`📅 Document expiré: ${document.title}`);
          document.expiryNotificationSent = true;
          await document.save();
        }
      }
    },
    
    indexes: [
      { fields: ['document_number'], unique: true },
      { fields: ['user_id'] },
      { fields: ['association_id'] },
      { fields: ['tontine_id'] },
      { fields: ['membership_id'] },
      { fields: ['participant_id'] },
      { fields: ['type'] },
      { fields: ['status'] },
      { fields: ['access_level'] },
      { fields: ['expires_at'] },
      { fields: ['is_signed'] },
      { fields: ['legal_value'] },
      { fields: ['gdpr_category'] },
      { fields: ['created_at'] },
      { fields: ['validated_at'] },
      // Index composés pour requêtes business
      { fields: ['type', 'status'] },
      { fields: ['user_id', 'type'] },
      { fields: ['association_id', 'type', 'status'] },
      { fields: ['expires_at', 'auto_notify_expiry'] }
    ]
  });

  return Document;
};