//src\modules\associations\controllers\memberController.js

const {
  Association,
  AssociationMember,
  Section,
  User,
  Transaction,
  sequelize,
} = require("../../../models");
const { Op } = require("sequelize");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { hasPermission } = require("../../../core/middleware/checkPermission");

// 📄 HELPER : GÉNÉRER LE CONTENU D'UN PDF
// ✅ Fonction standalone (pas une méthode de classe)
function generateMembersPDF(doc, association, members, rolesConfig, filters) {
  const { sectionId, memberType, status, search, partNumber, totalParts } = filters;

  // Dimensions pour paysage A4
  const pageWidth = 842; // A4 paysage
  const pageHeight = 595;
  const margin = 30;
  const usableWidth = pageWidth - (margin * 2);

  // EN-TÊTE avec logo (si disponible)
  let startY = margin;
  
  if (association.theme?.logo) {
    try {
      doc.image(association.theme.logo, margin, startY, { width: 40, height: 40 });
      startY += 50;
    } catch (err) {
      console.warn("Impossible de charger le logo:", err.message);
    }
  }

  // Titre principal
  doc
    .fontSize(18)
    .font("Helvetica-Bold")
    .text(association.name, margin, startY, { 
      align: "center",
      width: usableWidth 
    });
  startY += 25;

  // Sous-titre
  doc
    .fontSize(14)
    .font("Helvetica")
    .text("Liste des Membres", margin, startY, { 
      align: "center",
      width: usableWidth 
    });
  startY += 20;

  // Date d'export
  doc
    .fontSize(9)
    .text(
      `Exporté le ${new Date().toLocaleDateString("fr-FR", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      })}`,
      margin,
      startY,
      { align: "center", width: usableWidth }
    );
  startY += 15;

  // Si multi-parties
  if (partNumber && totalParts) {
    doc
      .fontSize(9)
      .fillColor("#666")
      .text(`Partie ${partNumber} sur ${totalParts}`, margin, startY, { 
        align: "center",
        width: usableWidth 
      })
      .fillColor("#000");
    startY += 15;
  }

  // Filtres appliqués
  const appliedFilters = [];
  if (status && status !== "all") appliedFilters.push(`Statut: ${status}`);
  if (memberType) appliedFilters.push(`Type: ${memberType}`);
  if (sectionId) appliedFilters.push(`Section ID: ${sectionId}`);
  if (search) appliedFilters.push(`Recherche: "${search}"`);

  if (appliedFilters.length > 0) {
    doc
      .fontSize(8)
      .fillColor("#666")
      .text(`Filtres: ${appliedFilters.join(" | ")}`, margin, startY, { 
        align: "center",
        width: usableWidth 
      })
      .fillColor("#000");
    startY += 15;
  }

  // Ligne de séparation horizontale
  doc
    .strokeColor("#2c5530")
    .lineWidth(2)
    .moveTo(margin, startY)
    .lineTo(pageWidth - margin, startY)
    .stroke();
  startY += 10;

  // ✅ TABLEAU AVEC LIGNES ET COLONNES

  // Largeurs des colonnes (ajustées pour paysage)
  const colWidths = association.isMultiSection 
  ? {
      numero: 40,
      name: 150,
      contact: 150,
      type: 80,
      roles: 150,
      section: 132,
      status: 80,
    }
  : {
      numero: 40,
      name: 170,
      contact: 170,
      type: 100,
      roles: 222,
      section: 0,
      status: 80,
    };

  // Calculer positions X
  const colPositions = {
    numero: margin,
    name: margin + colWidths.numero,
    contact: margin + colWidths.numero + colWidths.name,
    type: margin + colWidths.numero + colWidths.name + colWidths.contact,
    roles: margin + colWidths.numero + colWidths.name + colWidths.contact + colWidths.type,
    section: margin + colWidths.numero + colWidths.name + colWidths.contact + colWidths.type + colWidths.roles,
    status: association.isMultiSection 
      ? margin + colWidths.numero + colWidths.name + colWidths.contact + colWidths.type + colWidths.roles + colWidths.section
      : margin + colWidths.numero + colWidths.name + colWidths.contact + colWidths.type + colWidths.roles,
  };

  const tableEndX = association.isMultiSection 
    ? colPositions.status + colWidths.status
    : colPositions.status + colWidths.status;

  // Hauteur de ligne
  const rowHeight = 30;

  // ✅ EN-TÊTE DU TABLEAU avec fond coloré
  const headerY = startY;
  
  // Fond coloré pour l'en-tête
  doc
    .rect(margin, headerY, tableEndX - margin, rowHeight)
    .fillAndStroke("#2c5530", "#2c5530");

  // Texte en-tête
  doc
    .fontSize(9)
    .font("Helvetica-Bold")
    .fillColor("#FFFFFF");

  let currentX = colPositions.numero;
  doc.text("N°", currentX + 5, headerY + 10, { width: colWidths.numero - 10 });
  
  currentX = colPositions.name;
  doc.text("Nom Complet", currentX + 5, headerY + 10, { width: colWidths.name - 10 });
  
  currentX = colPositions.contact;
  doc.text("Contact", currentX + 5, headerY + 10, { width: colWidths.contact - 10 });
  
  currentX = colPositions.type;
  doc.text("Type", currentX + 5, headerY + 10, { width: colWidths.type - 10 });
  
  currentX = colPositions.roles;
  doc.text("Rôles", currentX + 5, headerY + 10, { width: colWidths.roles - 10 });
  
  if (association.isMultiSection) {
    currentX = colPositions.section;
    doc.text("Section", currentX + 5, headerY + 10, { width: colWidths.section - 10 });
  }
  
  currentX = colPositions.status;
  doc.text("Statut", currentX + 5, headerY + 10, { width: colWidths.status - 10 });

  doc.fillColor("#000").font("Helvetica");

  let currentY = headerY + rowHeight;

  // ✅ LIGNES DES MEMBRES avec alternance de couleurs
  members.forEach((member, index) => {
    // Vérifier si on doit changer de page
    if (currentY + rowHeight > pageHeight - margin - 40) {
      doc.addPage({ 
        margin: 30,
        size: 'A4',
        layout: 'landscape' 
      });
      currentY = margin;

      // Redessiner l'en-tête sur la nouvelle page
      doc
        .rect(margin, currentY, tableEndX - margin, rowHeight)
        .fillAndStroke("#2c5530", "#2c5530");

      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .fillColor("#FFFFFF");

      currentX = colPositions.numero;
      doc.text("N°", currentX + 5, currentY + 10, { width: colWidths.numero - 10 });
      currentX = colPositions.name;
      doc.text("Nom Complet", currentX + 5, currentY + 10, { width: colWidths.name - 10 });
      currentX = colPositions.contact;
      doc.text("Contact", currentX + 5, currentY + 10, { width: colWidths.contact - 10 });
      currentX = colPositions.type;
      doc.text("Type", currentX + 5, currentY + 10, { width: colWidths.type - 10 });
      currentX = colPositions.roles;
      doc.text("Rôles", currentX + 5, currentY + 10, { width: colWidths.roles - 10 });
      
      if (association.isMultiSection) {
        currentX = colPositions.section;
        doc.text("Section", currentX + 5, currentY + 10, { width: colWidths.section - 10 });
      }
      
      currentX = colPositions.status;
      doc.text("Statut", currentX + 5, currentY + 10, { width: colWidths.status - 10 });

      doc.fillColor("#000").font("Helvetica");
      currentY += rowHeight;
    }

    // ✅ Alternance de couleurs pour les lignes
    if (index % 2 === 0) {
      doc
        .rect(margin, currentY, tableEndX - margin, rowHeight)
        .fill("#F9FAFB");
    }

    // Numéro
    doc
      .fontSize(8)
      .fillColor("#000")
      .text(
        (index + 1).toString(),
        colPositions.numero + 5,
        currentY + 10,
        { width: colWidths.numero - 10, align: "center" }
      );

    // Nom
    doc.text(
      `${member.user.firstName} ${member.user.lastName}`,
      colPositions.name + 5,
      currentY + 10,
      { width: colWidths.name - 10, ellipsis: true }
    );

    // Contact
    const contact = member.user.phoneNumber || member.user.email || "-";
    doc.text(contact, colPositions.contact + 5, currentY + 10, {
      width: colWidths.contact - 10,
      ellipsis: true,
    });

    // Type
    doc.text(member.memberType || "-", colPositions.type + 5, currentY + 10, {
      width: colWidths.type - 10,
      ellipsis: true,
    });

    // Rôles
    const roleNames =
      member.assignedRoles && member.assignedRoles.length > 0
        ? member.assignedRoles
            .map((roleId) => {
              const role = rolesConfig.find((r) => r.id === roleId);
              return role?.name || roleId;
            })
            .join(", ")
        : "-";
    doc.text(roleNames, colPositions.roles + 5, currentY + 10, {
      width: colWidths.roles - 10,
      ellipsis: true,
    });

    // Section (si multi-sections)
    if (association.isMultiSection) {
      doc.text(member.section?.name || "-", colPositions.section + 5, currentY + 10, {
        width: colWidths.section - 10,
        ellipsis: true,
      });
    }

    // Statut
    const statusLabel =
      {
        active: "Actif",
        pending: "En attente",
        inactive: "Inactif",
        suspended: "Suspendu",
      }[member.status] || member.status;
    doc.text(statusLabel, colPositions.status + 5, currentY + 10, {
      width: colWidths.status - 10,
      ellipsis: true,
    });

    // ✅ LIGNES HORIZONTALES
    doc
      .strokeColor("#E5E7EB")
      .lineWidth(0.5)
      .moveTo(margin, currentY + rowHeight)
      .lineTo(tableEndX, currentY + rowHeight)
      .stroke();

    currentY += rowHeight;
  });

  // ✅ LIGNES VERTICALES (colonnes)
  doc.strokeColor("#E5E7EB").lineWidth(0.5);

  // Calculer hauteur totale du tableau
  const tableStartY = headerY;
  const tableHeight = currentY - tableStartY;

  // Dessiner les séparateurs verticaux
  Object.values(colPositions).forEach((xPos) => {
    doc
      .moveTo(xPos, tableStartY)
      .lineTo(xPos, currentY)
      .stroke();
  });

  // Dernière ligne verticale (bord droit)
  doc
    .moveTo(tableEndX, tableStartY)
    .lineTo(tableEndX, currentY)
    .stroke();

  // ✅ Footer avec total et signature
  currentY += 20;
  
  doc
    .fontSize(10)
    .font("Helvetica-Bold")
    .fillColor("#2c5530")
    .text(`Total: ${members.length} membre(s)`, margin, currentY, { 
      align: "left",
      width: usableWidth / 2 
    });

  doc
    .fontSize(8)
    .font("Helvetica")
    .fillColor("#666")
    .text(
      `Document généré par DiasporaTontine`,
      margin + (usableWidth / 2),
      currentY,
      { align: "right", width: usableWidth / 2 }
    )
    .fillColor("#000");
}


