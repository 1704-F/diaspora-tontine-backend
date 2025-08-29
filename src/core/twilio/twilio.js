// config/twilio.js
const twilio = require('twilio');

const twilioConfig = {
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  phoneNumber: process.env.TWILIO_PHONE_NUMBER,
  serviceSid: process.env.TWILIO_VERIFY_SERVICE_SID || null,
  // Mode test pour développement
  testMode: process.env.TWILIO_TEST_MODE === 'true' || process.env.NODE_ENV === 'development'
};

// Client Twilio (seulement si pas en mode test)
let client = null;
if (!twilioConfig.testMode && twilioConfig.accountSid && twilioConfig.authToken) {
  try {
    client = twilio(twilioConfig.accountSid, twilioConfig.authToken);
    console.log('✅ Client Twilio initialisé');
  } catch (error) {
    console.warn('⚠️ Erreur initialisation Twilio, mode test activé:', error.message);
    twilioConfig.testMode = true;
  }
} else {
  console.log('📱 Mode test Twilio activé - OTP affichés dans la console');
  twilioConfig.testMode = true;
}

class TwilioService {
  constructor() {
    this.client = client;
    this.config = twilioConfig;
  }

  // Format numéro téléphone au format international
  formatPhoneNumber(phoneNumber) {
    // Nettoyer le numéro
    let cleaned = phoneNumber.replace(/\D/g, '');
    
    // Ajouter +33 pour France si numéro commence par 0
    if (cleaned.startsWith('0') && cleaned.length === 10) {
      cleaned = '33' + cleaned.substring(1);
    }
    
    // Ajouter + si pas présent
    if (!cleaned.startsWith('+')) {
      cleaned = '+' + cleaned;
    }
    
    return cleaned;
  }

  // Générer code OTP
  generateOTP(length = 6) {
    const digits = '0123456789';
    let otp = '';
    
    for (let i = 0; i < length; i++) {
      otp += digits[Math.floor(Math.random() * 10)];
    }
    
    return otp;
  }

  // Envoyer SMS OTP
  async sendOTP(phoneNumber, otp, context = 'login') {
    try {
      const formattedNumber = this.formatPhoneNumber(phoneNumber);
      
      let message;
      switch (context) {
        case 'login':
          message = `Votre code de connexion Diaspora/Tontine: ${otp}. Ne le partagez avec personne. Valide 10 minutes.`;
          break;
        case 'verification':
          message = `Code de vérification Diaspora/Tontine: ${otp}. Code valide 10 minutes.`;
          break;
        case 'password_reset':
          message = `Code de réinitialisation Diaspora/Tontine: ${otp}. Valide 10 minutes.`;
          break;
        default:
          message = `Votre code Diaspora/Tontine: ${otp}. Valide 10 minutes.`;
      }

      // MODE TEST - Afficher dans la console
      if (this.config.testMode) {
        console.log('');
        console.log('='.repeat(60));
        console.log('📱 SMS OTP MODE TEST 📱');
        console.log('='.repeat(60));
        console.log(`📞 Destinataire: ${formattedNumber}`);
        console.log(`🔢 Code OTP: ${otp}`);
        console.log(`💬 Message: ${message}`);
        console.log(`⏰ Contexte: ${context}`);
        console.log(`🕐 Généré à: ${new Date().toLocaleString('fr-FR')}`);
        console.log('='.repeat(60));
        console.log('');

        return {
          success: true,
          sid: `test_${Date.now()}`,
          status: 'delivered',
          to: formattedNumber,
          testMode: true
        };
      }

      // MODE PRODUCTION - Utiliser Twilio réel
      if (this.config.serviceSid) {
        const verification = await this.client.verify.v2
          .services(this.config.serviceSid)
          .verifications
          .create({
            to: formattedNumber,
            channel: 'sms',
            customMessage: message
          });

        return {
          success: true,
          sid: verification.sid,
          status: verification.status,
          to: formattedNumber
        };
      } else {
        const messageResult = await this.client.messages.create({
          body: message,
          from: this.config.phoneNumber,
          to: formattedNumber
        });

        return {
          success: true,
          sid: messageResult.sid,
          status: messageResult.status,
          to: formattedNumber
        };
      }
      
    } catch (error) {
      console.error('Erreur envoi SMS:', error);
      
      // En mode test, simuler les erreurs
      if (this.config.testMode) {
        if (phoneNumber.includes('invalid')) {
          throw new Error('Numéro de téléphone invalide');
        }
        return {
          success: true,
          sid: `test_${Date.now()}`,
          status: 'delivered',
          to: phoneNumber,
          testMode: true
        };
      }
      
      // Erreurs spécifiques Twilio
      if (error.code === 21614) {
        throw new Error('Numéro de téléphone invalide');
      } else if (error.code === 21408) {
        throw new Error('Numéro de téléphone non supporté');
      } else if (error.code === 21211) {
        throw new Error('Numéro de téléphone invalide');
      }
      
      throw new Error('Erreur lors de l\'envoi du SMS');
    }
  }

  // Vérifier OTP avec Verify Service
  async verifyOTP(phoneNumber, otp) {
    try {
      // MODE TEST - Toujours approuver
      if (this.config.testMode) {
        console.log(`🔍 Vérification OTP (mode test): ${phoneNumber} -> ${otp}`);
        return {
          success: true,
          status: 'approved',
          testMode: true
        };
      }

      if (!this.config.serviceSid) {
        throw new Error('Service de vérification non configuré');
      }

      const formattedNumber = this.formatPhoneNumber(phoneNumber);
      
      const verificationCheck = await this.client.verify.v2
        .services(this.config.serviceSid)
        .verificationChecks
        .create({
          to: formattedNumber,
          code: otp
        });

      return {
        success: verificationCheck.status === 'approved',
        status: verificationCheck.status
      };
      
    } catch (error) {
      console.error('Erreur vérification OTP:', error);
      return {
        success: false,
        status: 'failed',
        error: error.message
      };
    }
  }

  // Envoyer notification générale
  async sendNotification(phoneNumber, message, context = 'notification') {
    try {
      const formattedNumber = this.formatPhoneNumber(phoneNumber);
      
      // MODE TEST
      if (this.config.testMode) {
        console.log(`📢 Notification (mode test) à ${formattedNumber}: ${message}`);
        return {
          success: true,
          sid: `test_notification_${Date.now()}`,
          status: 'delivered',
          to: formattedNumber,
          testMode: true
        };
      }

      const messageResult = await this.client.messages.create({
        body: message,
        from: this.config.phoneNumber,
        to: formattedNumber
      });

      return {
        success: true,
        sid: messageResult.sid,
        status: messageResult.status,
        to: formattedNumber
      };
      
    } catch (error) {
      console.error('Erreur envoi notification:', error);
      throw new Error('Erreur lors de l\'envoi de la notification');
    }
  }

  // Vérifier disponibilité service
  async checkServiceHealth() {
    try {
      // MODE TEST
      if (this.config.testMode) {
        return {
          success: true,
          accountSid: 'TEST_MODE',
          status: 'active',
          balance: 'Mode test',
          testMode: true
        };
      }

      const account = await this.client.api.accounts(this.config.accountSid).fetch();
      
      return {
        success: true,
        accountSid: account.sid,
        status: account.status,
        balance: account.balance || 'N/A'
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Instance singleton
const twilioService = new TwilioService();

module.exports = {
  twilioService,
  TwilioService
};