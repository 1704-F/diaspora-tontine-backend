const { User, AssociationMember, TontineParticipant, Association, Tontine } = require('../../../models');

class UserController {
  async getProfile(req, res) {
    try {
      const userId = req.user.id;

      const user = await User.findByPk(userId, {
        attributes: {
          exclude: ['password', 'pinCode'] // Exclure données sensibles
        },
        include: [
          {
            model: AssociationMember,
            as: 'associationMemberships',
            where: { status: 'active' },
            required: false,
            include: [
              {
                model: Association,
                as: 'association',
                attributes: ['id', 'name', 'slug', 'status']
              }
            ]
          },
          {
            model: TontineParticipant,
            as: 'tontineParticipations',
            where: { status: ['active', 'approved'] }, // Inclure approved aussi
            required: false,
            include: [
              {
                model: Tontine,
                as: 'tontine',
                attributes: ['id', 'title', 'status', 'organizerId'] // title au lieu de name
              }
            ]
          }
        ]
      });

      if (!user) {
        return res.status(404).json({
          error: 'Utilisateur introuvable',
          code: 'USER_NOT_FOUND'
        });
      }

      // Formater les associations pour le frontend
      const associations = user.associationMemberships?.map(membership => ({
        id: membership.association.id,
        name: membership.association.name,
        role: membership.memberType, // memberType au lieu de role
        status: membership.status
      })) || [];

      // Formater les tontines pour le frontend
      const tontines = user.tontineParticipations?.map(participation => ({
        id: participation.tontine.id,
        name: participation.tontine.title, // title mappé vers name pour le frontend
        role: participation.tontine.organizerId === userId ? 'organizer' : 'participant',
        status: participation.status
      })) || [];

      // Formater la réponse
      const userData = user.toJSON();
      userData.associations = associations;
      userData.tontines = tontines;

      res.json({
        success: true,
        data: { user: userData }
      });

    } catch (error) {
      console.error('Erreur récupération profil:', error);
      res.status(500).json({
        error: 'Erreur récupération profil utilisateur',
        code: 'USER_PROFILE_ERROR',
        details: error.message
      });
    }
  }
}

module.exports = new UserController();