class MemberController {
  // 👥 AJOUTER MEMBRE À ASSOCIATION
   

  async addMember(req, res) {
  try {
    const { associationId } = req.params;
    const {
      userId,
      firstName,
      lastName,
      phoneNumber,
      email,
      dateOfBirth,
      gender,
      address,
      city,
      country,
      postalCode,
      memberType,
      sectionId,
      status = "pending",
      cotisationAmount,
      assignedRoles,
      autoPaymentEnabled,
      paymentMethodId,
      profession,
      emergencyContact,
      notes,
    } = req.body;

    // Vérifier accès association avec permissions
    const membership = await AssociationMember.findOne({
      where: {
        userId: req.user.id,
        associationId,
        status: "active",
      },
      include: [
        {
          model: Association,
          as: "association",
          attributes: ["rolesConfiguration"],
        },
      ],
    });

    // Vérifier permissions avec RBAC moderne
    const canAddMember =
      membership?.isAdmin ||
      hasPermission(membership, "manage_members") ||
      req.user.role === "super_admin";

    if (!canAddMember) {
      return res.status(403).json({
        error: "Permission insuffisante pour ajouter un membre",
        code: "ADD_MEMBER_DENIED",
        required: "manage_members",
      });
    }

    // Déterminer l'utilisateur cible
    let targetUser;

    if (userId) {
      // Cas 1: userId fourni explicitement
      targetUser = await User.findByPk(userId);
      if (!targetUser) {
        return res.status(404).json({
          error: "Utilisateur introuvable",
          code: "USER_NOT_FOUND",
        });
      }
    } else if (firstName && lastName && phoneNumber) {
      // Cas 2: Créer un nouveau membre avec ses infos
      targetUser = await User.findOne({
        where: { phoneNumber: phoneNumber.trim() },
      });

      if (!targetUser) {
        targetUser = await User.create({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phoneNumber: phoneNumber.trim(),
          email: email ? email.trim() : null,
          dateOfBirth: dateOfBirth || null,
          gender: gender || null,
          address: address ? address.trim() : null,
          city: city ? city.trim() : null,
          country: country || "FR",
          postalCode: postalCode ? postalCode.trim() : null,
          status: "pending_verification",
        });

        console.log(`✅ Nouvel utilisateur créé:`, {
          id: targetUser.id,
          firstName: targetUser.firstName,
          lastName: targetUser.lastName,
          phoneNumber: targetUser.phoneNumber,
        });
      } else {
        console.log(`✅ Utilisateur existant trouvé: ${targetUser.firstName} ${targetUser.lastName}`);
      }
    } else {
      // ✅ CAS 3: Aucun userId/infos fourni → utiliser l'utilisateur courant (req.user.id)
      console.log(`🔄 Aucun userId/infos fourni → utilisation req.user.id (${req.user.id})`);
      
      targetUser = await User.findByPk(req.user.id);
      if (!targetUser) {
        return res.status(404).json({
          error: "Utilisateur courant introuvable",
          code: "CURRENT_USER_NOT_FOUND",
        });
      }
      
      console.log(`✅ Utilisateur courant trouvé: ${targetUser.firstName} ${targetUser.lastName}`);
    }

    // ============================================
    // ✅ VÉRIFIER SI DÉJÀ MEMBRE
    // ============================================
    const existingMembership = await AssociationMember.findOne({
      where: {
        userId: targetUser.id,
        associationId,
      },
    });

    if (existingMembership) {
      // ✅ CAS SPÉCIAL : Admin externe qui devient membre interne
      if (existingMembership.isAdmin && !existingMembership.isMemberOfAssociation) {
        console.log(`🔄 Conversion admin externe → membre interne pour userId ${targetUser.id}`);

        // Récupérer config association pour validation
        const association = await Association.findByPk(associationId);
        const memberTypesConfig = association.memberTypes || [];
        const memberTypeExists = memberTypesConfig.find(
          (type) => type.name === memberType
        );

        if (!memberTypeExists) {
          return res.status(400).json({
            error: "Type de membre invalide",
            code: "INVALID_MEMBER_TYPE",
            available: memberTypesConfig.map((type) => type.name),
          });
        }

        // Valider les rôles assignés
        if (assignedRoles && assignedRoles.length > 0) {
          const rolesConfig = association.rolesConfiguration?.roles || [];
          const invalidRoles = assignedRoles.filter(
            (roleId) => !rolesConfig.find((r) => r.id === roleId)
          );

          if (invalidRoles.length > 0) {
            return res.status(400).json({
              error: "Rôles invalides",
              code: "INVALID_ROLES",
              invalidRoles,
              availableRoles: rolesConfig.map((r) => ({ id: r.id, name: r.name })),
            });
          }

          // ✅ NOUVEAU : Vérifier les rôles uniques
          const uniqueRolesToAssign = assignedRoles.filter((roleId) => {
            const role = rolesConfig.find((r) => r.id === roleId);
            return role?.isUnique === true;
          });

          if (uniqueRolesToAssign.length > 0) {
            const existingMembers = await AssociationMember.findAll({
              where: {
                associationId,
                status: 'active',
                id: { [Op.ne]: existingMembership.id }, // Exclure le membre actuel
              },
              attributes: ['id', 'assignedRoles'],
              include: [
                {
                  model: User,
                  as: 'user',
                  attributes: ['firstName', 'lastName'],
                },
              ],
            });

            const conflicts = [];
            
            for (const uniqueRoleId of uniqueRolesToAssign) {
              const conflictMember = existingMembers.find((m) =>
                m.assignedRoles?.includes(uniqueRoleId)
              );

              if (conflictMember) {
                const roleName = rolesConfig.find((r) => r.id === uniqueRoleId)?.name;
                conflicts.push({
                  roleId: uniqueRoleId,
                  roleName,
                  assignedTo: `${conflictMember.user.firstName} ${conflictMember.user.lastName}`,
                  memberId: conflictMember.id,
                });
              }
            }

            if (conflicts.length > 0) {
              return res.status(400).json({
                error: "Rôle(s) unique(s) déjà attribué(s)",
                code: "UNIQUE_ROLE_CONFLICT",
                conflicts,
              });
            }
          }
        }

        // Déterminer montant cotisation
        const finalCotisationAmount =
          cotisationAmount !== undefined ? cotisationAmount : memberTypeExists.cotisationAmount;

        // ✅ METTRE À JOUR le membership existant
        await existingMembership.update({
          memberType,
          assignedRoles: assignedRoles || [],
          cotisationAmount: finalCotisationAmount,
          isMemberOfAssociation: true,
          status: status || "pending",
          approvedDate: status === "active" ? new Date() : null,
          approvedBy: status === "active" ? req.user.id : null,
          autoPaymentEnabled: autoPaymentEnabled || false,
          paymentMethodId: paymentMethodId || null,
          sectionId: sectionId || null,
        });

        console.log(`✅ Admin converti en membre avec succès - Type: ${memberType}, Rôles: ${assignedRoles?.length || 0}`);

        // Charger membre complet pour retour
        const memberComplete = await AssociationMember.findByPk(existingMembership.id, {
          include: [
            {
              model: User,
              as: "user",
              attributes: [
                "id",
                "firstName",
                "lastName",
                "phoneNumber",
                "email",
                "dateOfBirth",
                "gender",
                "address",
                "city",
                "country",
                "postalCode",
              ],
            },
            {
              model: Section,
              as: "section",
              attributes: ["id", "name", "country"],
            },
            { model: Association, as: "association", attributes: ["id", "name"] },
          ],
        });

        return res.status(200).json({
          success: true,
          message: "Admin converti en membre interne avec succès",
          data: { member: memberComplete },
        });
      }

      // ❌ Sinon, c'est vraiment un doublon
      return res.status(400).json({
        error: "Cet utilisateur est déjà membre de l'association",
        code: "ALREADY_MEMBER",
        currentStatus: existingMembership.status,
        isMemberOfAssociation: existingMembership.isMemberOfAssociation,
      });
    }

    // ============================================
    // ✅ CRÉER NOUVEAU MEMBRE
    // ============================================

    // Récupérer config association pour validation
    const association = await Association.findByPk(associationId);
    const memberTypesConfig = association.memberTypes || [];
    const memberTypeExists = memberTypesConfig.find(
      (type) => type.name === memberType
    );

    if (!memberTypeExists) {
      return res.status(400).json({
        error: "Type de membre invalide",
        code: "INVALID_MEMBER_TYPE",
        available: memberTypesConfig.map((type) => type.name),
      });
    }

    // Si section spécifiée, vérifier qu'elle existe
    if (sectionId) {
      const section = await Section.findOne({
        where: { id: sectionId, associationId },
      });

      if (!section) {
        return res.status(404).json({
          error: "Section introuvable",
          code: "SECTION_NOT_FOUND",
        });
      }
    }

    // Valider les rôles assignés
    if (assignedRoles && assignedRoles.length > 0) {
      const rolesConfig = association.rolesConfiguration?.roles || [];
      const invalidRoles = assignedRoles.filter(
        (roleId) => !rolesConfig.find((r) => r.id === roleId)
      );

      if (invalidRoles.length > 0) {
        return res.status(400).json({
          error: "Rôles invalides",
          code: "INVALID_ROLES",
          invalidRoles,
          availableRoles: rolesConfig.map((r) => ({ id: r.id, name: r.name })),
        });
      }

      // ✅ NOUVEAU : Vérifier les rôles uniques
      const uniqueRolesToAssign = assignedRoles.filter((roleId) => {
        const role = rolesConfig.find((r) => r.id === roleId);
        return role?.isUnique === true;
      });

      if (uniqueRolesToAssign.length > 0) {
        const existingMembers = await AssociationMember.findAll({
          where: {
            associationId,
            status: 'active',
          },
          attributes: ['id', 'assignedRoles'],
          include: [
            {
              model: User,
              as: 'user',
              attributes: ['firstName', 'lastName'],
            },
          ],
        });

        const conflicts = [];
        
        for (const uniqueRoleId of uniqueRolesToAssign) {
          const conflictMember = existingMembers.find((m) =>
            m.assignedRoles?.includes(uniqueRoleId)
          );

          if (conflictMember) {
            const roleName = rolesConfig.find((r) => r.id === uniqueRoleId)?.name;
            conflicts.push({
              roleId: uniqueRoleId,
              roleName,
              assignedTo: `${conflictMember.user.firstName} ${conflictMember.user.lastName}`,
              memberId: conflictMember.id,
            });
          }
        }

        if (conflicts.length > 0) {
          return res.status(400).json({
            error: "Rôle(s) unique(s) déjà attribué(s)",
            code: "UNIQUE_ROLE_CONFLICT",
            conflicts,
          });
        }
      }

      console.log(
        `✅ Rôles validés:`,
        assignedRoles.map(
          (roleId) => rolesConfig.find((r) => r.id === roleId)?.name
        )
      );
    }

    // Déterminer montant cotisation
    const finalCotisationAmount =
      cotisationAmount !== undefined ? cotisationAmount : memberTypeExists.cotisationAmount;

    // ✅ Créer membre avec assignedRoles
    const member = await AssociationMember.create({
      userId: targetUser.id,
      associationId,
      sectionId,
      memberType,
      profession,
      emergencyContact,
      notes,
      status: "active",
      cotisationAmount: finalCotisationAmount,
      autoPaymentEnabled: autoPaymentEnabled || false,
      paymentMethodId: paymentMethodId || null,
      joinDate: new Date(),
      approvedDate: status === "active" ? new Date() : null,
      approvedBy: status === "active" ? req.user.id : null,
      isMemberOfAssociation: true,
      isAdmin: false,
      assignedRoles: assignedRoles || [],
      customPermissions: { granted: [], revoked: [] },
    });

    console.log(
      `✅ Membre créé avec ${assignedRoles?.length || 0} rôle(s):`,
      assignedRoles
    );

    // Charger membre complet pour retour
    const memberComplete = await AssociationMember.findByPk(member.id, {
      include: [
        {
          model: User,
          as: "user",
          attributes: [
            "id",
            "firstName",
            "lastName",
            "phoneNumber",
            "email",
            "dateOfBirth",
            "gender",
            "address",
            "city",
            "country",
            "postalCode",
          ],
        },
        {
          model: Section,
          as: "section",
          attributes: ["id", "name", "country"],
        },
        { model: Association, as: "association", attributes: ["id", "name"] },
      ],
    });

    res.status(201).json({
      success: true,
      message: "Membre ajouté avec succès",
      data: { member: memberComplete },
    });
  } catch (error) {
    console.error("❌ Erreur ajout membre:", error);
    res.status(500).json({
      error: "Erreur ajout membre",
      code: "ADD_MEMBER_ERROR",
      details: error.message,
    });
  }
}

  async updateMember(req, res) {
  try {
    const { associationId, memberId } = req.params;
    const {
      memberType,
      status,
      sectionId,
      assignedRoles,
      cotisationAmount,
      autoPaymentEnabled,
      paymentMethodId,
    } = req.body;

    // Vérifier accès association avec permissions
    const membership = await AssociationMember.findOne({
      where: {
        userId: req.user.id,
        associationId,
        status: "active",
      },
      include: [
        {
          model: Association,
          as: "association",
          attributes: ["rolesConfiguration", "memberTypes"],
        },
      ],
    });

    const canUpdateMember =
      membership?.isAdmin ||
      hasPermission(membership, "manage_members") ||
      req.user.role === "super_admin";

    if (!canUpdateMember) {
      return res.status(403).json({
        error: "Permission insuffisante pour modifier un membre",
        code: "UPDATE_MEMBER_DENIED",
        required: "manage_members",
      });
    }

    // Récupérer le membre à modifier
    const memberToUpdate = await AssociationMember.findOne({
      where: {
        id: memberId,
        associationId,
      },
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "firstName", "lastName", "phoneNumber"],
        },
      ],
    });

    if (!memberToUpdate) {
      return res.status(404).json({
        error: "Membre introuvable",
        code: "MEMBER_NOT_FOUND",
      });
    }

    // Protection admin : vérifier s'il reste d'autres admins
    if (memberToUpdate.isAdmin && status === "suspended") {
      const otherAdmins = await AssociationMember.count({
        where: {
          associationId,
          status: "active",
          isAdmin: true,
          id: { [Op.ne]: memberId },
        },
      });

      if (otherAdmins === 0) {
        return res.status(400).json({
          error: "Impossible de suspendre : aucun autre administrateur actif",
          code: "LAST_ADMIN_PROTECTION",
        });
      }
    }

    // Vérifier section si fournie
    if (sectionId) {
      const sectionExists = await Section.findOne({
        where: { id: sectionId, associationId },
      });

      if (!sectionExists) {
        return res.status(400).json({
          error: "Section introuvable",
          code: "SECTION_NOT_FOUND",
        });
      }
    }

    // Préparer les données de mise à jour
    const updateData = {};

    if (memberType !== undefined) {
      const memberTypesConfig = membership.association.memberTypes || [];
      const memberTypeExists = memberTypesConfig.find((t) => t.name === memberType);

      if (!memberTypeExists) {
        return res.status(400).json({
          error: "Type de membre invalide",
          code: "INVALID_MEMBER_TYPE",
          available: memberTypesConfig.map((t) => t.name),
        });
      }

      updateData.memberType = memberType;
      if (cotisationAmount === undefined) {
        updateData.cotisationAmount = memberTypeExists.cotisationAmount;
      }
    }

    if (status !== undefined) updateData.status = status;
    if (sectionId !== undefined) updateData.sectionId = sectionId;
    if (cotisationAmount !== undefined) updateData.cotisationAmount = cotisationAmount;
    if (autoPaymentEnabled !== undefined) updateData.autoPaymentEnabled = autoPaymentEnabled;
    if (paymentMethodId !== undefined) updateData.paymentMethodId = paymentMethodId;

    // Valider et mettre à jour les rôles
    if (assignedRoles !== undefined) {
      const rolesConfig = membership.association.rolesConfiguration?.roles || [];
      const invalidRoles = assignedRoles.filter(
        (roleId) => !rolesConfig.find((r) => r.id === roleId)
      );

      if (invalidRoles.length > 0) {
        return res.status(400).json({
          error: "Rôles invalides",
          code: "INVALID_ROLES",
          invalidRoles,
          availableRoles: rolesConfig.map((r) => ({ id: r.id, name: r.name })),
        });
      }

      // ✅ NOUVEAU : Vérifier les rôles uniques
      const uniqueRolesToAssign = assignedRoles.filter((roleId) => {
        const role = rolesConfig.find((r) => r.id === roleId);
        return role?.isUnique === true;
      });

      if (uniqueRolesToAssign.length > 0) {
        const existingMembers = await AssociationMember.findAll({
          where: {
            associationId,
            status: 'active',
            id: { [Op.ne]: memberId }, // Exclure le membre qu'on modifie
          },
          attributes: ['id', 'assignedRoles'],
          include: [
            {
              model: User,
              as: 'user',
              attributes: ['firstName', 'lastName'],
            },
          ],
        });

        const conflicts = [];
        
        for (const uniqueRoleId of uniqueRolesToAssign) {
          const conflictMember = existingMembers.find((m) =>
            m.assignedRoles?.includes(uniqueRoleId)
          );

          if (conflictMember) {
            const roleName = rolesConfig.find((r) => r.id === uniqueRoleId)?.name;
            conflicts.push({
              roleId: uniqueRoleId,
              roleName,
              assignedTo: `${conflictMember.user.firstName} ${conflictMember.user.lastName}`,
              memberId: conflictMember.id,
            });
          }
        }

        if (conflicts.length > 0) {
          return res.status(400).json({
            error: "Rôle(s) unique(s) déjà attribué(s)",
            code: "UNIQUE_ROLE_CONFLICT",
            conflicts,
          });
        }
      }

      updateData.assignedRoles = assignedRoles;
    }

    // Mettre à jour le membre
    await memberToUpdate.update(updateData);

    // Charger membre mis à jour
    const updatedMember = await AssociationMember.findByPk(memberToUpdate.id, {
      include: [
        {
          model: User,
          as: "user",
          attributes: [
            "id",
            "firstName",
            "lastName",
            "phoneNumber",
            "email",
            "profilePicture",
          ],
        },
        {
          model: Section,
          as: "section",
          attributes: ["id", "name", "country"],
        },
      ],
    });

    res.json({
      success: true,
      message: "Membre mis à jour avec succès",
      data: { member: updatedMember },
    });
  } catch (error) {
    console.error("❌ Erreur modification membre:", error);
    res.status(500).json({
      error: "Erreur modification membre",
      code: "UPDATE_MEMBER_ERROR",
      details: error.message,
    });
  }
}

  // 📋 LISTER MEMBRES ASSOCIATION
async listMembers(req, res) {
  try {
    const { associationId } = req.params;
    const {
      sectionId,
      memberType,
      status = "all",
      page = 1,
      limit = 50,
      search,
    } = req.query;

    // ✅ Le middleware checkPermission a déjà vérifié les permissions
    // ✅ On peut utiliser directement req.membership si besoin
    
    // ✅ Filtrer UNIQUEMENT les membres réels (isMemberOfAssociation: true)
    const whereClause = {
      associationId,
      isMemberOfAssociation: true,
    };

    if (sectionId) whereClause.sectionId = sectionId;
    if (status !== "all") whereClause.status = status;
    if (memberType) whereClause.memberType = memberType;

    const offset = (page - 1) * limit;

    const includes = [
      {
        model: User,
        as: "user",
        attributes: [
          "id",
          "firstName",
          "lastName",
          "phoneNumber",
          "email",
          'country',
          'city', 
          'address', 
          'dateOfBirth'
        ],
        ...(search && {
          where: {
            [Op.or]: [
              { firstName: { [Op.iLike]: `%${search}%` } },
              { lastName: { [Op.iLike]: `%${search}%` } },
              { phoneNumber: { [Op.iLike]: `%${search}%` } },
            ],
          },
        }),
      },
      {
        model: Section,
        as: "section",
        attributes: ["id", "name", "country", "city"],
        required: false,
      },
    ];

    const { rows: members, count } = await AssociationMember.findAndCountAll({
      where: whereClause,
      include: includes,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["joinDate", "DESC"]],
    });

    res.json({
      success: true,
      data: {
        members,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(count / limit),
        },
      },
    });
  } catch (error) {
    console.error("❌ Erreur liste membres:", error);
    res.status(500).json({
      error: "Erreur liste membres",
      code: "LIST_MEMBERS_ERROR",
      details: error.message,
    });
  }
}

  // 💰 PAYER COTISATION (CB PRIORITAIRE)
  async payCotisation(req, res) {
    try {
      const {
        associationId,
        amount,
        month,
        year,
        paymentMethodId,
        sectionId,
        description,
      } = req.body;

      // Vérifier membership
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
        include: [{ model: Association, as: "association" }],
      });

      if (!membership) {
        return res.status(403).json({
          error: "Membre non trouvé dans cette association",
          code: "NOT_ASSOCIATION_MEMBER",
        });
      }

      // Vérifier si cotisation déjà payée ce mois
      const existingPayment = await Transaction.findOne({
        where: {
          memberId: membership.id,
          type: "cotisation",
          month,
          year,
          status: "completed",
        },
      });

      if (existingPayment) {
        return res.status(400).json({
          error: "Cotisation déjà payée pour cette période",
          code: "COTISATION_ALREADY_PAID",
          transactionId: existingPayment.id,
        });
      }

      // Calculer commission (2.5% + 0.25€)
      const commissionAmount = parseFloat((amount * 0.025 + 0.25).toFixed(2));
      const netAmount = parseFloat((amount - commissionAmount).toFixed(2));

      // Créer transaction en attente
      const transaction = await Transaction.create({
        userId: req.user.id,
        associationId,
        sectionId,
        memberId: membership.id,
        type: "cotisation",
        amount,
        commissionAmount,
        netAmount,
        currency: membership.association.currency || "EUR",
        month,
        year,
        paymentMethod: "card",
        paymentMethodId,
        status: "pending",
        description: description || `Cotisation ${month}/${year}`,
        source: "app",
      });

      try {
        // Traitement paiement Stripe
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(amount * 100),
          currency: "eur",
          payment_method: paymentMethodId,
          confirm: true,
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: "never",
          },
          metadata: {
            associationId: String(associationId),
            memberId: String(membership.id),
            type: "cotisation",
            month: String(month),
            year: String(year),
          },
        });

        // Mettre à jour transaction avec résultat Stripe
        await transaction.update({
          externalTransactionId: paymentIntent.id,
          status:
            paymentIntent.status === "succeeded" ? "completed" : "processing",
          processedAt: new Date(),
        });

        // Si succès, mettre à jour statistiques membre
        if (paymentIntent.status === "succeeded") {
          await membership.update({
            totalContributed: membership.totalContributed + amount,
            lastContributionDate: new Date(),
            contributionStatus: "uptodate",
          });

          await transaction.update({
            completedAt: new Date(),
          });
        }

        res.json({
          success: true,
          message:
            paymentIntent.status === "succeeded"
              ? "Cotisation payée avec succès"
              : "Paiement en cours",
          data: {
            transaction: {
              id: transaction.id,
              amount,
              commissionAmount,
              netAmount,
              status: transaction.status,
              month,
              year,
            },
            paymentIntent: {
              id: paymentIntent.id,
              status: paymentIntent.status,
              requiresAction: paymentIntent.status === "requires_action",
            },
          },
        });
      } catch (stripeError) {
        await transaction.update({
          status: "failed",
          failureReason: stripeError.message.substring(0, 250),
        });

        throw stripeError;
      }
    } catch (error) {
      console.error("Erreur paiement cotisation:", error);
      res.status(500).json({
        error: "Erreur traitement paiement",
        code: "PAYMENT_ERROR",
        details: error.message,
      });
    }
  }

  // 📊 HISTORIQUE COTISATIONS MEMBRE
  async getMemberCotisations(req, res) {
    try {
      const { associationId, memberId } = req.params;
      const { year, limit = 12 } = req.query;

      console.log("🔍 Récupération cotisations:", {
        associationId,
        memberId,
        year,
      });

      // Vérifier accès (le membre lui-même ou bureau)
      const [targetMember, requesterMembership] = await Promise.all([
        AssociationMember.findOne({
          where: { id: memberId, associationId },
          include: [
            {
              model: User,
              as: "user",
              attributes: ["id", "firstName", "lastName", "phoneNumber"],
            },
            {
              model: Association,
              as: "association",
              attributes: ['rolesConfiguration']
            }
          ],
        }),
        AssociationMember.findOne({
          where: {
            userId: req.user.id,
            associationId,
            status: "active",
          },
          include: [
            {
              model: Association,
              as: "association",
              attributes: ['rolesConfiguration']
            }
          ]
        }),
      ]);

      if (!targetMember) {
        return res.status(404).json({
          error: "Membre introuvable",
          code: "MEMBER_NOT_FOUND",
        });
      }

      // Vérifier permissions
      const isOwnData = targetMember.userId === req.user.id;

      // ✅ NOUVEAU : Vérifier permissions avec RBAC moderne
      const canViewFinances =
        requesterMembership?.isAdmin ||
        hasPermission(requesterMembership, "view_finances") ||
        req.user.role === "super_admin";

      if (!isOwnData && !canViewFinances) {
        return res.status(403).json({
          error: "Accès non autorisé aux données financières",
          code: "FINANCIAL_DATA_ACCESS_DENIED",
          required: "view_finances",
        });
      }

      // Construire filtres
      const whereClause = {
        memberId: parseInt(memberId),
        type: "cotisation",
      };

      if (year) {
        whereClause.year = parseInt(year);
      }

      console.log("🎯 Filtres whereClause:", whereClause);

      // Récupérer cotisations
      const cotisations = await Transaction.findAll({
        where: whereClause,
        attributes: [
          "id",
          "amount",
          "commissionAmount",
          "netAmount",
          "month",
          "year",
          "status",
          "paymentMethod",
          "created_at",
          "completedAt",
          "source",
          "description",
        ],
        limit: parseInt(limit),
        order: [
          ["year", "DESC"],
          ["month", "DESC"],
        ],
      });

      console.log(
        `✅ Trouvé ${cotisations.length} cotisations pour membre ${memberId}`
      );

      // Calculer statistiques
      const completedCotisations = cotisations.filter(
        (c) => c.status === "completed"
      );

      const stats = {
        total: cotisations.length,
        completed: completedCotisations.length,
        pending: cotisations.filter((c) => c.status === "pending").length,
        failed: cotisations.filter((c) => c.status === "failed").length,
        totalPaid: completedCotisations.reduce(
          (sum, c) => sum + parseFloat(c.amount || 0),
          0
        ),
        totalCommissions: completedCotisations.reduce(
          (sum, c) => sum + parseFloat(c.commissionAmount || 0),
          0
        ),
        totalNet: completedCotisations.reduce(
          (sum, c) => sum + parseFloat(c.netAmount || 0),
          0
        ),
      };

      // Grouper par année/mois
      const byPeriod = {};
      cotisations.forEach((cotisation) => {
        const key = `${cotisation.year}-${cotisation.month
          .toString()
          .padStart(2, "0")}`;
        if (!byPeriod[key]) {
          byPeriod[key] = {
            year: cotisation.year,
            month: cotisation.month,
            cotisations: [],
            totalAmount: 0,
            status: "incomplete",
          };
        }
        byPeriod[key].cotisations.push(cotisation);
        if (cotisation.status === "completed") {
          byPeriod[key].totalAmount += parseFloat(cotisation.amount || 0);
          byPeriod[key].status = "completed";
        }
      });

      res.json({
        success: true,
        data: {
          member: {
            id: targetMember.id,
            user: {
              id: targetMember.user.id,
              firstName: targetMember.user.firstName,
              lastName: targetMember.user.lastName,
              fullName: `${targetMember.user.firstName} ${targetMember.user.lastName}`,
              phoneNumber: targetMember.user.phoneNumber,
            },
            memberType: targetMember.memberType,
            cotisationAmount: targetMember.cotisationAmount,
          },
          cotisations,
          stats,
          byPeriod: Object.values(byPeriod).sort((a, b) => {
            if (a.year !== b.year) return b.year - a.year;
            return b.month - a.month;
          }),
          filters: { year, limit },
        },
      });
    } catch (error) {
      console.error("❌ Erreur récupération historique cotisations:", error);
      res.status(500).json({
        error: "Erreur récupération historique cotisations",
        code: "COTISATIONS_FETCH_ERROR",
        details: error.message,
      });
    }
  }

  // 🔄 MODIFIER STATUT MEMBRE
  async updateMemberStatus(req, res) {
    try {
      const { associationId, memberId } = req.params;
      const { status, reason, newMemberType, newSectionId } = req.body;

      // Vérifier permissions
      const requesterMembership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
      });

      const canModifyStatus =
        requesterMembership &&
        (["president", "central_board", "secretaire"].includes(
          requesterMembership.roles?.[0]
        ) ||
          req.user.role === "super_admin");

      if (!canModifyStatus) {
        return res.status(403).json({
          error: "Permissions insuffisantes pour modifier statut membre",
          code: "INSUFFICIENT_MODIFY_PERMISSIONS",
        });
      }

      // Trouver le membre
      const member = await AssociationMember.findOne({
        where: { id: memberId, associationId },
        include: [{ model: User, as: "user", attributes: ["id", "fullName"] }],
      });

      if (!member) {
        return res.status(404).json({
          error: "Membre introuvable",
          code: "MEMBER_NOT_FOUND",
        });
      }

      // Empêcher auto-modification du statut
      if (
        member.userId === req.user.id &&
        ["suspended", "excluded"].includes(status)
      ) {
        return res.status(400).json({
          error: "Impossible de se suspendre/exclure soi-même",
          code: "SELF_SUSPENSION_FORBIDDEN",
        });
      }

      // Préparer mise à jour
      const updates = { status };
      if (reason) updates.suspensionReason = reason;
      if (newMemberType) updates.memberType = newMemberType;
      if (newSectionId) updates.sectionId = newSectionId;

      // Mettre à jour
      await member.update(updates);

      // Mettre à jour compteurs si changement statut actif
      if (member.status === "active" && status !== "active") {
        await Association.decrement("membersCount", {
          where: { id: associationId },
        });
        if (member.sectionId) {
          await Section.decrement("activeMembersCount", {
            where: { id: member.sectionId },
          });
        }
      } else if (member.status !== "active" && status === "active") {
        await Association.increment("membersCount", {
          where: { id: associationId },
        });
        if (member.sectionId) {
          await Section.increment("activeMembersCount", {
            where: { id: member.sectionId },
          });
        }
      }

      res.json({
        success: true,
        message: "Statut membre mis à jour avec succès",
        data: {
          member: await AssociationMember.findByPk(member.id, {
            include: [
              { model: User, as: "user", attributes: ["id", "fullName"] },
              { model: Section, as: "section", attributes: ["id", "name"] },
            ],
          }),
        },
      });
    } catch (error) {
      console.error("Erreur modification statut membre:", error);
      res.status(500).json({
        error: "Erreur modification statut membre",
        code: "MEMBER_STATUS_UPDATE_ERROR",
        details: error.message,
      });
    }
  }

 
  // 🔧 CONFIGURER PRÉLÈVEMENT AUTOMATIQUE
  async setupAutoPayment(req, res) {
    try {
      const { associationId, memberId } = req.params;
      const { paymentMethodId, enabled = true } = req.body;

      // Vérifier que c'est le membre lui-même ou bureau
      const [targetMember, requesterMembership] = await Promise.all([
        AssociationMember.findOne({
          where: { id: memberId, associationId },
        }),
        AssociationMember.findOne({
          where: {
            userId: req.user.id,
            associationId,
            status: "active",
          },
        }),
      ]);

      const isOwnAccount = targetMember?.userId === req.user.id;
      const isBureauMember =
        requesterMembership &&
        ["president", "central_board", "tresorier"].includes(
          requesterMembership.roles?.[0]
        );

      if (!isOwnAccount && !isBureauMember && req.user.role !== "super_admin") {
        return res.status(403).json({
          error: "Seul le membre ou le bureau peut configurer le prélèvement",
          code: "AUTO_PAYMENT_PERMISSION_DENIED",
        });
      }

      if (!targetMember) {
        return res.status(404).json({
          error: "Membre introuvable",
          code: "MEMBER_NOT_FOUND",
        });
      }

      // Valider méthode paiement avec Stripe si activation
      if (enabled && paymentMethodId) {
        try {
          const paymentMethod = await stripe.paymentMethods.retrieve(
            paymentMethodId
          );

          if (paymentMethod.customer !== req.user.stripeCustomerId) {
            return res.status(400).json({
              error: "Méthode paiement non autorisée",
              code: "INVALID_PAYMENT_METHOD",
            });
          }
        } catch (stripeError) {
          return res.status(400).json({
            error: "Méthode paiement invalide",
            code: "STRIPE_PAYMENT_METHOD_ERROR",
            details: stripeError.message,
          });
        }
      }

      // Mettre à jour configuration
      await targetMember.update({
        autoPaymentEnabled: enabled,
        paymentMethodId: enabled ? paymentMethodId : null,
      });

      res.json({
        success: true,
        message: enabled
          ? "Prélèvement automatique activé"
          : "Prélèvement automatique désactivé",
        data: {
          autoPaymentEnabled: enabled,
          paymentMethodId: enabled ? paymentMethodId : null,
        },
      });
    } catch (error) {
      console.error("Erreur configuration prélèvement:", error);
      res.status(500).json({
        error: "Erreur configuration prélèvement automatique",
        code: "AUTO_PAYMENT_CONFIG_ERROR",
        details: error.message,
      });
    }
  }

  // 📈 RAPPORT COTISATIONS ASSOCIATION
  async getCotisationsReport(req, res) {
    try {
      const { associationId } = req.params;
      const { month, year, sectionId } = req.query;

      // Vérifier permissions finances
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
      });

      const canViewFinances =
        (membership && this.checkPermission(membership, "view_finances")) ||
        req.user.role === "super_admin";

      if (!canViewFinances) {
        return res.status(403).json({
          error: "Accès aux finances non autorisé",
          code: "FINANCIAL_ACCESS_DENIED",
        });
      }

      // Construire filtres
      const whereClause = {
        associationId,
        type: "cotisation",
      };

      if (month) whereClause.month = parseInt(month);
      if (year) whereClause.year = parseInt(year);
      if (sectionId) whereClause.sectionId = sectionId;

      // Récupérer transactions cotisations
      const cotisations = await Transaction.findAll({
        where: whereClause,
        include: [
          {
            model: AssociationMember,
            as: "member",
            include: [
              { model: User, as: "user", attributes: ["id", "fullName"] },
              {
                model: Section,
                as: "section",
                attributes: ["id", "name", "country"],
              },
            ],
          },
        ],
        order: [
          ["year", "DESC"],
          ["month", "DESC"],
          ["created_at", "DESC"],
        ],
      });

      // Calculer statistiques
      const stats = {
        totalCollected: cotisations
          .filter((c) => c.status === "completed")
          .reduce((sum, c) => sum + parseFloat(c.netAmount), 0),
        totalCommissions: cotisations
          .filter((c) => c.status === "completed")
          .reduce((sum, c) => sum + parseFloat(c.commissionAmount), 0),
        paymentsCount: {
          completed: cotisations.filter((c) => c.status === "completed").length,
          pending: cotisations.filter((c) => c.status === "pending").length,
          failed: cotisations.filter((c) => c.status === "failed").length,
        },
        paymentMethods: {
          card: cotisations.filter((c) => c.paymentMethod === "card").length,
          iban: cotisations.filter((c) => c.paymentMethod === "iban").length,
        },
      };

      // Grouper par section si multi-sections
      const bySections = {};
      cotisations.forEach((cotisation) => {
        const sectionName = cotisation.member?.section?.name || "Sans section";
        if (!bySections[sectionName]) {
          bySections[sectionName] = {
            total: 0,
            count: 0,
            members: new Set(),
          };
        }

        if (cotisation.status === "completed") {
          bySections[sectionName].total += parseFloat(cotisation.netAmount);
          bySections[sectionName].count++;
          bySections[sectionName].members.add(cotisation.member.userId);
        }
      });

      // Convertir Set en count
      Object.keys(bySections).forEach((section) => {
        bySections[section].uniqueMembers = bySections[section].members.size;
        delete bySections[section].members;
      });

      res.json({
        success: true,
        data: {
          cotisations,
          stats,
          bySections,
          period: { month, year },
          generatedAt: new Date(),
        },
      });
    } catch (error) {
      console.error("Erreur rapport cotisations:", error);
      res.status(500).json({
        error: "Erreur génération rapport cotisations",
        code: "COTISATIONS_REPORT_ERROR",
        details: error.message,
      });
    }
  }

  // 🔄 IMPORTER HISTORIQUE COTISATIONS
  async importCotisationsHistory(req, res) {
    try {
      const { associationId } = req.params;
      const { cotisationsData } = req.body; // Array des cotisations historiques

      // Vérifier permissions (bureau central uniquement)
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
      });

      const canImport =
        (membership &&
          ["president", "central_board", "tresorier"].includes(
            membership.roles?.[0]
          )) ||
        req.user.role === "super_admin";

      if (!canImport) {
        return res.status(403).json({
          error: "Seul le bureau central peut importer l'historique",
          code: "BUREAU_ONLY_IMPORT",
        });
      }

      if (!Array.isArray(cotisationsData) || cotisationsData.length === 0) {
        return res.status(400).json({
          error: "Données d'import invalides",
          code: "INVALID_IMPORT_DATA",
        });
      }

      const importResults = {
        success: 0,
        errors: 0,
        skipped: 0,
        details: [],
      };

      // Traiter chaque cotisation
      for (const [index, cotisationData] of cotisationsData.entries()) {
        try {
          const {
            memberName,
            phoneNumber,
            amount,
            month,
            year,
            status = "completed",
          } = cotisationData;

          // Trouver le membre par nom ou téléphone
          const member = await AssociationMember.findOne({
            where: { associationId },
            include: [
              {
                model: User,
                as: "user",
                where: {
                  [Op.or]: [
                    { fullName: { [Op.iLike]: `%${memberName}%` } },
                    { phoneNumber: phoneNumber },
                  ],
                },
              },
            ],
          });

          if (!member) {
            importResults.errors++;
            importResults.details.push({
              line: index + 1,
              error: `Membre non trouvé: ${memberName}`,
              data: cotisationData,
            });
            continue;
          }

          // Vérifier si cotisation existe déjà
          const existing = await Transaction.findOne({
            where: {
              memberId: member.id,
              type: "cotisation",
              month: parseInt(month),
              year: parseInt(year),
            },
          });

          if (existing) {
            importResults.skipped++;
            importResults.details.push({
              line: index + 1,
              message: `Cotisation ${month}/${year} déjà existante pour ${memberName}`,
              data: cotisationData,
            });
            continue;
          }

          // Créer transaction historique
          await Transaction.create({
            userId: member.userId,
            associationId,
            memberId: member.id,
            sectionId: member.sectionId,
            type: "cotisation",
            amount: parseFloat(amount),
            commissionAmount: 0, // Pas de commission sur historique
            netAmount: parseFloat(amount),
            currency: "EUR",
            month: parseInt(month),
            year: parseInt(year),
            paymentMethod: "iban", // Historique supposé par virement
            status,
            description: `Import historique ${month}/${year}`,
            source: "imported",
            processedAt: new Date(),
            completedAt: status === "completed" ? new Date() : null,
          });

          // Mettre à jour statistiques membre si cotisation payée
          if (status === "completed") {
            await member.update({
              totalContributed: member.totalContributed + parseFloat(amount),
            });
          }

          importResults.success++;
          importResults.details.push({
            line: index + 1,
            message: `Cotisation ${month}/${year} importée pour ${memberName}`,
            data: cotisationData,
          });
        } catch (lineError) {
          importResults.errors++;
          importResults.details.push({
            line: index + 1,
            error: lineError.message,
            data: cotisationData,
          });
        }
      }

      res.json({
        success: true,
        message: "Import historique terminé",
        data: {
          summary: {
            total: cotisationsData.length,
            imported: importResults.success,
            errors: importResults.errors,
            skipped: importResults.skipped,
          },
          details: importResults.details,
        },
      });
    } catch (error) {
      console.error("Erreur import historique:", error);
      res.status(500).json({
        error: "Erreur import historique cotisations",
        code: "IMPORT_HISTORY_ERROR",
        details: error.message,
      });
    }
  }

  // Obtenir détails d'un membre
  async getMember(req, res) {
    try {
      const { associationId, memberId } = req.params;

      // Vérifier accès association
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
      });

      if (!membership && req.user.role !== "super_admin") {
        return res.status(403).json({
          error: "Accès association non autorisé",
          code: "ASSOCIATION_ACCESS_DENIED",
        });
      }

      // Récupérer le membre
      const member = await AssociationMember.findOne({
        where: {
          id: memberId,
          associationId,
        },
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "firstName", "lastName", "phoneNumber", "email", "dateOfBirth", "gender", "address", "city", "country", "postalCode", ],
          },
          {
            model: Section,
            as: "section",
            attributes: ["id", "name", "country", "city"],
          },
        ],
      });

      if (!member) {
        return res.status(404).json({
          error: "Membre introuvable",
          code: "MEMBER_NOT_FOUND",
        });
      }

      res.json({
        success: true,
        data: { member },
      });
    } catch (error) {
      console.error("Erreur récupération membre:", error);
      res.status(500).json({
        error: "Erreur récupération membre",
        code: "MEMBER_FETCH_ERROR",
        details: error.message,
      });
    }
  }

  // 🎯 TABLEAU DE BORD MEMBRE
  async getMemberDashboard(req, res) {
    try {
      const { associationId } = req.params;

      // Récupérer membership utilisateur
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
        include: [
          { model: Association, as: "association" },
          { model: Section, as: "section" },
        ],
      });

      if (!membership) {
        return res.status(403).json({
          error: "Membre non trouvé dans cette association",
          code: "NOT_ASSOCIATION_MEMBER",
        });
      }

      // Récupérer dernières cotisations
      const recentCotisations = await Transaction.findAll({
        where: {
          memberId: membership.id,
          type: "cotisation",
        },
        limit: 6,
        order: [
          ["year", "DESC"],
          ["month", "DESC"],
        ],
      });

      // Calculer statistiques personnelles
      const [totalContributed, currentYearPaid, isCurrentMonthPaid] =
        await Promise.all([
          membership.getTotalContributions(),
          Transaction.count({
            where: {
              memberId: membership.id,
              type: "cotisation",
              status: "completed",
              year: new Date().getFullYear(),
            },
          }),
          membership.isCurrentMonthPaid(),
        ]);

      // Vérifier prochaine échéance
      const currentMonth = new Date().getMonth() + 1;
      const currentYear = new Date().getFullYear();
      const nextDue = {
        month: currentMonth,
        year: currentYear,
        amount: membership.cotisationAmount,
        isPaid: isCurrentMonthPaid,
      };

      // Permissions utilisateur
      const userPermissions = await this.getUserPermissions(
        req.user.id,
        associationId
      );

      // Événements à venir (si permission)
      let upcomingEvents = [];
      if (userPermissions.view_events !== false) {
        const { Event } = require("../../../models");
        upcomingEvents = await Event.findAll({
          where: {
            associationId,
            startDate: { [Op.gte]: new Date() },
            [Op.or]: [
              { visibility: "public" },
              { visibility: "association" },
              ...(membership.sectionId
                ? [{ sectionId: membership.sectionId }]
                : []),
            ],
          },
          limit: 3,
          order: [["start_date", "ASC"]],
        });
      }

      res.json({
        success: true,
        data: {
          member: {
            id: membership.id,
            memberType: membership.memberType,
            roles: membership.roles,
            joinDate: membership.joinDate,
            seniority: membership.getTotalSeniority(),
            status: membership.status,
            section: membership.section,
          },
          association: {
            id: membership.association.id,
            name: membership.association.name,
            membersCount: membership.association.membersCount,
          },
          finances: {
            totalContributed,
            currentYearPaid,
            nextDue,
            autoPaymentEnabled: membership.autoPaymentEnabled,
            cotisationAmount: membership.cotisationAmount,
          },
          recentActivity: {
            cotisations: recentCotisations,
            upcomingEvents,
          },
          permissions: userPermissions,
        },
      });
    } catch (error) {
      console.error("Erreur dashboard membre:", error);
      res.status(500).json({
        error: "Erreur récupération dashboard membre",
        code: "MEMBER_DASHBOARD_ERROR",
        details: error.message,
      });
    }
  }

  // 🔧 UTILITAIRES PERMISSIONS
  checkPermission(membership, action) {
    if (!membership || !membership.association) return false;

    const permissions = membership.association.permissionsMatrix || {};
    const actionConfig = permissions[action];

    if (!actionConfig) {
      // Permissions par défaut si pas configuré
      const defaultPermissions = {
        view_member_list: [
          "president",
          "central_board",
          "secretaire",
          "responsable_section",
        ],
        view_finances: [
          "president",
          "central_board",
          "tresorier",
          "tresorier_section",
        ],
        manage_members: ["president", "central_board", "secretaire"],
        approve_aids: ["president", "central_board", "tresorier"],
      };

      const defaultRoles = defaultPermissions[action] || [];
      const userRoles = membership.roles || [];
      return userRoles.some((role) => defaultRoles.includes(role));
    }

    const userRoles = membership.roles || [];
    const allowedRoles = actionConfig.allowed_roles || [];

    return userRoles.some((role) => allowedRoles.includes(role));
  }

  async getUserPermissions(userId, associationId) {
    try {
      const membership = await AssociationMember.findOne({
        where: { userId, associationId, status: "active" },
        include: [{ model: Association, as: "association" }],
      });

      if (!membership) return {};

      const permissionsMatrix = membership.association.permissionsMatrix || {};
      const userRoles = membership.roles || [];
      const userPermissions = {};

      // Calculer permissions effectives
      Object.keys(permissionsMatrix).forEach((action) => {
        const config = permissionsMatrix[action];
        const allowedRoles = config.allowed_roles || [];
        userPermissions[action] = userRoles.some((role) =>
          allowedRoles.includes(role)
        );
      });

      // Ajouter permissions par défaut si pas configurées
      const defaultActions = [
        "view_member_list",
        "view_finances",
        "manage_members",
        "approve_aids",
      ];
      defaultActions.forEach((action) => {
        if (userPermissions[action] === undefined) {
          userPermissions[action] = this.checkPermission(membership, action);
        }
      });

      return userPermissions;
    } catch (error) {
      console.error("Erreur calcul permissions utilisateur:", error);
      return {};
    }
  }

  // 📱 NOTIFICATIONS COTISATIONS EN RETARD
  async getOverdueCotisations(req, res) {
    try {
      const { associationId } = req.params;

      // Vérifier permissions (bureau uniquement)
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
      });

      const canViewOverdue =
        (membership && this.checkPermission(membership, "view_finances")) ||
        req.user.role === "super_admin";

      if (!canViewOverdue) {
        return res.status(403).json({
          error: "Permissions insuffisantes",
          code: "INSUFFICIENT_PERMISSIONS",
        });
      }

      const currentMonth = new Date().getMonth() + 1;
      const currentYear = new Date().getFullYear();

      // Trouver membres actifs sans cotisation ce mois
      const activeMembers = await AssociationMember.findAll({
        where: {
          associationId,
          status: "active",
        },
        include: [
          {
            model: User,
            as: "user",
            attributes: ["id", "fullName", "phoneNumber"],
          },
          { model: Section, as: "section", attributes: ["id", "name"] },
        ],
      });

      const overdueMembers = [];

      for (const member of activeMembers) {
        const hasCurrentPayment = await Transaction.findOne({
          where: {
            memberId: member.id,
            type: "cotisation",
            month: currentMonth,
            year: currentYear,
            status: "completed",
          },
        });

        if (!hasCurrentPayment) {
          // Calculer retard en mois
          const lastPayment = await Transaction.findOne({
            where: {
              memberId: member.id,
              type: "cotisation",
              status: "completed",
            },
            order: [
              ["year", "DESC"],
              ["month", "DESC"],
            ],
          });

          let monthsOverdue = 1;
          if (lastPayment) {
            const lastPaymentDate = new Date(
              lastPayment.year,
              lastPayment.month - 1
            );
            const currentDate = new Date(currentYear, currentMonth - 1);
            monthsOverdue =
              (currentDate.getFullYear() - lastPaymentDate.getFullYear()) * 12 +
              (currentDate.getMonth() - lastPaymentDate.getMonth());
          }

          overdueMembers.push({
            member: {
              id: member.id,
              user: member.user,
              memberType: member.memberType,
              section: member.section,
              cotisationAmount: member.cotisationAmount,
              autoPaymentEnabled: member.autoPaymentEnabled,
            },
            overdue: {
              monthsOverdue,
              lastPayment,
              estimatedDebt: member.cotisationAmount * monthsOverdue,
            },
          });
        }
      }

      // Trier par nombre de mois de retard
      overdueMembers.sort(
        (a, b) => b.overdue.monthsOverdue - a.overdue.monthsOverdue
      );

      // Statistiques résumé
      const stats = {
        totalOverdue: overdueMembers.length,
        totalActiveMembers: activeMembers.length,
        paymentRate: Math.round(
          ((activeMembers.length - overdueMembers.length) /
            activeMembers.length) *
            100
        ),
        totalPotentialRevenue: overdueMembers.reduce(
          (sum, om) => sum + om.overdue.estimatedDebt,
          0
        ),
      };

      res.json({
        success: true,
        data: {
          overdueMembers,
          stats,
          period: { month: currentMonth, year: currentYear },
          generatedAt: new Date(),
        },
      });
    } catch (error) {
      console.error("Erreur cotisations en retard:", error);
      res.status(500).json({
        error: "Erreur récupération cotisations en retard",
        code: "OVERDUE_COTISATIONS_ERROR",
        details: error.message,
      });
    }
  }

  async getSectionMembers(req, res) {
    try {
      const { associationId, sectionId } = req.params;
      const { page = 1, limit = 50 } = req.query;

      // Vérifier accès
      const membership = await AssociationMember.findOne({
        where: {
          userId: req.user.id,
          associationId,
          status: "active",
        },
        include: [
          {
            model: Association,
            as: "association",
            attributes: ["rolesConfiguration"],
          },
        ],
      });

      const canViewMembers =
        membership?.isAdmin ||
        hasPermission(membership, "view_members") ||
        req.user.role === "super_admin";

      if (!canViewMembers) {
        return res.status(403).json({
          error: "Permission insuffisante",
          code: "VIEW_MEMBERS_DENIED",
        });
      }

      // Vérifier que la section existe
      const section = await Section.findOne({
        where: { id: sectionId, associationId },
      });

      if (!section) {
        return res.status(404).json({
          error: "Section introuvable",
          code: "SECTION_NOT_FOUND",
        });
      }

      const offset = (page - 1) * limit;

      const { count, rows: members } = await AssociationMember.findAndCountAll({
        where: {
          associationId,
          sectionId,
          isMemberOfAssociation: true, // ✅ Membres réels uniquement
          status: "active",
        },
        include: [
          {
            model: User,
            as: "user",
            attributes: [
              "id",
              "firstName",
              "lastName",
              "phoneNumber",
              "email",
              "profilePicture",
            ],
          },
        ],
        order: [["joinDate", "DESC"]],
        limit: parseInt(limit),
        offset: parseInt(offset),
      });

      res.json({
        success: true,
        data: {
          section,
          members,
          pagination: {
            total: count,
            page: parseInt(page),
            limit: parseInt(limit),
            pages: Math.ceil(count / limit),
          },
        },
      });
    } catch (error) {
      console.error("❌ Erreur membres section:", error);
      res.status(500).json({
        error: "Erreur membres section",
        code: "SECTION_MEMBERS_ERROR",
        details: error.message,
      });
    }
  }

  async getCotisationsDashboard(req, res) {
  try {
    const { associationId } = req.params;
    const {
      month = new Date().getMonth() + 1,
      year = new Date().getFullYear(),
      sectionId,
      memberType,
      status,
    } = req.query;

    console.log("📊 Dashboard cotisations:", {
      associationId,
      month,
      year,
      sectionId,
      memberType,
      status,
    });

    // ✅ Permission déjà vérifiée par middleware checkPermission("finances.view_treasury")

    // Récupérer l'association avec ses configurations
    const association = await Association.findByPk(associationId, {
      include: [
        {
          model: Section,
          as: "sections",
          attributes: ["id", "name", "country", "city"],
        },
      ],
    });

    if (!association) {
      return res.status(404).json({
        error: "Association introuvable",
        code: "ASSOCIATION_NOT_FOUND",
      });
    }

    // Configuration des types de membres
    const memberTypes = association.memberTypes || [];

    // 1. Récupérer tous les membres actifs de l'association
    const whereClause = {
      associationId,
      status: "active",
      isMemberOfAssociation: true,
    };

    // Filtres optionnels
    if (sectionId) {
      whereClause.sectionId = parseInt(sectionId);
    }

    if (memberType && memberType !== "all") {
      whereClause.memberType = memberType;
    }

    const members = await AssociationMember.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: "user",
          attributes: [
            "id",
            "firstName",
            "lastName",
            "phoneNumber",
            "email",
            "profilePicture",
          ],
        },
        {
          model: Section,
          as: "section",
          attributes: ["id", "name", "country", "city"],
          required: false,
        },
      ],
    });

    console.log(`📋 ${members.length} membres trouvés`);

    // ✅ 2. Récupérer TOUTES les transactions de cotisation pour cette période
    const transactions = await Transaction.findAll({
      where: {
        associationId,
        type: "cotisation",
        month: parseInt(month),
        year: parseInt(year),
        status: "completed", // ✅ SEULEMENT les cotisations validées/complétées
      },
    });

    console.log(`💰 ${transactions.length} transactions trouvées pour ${month}/${year}`);

    // ✅ 3. Créer un mapping memberId => montant payé
    const paymentsByMember = {};
    transactions.forEach((transaction) => {
      if (!paymentsByMember[transaction.memberId]) {
        paymentsByMember[transaction.memberId] = {
          totalPaid: 0,
          paymentMethod: null,
          paymentDate: null,
        };
      }
      paymentsByMember[transaction.memberId].totalPaid += parseFloat(transaction.amount);
      paymentsByMember[transaction.memberId].paymentMethod = transaction.paymentMethod;
      paymentsByMember[transaction.memberId].paymentDate = transaction.createdAt;
    });

    console.log("💳 Paiements par membre:", paymentsByMember);

    // ✅ 4. Calculer le statut de chaque membre
    const membersWithStatus = members.map((member) => {
      // Trouver la configuration du type de membre
      const memberTypeConfig = memberTypes.find(
        (mt) => mt.name === member.memberType
      );

      const expectedAmount = memberTypeConfig?.cotisationAmount || 0;

      // ✅ Récupérer le montant payé depuis le mapping
      const payment = paymentsByMember[member.id] || { totalPaid: 0, paymentMethod: null, paymentDate: null };
      const paidAmount = payment.totalPaid;

      // Statut de paiement pour cette période
      let cotisationStatus = "pending";
      let daysSinceDeadline = 0;

      if (paidAmount >= expectedAmount) {
        cotisationStatus = "paid";
      } else {
        // Calculer jours de retard
        const deadline = new Date(year, month - 1, 10); // 10 du mois
        const today = new Date();
        daysSinceDeadline = Math.floor(
          (today - deadline) / (1000 * 60 * 60 * 24)
        );

        if (daysSinceDeadline > 30) {
          cotisationStatus = "very_late";
        } else if (daysSinceDeadline > 0) {
          cotisationStatus = "late";
        } else {
          cotisationStatus = "pending";
        }
      }

      return {
        id: member.id,
        userId: member.userId,
        user: member.user,
        memberType: member.memberType,
        section: member.section,
        expectedAmount,
        paidAmount,
        hasPendingValidation: 0, // TODO: calculer si cotisations en validation
        paymentMethod: payment.paymentMethod,
        cotisationStatus,
        paymentDate: payment.paymentDate,
        daysSinceDeadline,
        assignedRoles: member.assignedRoles || [],
        isAdmin: member.isAdmin || false,
      };
    });

    // 5. Filtrer par statut si demandé
    let filteredMembers = membersWithStatus;
    if (status && status !== "all") {
      filteredMembers = membersWithStatus.filter(
        (m) => m.cotisationStatus === status
      );
    }

    console.log(`📊 ${filteredMembers.length} membres après filtrage statut`);

    // 6. Calculer KPIs globaux
    const totalExpected = membersWithStatus.reduce(
      (sum, m) => sum + m.expectedAmount,
      0
    );
    const totalCollected = membersWithStatus.reduce(
      (sum, m) => sum + m.paidAmount,
      0
    );
    const totalPending = totalExpected - totalCollected;
    const collectionRate =
      totalExpected > 0
        ? Math.round((totalCollected / totalExpected) * 100)
        : 0;

    // Compter par statut
    const statusCounts = {
      paid: membersWithStatus.filter((m) => m.cotisationStatus === "paid")
        .length,
      pending: membersWithStatus.filter((m) => m.cotisationStatus === "pending")
        .length,
      late: membersWithStatus.filter((m) => m.cotisationStatus === "late")
        .length,
      very_late: membersWithStatus.filter(
        (m) => m.cotisationStatus === "very_late"
      ).length,
    };

    // 7. Statistiques par section
    const sectionStats = [];

    if (association.isMultiSection) {
      // Grouper par section
      const bySection = {};

      membersWithStatus.forEach((member) => {
        const sectionId = member.section?.id || null;
        const sectionKey = sectionId || "central";

        if (!bySection[sectionKey]) {
          bySection[sectionKey] = {
            section: member.section || {
              id: null,
              name: "Central",
              country: null,
              city: null,
            },
            members: [],
          };
        }

        bySection[sectionKey].members.push(member);
      });

      // Calculer stats pour chaque section
      Object.values(bySection).forEach((sectionGroup) => {
        const sectionExpected = sectionGroup.members.reduce(
          (sum, m) => sum + m.expectedAmount,
          0
        );
        const sectionCollected = sectionGroup.members.reduce(
          (sum, m) => sum + m.paidAmount,
          0
        );

        sectionStats.push({
          section: sectionGroup.section,
          membersCount: sectionGroup.members.length,
          expectedAmount: sectionExpected,
          collectedAmount: sectionCollected,
          collectionRate:
            sectionExpected > 0
              ? Math.round((sectionCollected / sectionExpected) * 100)
              : 0,
        });
      });
    } else {
      // Association sans sections - stats centralisées
      const centralExpected = membersWithStatus.reduce(
        (sum, m) => sum + m.expectedAmount,
        0
      );
      const centralCollected = membersWithStatus.reduce(
        (sum, m) => sum + m.paidAmount,
        0
      );

      sectionStats.push({
        section: {
          id: null,
          name: "Central",
          country: null,
          city: null,
        },
        membersCount: membersWithStatus.length,
        expectedAmount: centralExpected,
        collectedAmount: centralCollected,
        collectionRate:
          centralExpected > 0
            ? Math.round((centralCollected / centralExpected) * 100)
            : 0,
      });
    }

    // 8. Statistiques par type de membre
    const memberTypeStats = Object.entries(
      membersWithStatus.reduce((acc, member) => {
        if (!acc[member.memberType]) {
          acc[member.memberType] = {
            count: 0,
            expected: 0,
            collected: 0,
          };
        }
        acc[member.memberType].count++;
        acc[member.memberType].expected += member.expectedAmount;
        acc[member.memberType].collected += member.paidAmount;
        return acc;
      }, {})
    ).map(([type, stats]) => ({
      memberType: type,
      membersCount: stats.count,
      expectedAmount: stats.expected,
      collectedAmount: stats.collected,
      collectionRate:
        stats.expected > 0
          ? Math.round((stats.collected / stats.expected) * 100)
          : 0,
    }));

    console.log("📊 KPIs calculés:", {
      totalExpected,
      totalCollected,
      collectionRate,
      statusCounts,
    });

    res.json({
      success: true,
      data: {
        period: {
          month: parseInt(month),
          year: parseInt(year),
          monthName: new Date(year, month - 1).toLocaleDateString("fr-FR", {
            month: "long",
          }),
        },
        kpis: {
          totalExpected,
          totalCollected,
          totalPending,
          collectionRate,
          membersCount: membersWithStatus.length,
          ...statusCounts,
        },
        members: filteredMembers,
        statistics: {
          bySections: sectionStats,
          byMemberTypes: memberTypeStats,
        },
        filters: {
          month: parseInt(month),
          year: parseInt(year),
          sectionId: sectionId ? parseInt(sectionId) : null,
          memberType: memberType || null,
          status: status || "all",
        },
      },
    });
  } catch (error) {
    console.error("❌ Erreur dashboard cotisations:", error);
    res.status(500).json({
      error: "Erreur récupération dashboard cotisations",
      code: "COTISATIONS_DASHBOARD_ERROR",
      details: error.message,
    });
  }
}

  async addManualCotisation(req, res) {
  console.log("🎯 addManualCotisation appelé !");
  console.log("📦 Body reçu:", req.body);
  console.log("👤 User:", req.user?.id);
  console.log("🏢 Membership:", req.membership);
  
  try {
    const { associationId } = req.params;
    const { memberId, amount, month, year, reason, paymentMethod } = req.body;

    // ✅ Validation des données d'entrée
    if (!memberId || !amount || !month || !year || !paymentMethod) {
      return res.status(400).json({
        error: "Données manquantes",
        code: "MISSING_FIELDS",
        details: {
          memberId: !!memberId,
          amount: !!amount,
          month: !!month,
          year: !!year,
          paymentMethod: !!paymentMethod
        }
      });
    }

    // ✅ Le middleware checkPermission a déjà vérifié les permissions
    // ✅ req.membership est fourni par checkAssociationMember

    // Récupérer le membre cible avec ses infos
    const targetMember = await AssociationMember.findOne({
      where: {
        id: memberId,
        associationId,
        status: "active",
      },
      include: [
        {
          model: User,
          as: "user",
          attributes: ["id", "firstName", "lastName", "phoneNumber"],
        },
        {
          model: Section,
          as: "section",
          attributes: ["id", "name"],
        },
      ],
    });

    if (!targetMember) {
      return res.status(404).json({
        error: "Membre introuvable",
        code: "MEMBER_NOT_FOUND",
      });
    }

    // Récupérer l'association pour connaître sa structure
    const association = await Association.findByPk(associationId);
    if (!association) {
      return res.status(404).json({
        error: "Association introuvable",
        code: "ASSOCIATION_NOT_FOUND",
      });
    }

    // Vérifier qu'une cotisation n'existe pas déjà pour cette période
    const existingCotisation = await Transaction.findOne({
      where: {
        associationId,
        memberId: targetMember.id,
        type: "cotisation",
        month: parseInt(month),
        year: parseInt(year),
        status: ["completed", "pending", "processing"],
      },
    });

    if (existingCotisation) {
      return res.status(400).json({
        error: `Une cotisation existe déjà pour ${month}/${year}`,
        code: "COTISATION_ALREADY_EXISTS",
      });
    }

    // ✅ NOUVELLE LOGIQUE : Auto-validation si l'utilisateur a finances.manage_budgets
    // Le middleware checkPermission a déjà vérifié que l'utilisateur a cette permission
    // Donc SI on arrive ici, c'est que l'utilisateur PEUT gérer les budgets
    // Donc on valide automatiquement la cotisation
    
    const initialStatus = "completed";
    const requiresApproval = false;
    const validatorInfo = {
      approvedBy: req.user.id,
      approvedAt: new Date(),
      validatorRole: "financial_manager", // Celui qui a finances.manage_budgets
    };

    console.log("✅ Auto-validation activée (permission finances.manage_budgets détectée)");

    // ✅ LOGIQUE COMMISSION
    // Commission UNIQUEMENT pour les paiements par carte (frais PSP)
    let commissionAmount = 0;
    let netAmount = parseFloat(amount);

    if (paymentMethod === "card") {
      commissionAmount = parseFloat((amount * 0.025 + 0.25).toFixed(2));
      netAmount = parseFloat((amount - commissionAmount).toFixed(2));
    }
    // Pour cash, check, bank_transfer, mobile_money : pas de commission

    console.log("💰 Commission calculée:", {
      paymentMethod,
      amount: parseFloat(amount),
      commissionAmount,
      netAmount,
    });

    // Créer la transaction
    const transaction = await Transaction.create({
      userId: targetMember.userId,
      associationId,
      sectionId: targetMember.sectionId,
      memberId: targetMember.id,
      type: "cotisation",
      amount: parseFloat(amount),
      commissionAmount,
      netAmount,
      currency: association.primaryCurrency || "EUR",
      month: parseInt(month),
      year: parseInt(year),
      paymentMethod,
      status: initialStatus,
      description: reason || null,
      source: "manual",
      addedBy: req.user.id,
      addedByRole: req.membership?.assignedRoles?.[0] || "member",
      approvedBy: validatorInfo.approvedBy,
      approvedAt: validatorInfo.approvedAt,
      completedAt: validatorInfo.approvedAt,
      processedAt: validatorInfo.approvedAt,
    });

    // Mettre à jour les stats du membre (toujours validé directement)
    await targetMember.update({
      totalContributed:
        parseFloat(targetMember.totalContributed || "0") +
        parseFloat(amount),
      lastContributionDate: new Date(),
      contributionStatus: "uptodate",
    });

    // Message de notification
    const currencySymbol = association.primaryCurrency || "EUR";
    const notificationMessage = `Cotisation de ${amount} ${currencySymbol} ajoutée et validée pour ${targetMember.user.firstName} ${targetMember.user.lastName}`;

    console.log("✅ Cotisation créée avec succès:", {
      transactionId: transaction.id,
      status: initialStatus,
      amount: parseFloat(amount),
    });

    res.json({
      success: true,
      message: "Cotisation ajoutée et validée avec succès",
      data: {
        transaction: {
          id: transaction.id,
          amount: parseFloat(amount),
          commissionAmount,
          netAmount,
          month: parseInt(month),
          year: parseInt(year),
          status: initialStatus,
          paymentMethod,
          reason: reason || null,
        },
        member: {
          id: targetMember.id,
          name: `${targetMember.user.firstName} ${targetMember.user.lastName}`,
          section: targetMember.section?.name,
        },
        validation: {
          required: requiresApproval,
          autoValidated: true,
          validatorInfo,
        },
        notification: notificationMessage,
      },
    });
  } catch (error) {
    console.error("❌ Erreur ajout cotisation manuelle:", error);
    res.status(500).json({
      error: "Erreur ajout cotisation manuelle",
      code: "MANUAL_COTISATION_ERROR",
      details: error.message,
    });
  }
}

   // 📄 EXPORTER MEMBRES EN PDF
async exportMembersPDF(req, res) {
  try {
    const { associationId } = req.params;
    const {
      sectionId,
      memberType,
      status = "all",
      search,
    } = req.query;

    console.log("📄 Export PDF membres:", {
      associationId,
      filters: { sectionId, memberType, status, search },
    });

    // ✅ Le middleware a déjà vérifié la permission membres.export_data

    // Récupérer l'association avec son logo
    const association = await Association.findByPk(associationId);
    if (!association) {
      return res.status(404).json({
        error: "Association introuvable",
        code: "ASSOCIATION_NOT_FOUND",
      });
    }

    // Construire les filtres (même logique que listMembers)
    const whereClause = {
      associationId,
      isMemberOfAssociation: true,
    };

    if (sectionId) whereClause.sectionId = sectionId;
    if (status !== "all") whereClause.status = status;
    if (memberType) whereClause.memberType = memberType;

    const includes = [
      {
        model: User,
        as: "user",
        attributes: [
          "id",
          "firstName",
          "lastName",
          "phoneNumber",
          "email",
        ],
        ...(search && {
          where: {
            [Op.or]: [
              { firstName: { [Op.iLike]: `%${search}%` } },
              { lastName: { [Op.iLike]: `%${search}%` } },
              { phoneNumber: { [Op.iLike]: `%${search}%` } },
            ],
          },
        }),
      },
      {
        model: Section,
        as: "section",
        attributes: ["id", "name", "city"],
        required: false,
      },
    ];

    // Récupérer TOUS les membres (pas de pagination pour l'export)
    const members = await AssociationMember.findAll({
      where: whereClause,
      include: includes,
      order: [["joinDate", "DESC"]],
    });

    console.log(`✅ ${members.length} membres à exporter`);

    // Récupérer la configuration des rôles pour afficher les noms
    const rolesConfig = association.rolesConfiguration?.roles || [];

    if (members.length === 0) {
      return res.status(404).json({
        error: "Aucun membre à exporter avec ces filtres",
        code: "NO_MEMBERS_TO_EXPORT",
      });
    }

    // ✅ CORRECTION : Appel de la fonction helper AVANT de pipe vers res
    if (members.length <= 300) {
      // ✅ CAS 1 : PDF UNIQUE (≤ 300 membres)
      const PDFDocument = require("pdfkit");
      const doc = new PDFDocument({ 
  margin: 30,
  size: 'A4',
  layout: 'landscape' // ✅ Mode paysage
});

      // Headers pour le téléchargement
      const fileName = `Membres_${association.name.replace(/[^a-z0-9]/gi, "_")}_${new Date().toISOString().split("T")[0]}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName}"`
      );

      // ✅ CRITIQUE : pipe APRÈS avoir généré le contenu
      doc.pipe(res);

      // ✅ Générer le PDF (fonction synchrone)
      generateMembersPDF(doc, association, members, rolesConfig, {
        sectionId,
        memberType,
        status,
        search,
      });

      doc.end();
    } else {
      // ✅ CAS 2 : ZIP AVEC PLUSIEURS PDFs (> 300 membres)
      const archiver = require("archiver");
      const PDFDocument = require("pdfkit");

      const zipName = `Membres_${association.name.replace(/[^a-z0-9]/gi, "_")}_${new Date().toISOString().split("T")[0]}.zip`;
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${zipName}"`
      );

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.pipe(res);

      // Diviser en groupes de 100 membres
      const chunkSize = 100;
      const chunks = [];
      for (let i = 0; i < members.length; i += chunkSize) {
        chunks.push(members.slice(i, i + chunkSize));
      }

      console.log(`📦 Création ZIP avec ${chunks.length} fichiers PDF`);

      // Générer chaque PDF
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const doc = new PDFDocument({ margin: 50 });
        const pdfFileName = `Membres_Part${i + 1}_sur_${chunks.length}.pdf`;

        // Ajouter le PDF au ZIP
        archive.append(doc, { name: pdfFileName });

        // ✅ Générer le contenu du PDF
        generateMembersPDF(doc, association, chunk, rolesConfig, {
          sectionId,
          memberType,
          status,
          search,
          partNumber: i + 1,
          totalParts: chunks.length,
        });

        doc.end();
      }

      await archive.finalize();
    }
  } catch (error) {
    console.error("❌ Erreur export PDF membres:", error);
    
    // ✅ NE PAS envoyer de réponse si les headers sont déjà envoyés
    if (!res.headersSent) {
      res.status(500).json({
        error: "Erreur export PDF membres",
        code: "EXPORT_PDF_ERROR",
        details: error.message,
      });
    }
  }
}



}

module.exports = new MemberController();