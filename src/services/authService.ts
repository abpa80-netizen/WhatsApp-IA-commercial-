import { 
  auth, 
  phoneToAuthEmail, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  signInWithPopup, 
  googleProvider, 
  FirebaseUser 
} from '../firebase';
import { FirestoreService, DEFAULT_GLOBAL_SETTINGS } from './firestoreService';
import { Vendeur } from '../types';

export const ADMIN_EMAIL = 'foosco80@gmail.com';

/**
 * Normalizes any user-entered WhatsApp phone number into standard international format.
 * Strips non-digits, handles leading trunk zeros, and validates length.
 */
export function normalizeWhatsAppNumber(
  rawPhone: string, 
  defaultPrefix = '+212'
): { fullPhone: string; cleanDigits: string; isValid: boolean; errorMessage?: string } {
  const trimmed = (rawPhone || '').trim();
  if (!trimmed) {
    return { 
      fullPhone: '', 
      cleanDigits: '', 
      isValid: false, 
      errorMessage: 'Veuillez renseigner votre numéro de téléphone WhatsApp.' 
    };
  }

  const rawDigits = trimmed.replace(/\D/g, '');
  const prefixDigits = defaultPrefix.replace(/\D/g, '');

  let cleanDigits = rawDigits;

  if (trimmed.startsWith('+')) {
    // Already in international format
    cleanDigits = rawDigits;
  } else if (rawDigits.startsWith(prefixDigits)) {
    // User typed the prefix digits directly without the '+' sign
    cleanDigits = rawDigits;
  } else {
    // Prepend default prefix, removing local trunk leading zero (e.g. 0600000000 -> 600000000)
    const withoutTrunkZero = rawDigits.replace(/^0+/, '');
    cleanDigits = `${prefixDigits}${withoutTrunkZero}`;
  }

  // International phone numbers must have between 8 and 16 digits
  if (cleanDigits.length < 8 || cleanDigits.length > 16) {
    return {
      fullPhone: '',
      cleanDigits,
      isValid: false,
      errorMessage: 'Le numéro WhatsApp doit comporter entre 8 et 16 chiffres valides avec indicatif.'
    };
  }

  return {
    fullPhone: `+${cleanDigits}`,
    cleanDigits,
    isValid: true
  };
}

/**
 * Validates password rules according to platform security standards.
 */
export function validatePassword(password: string): { isValid: boolean; errorMessage?: string } {
  if (!password || password.length < 6) {
    return { 
      isValid: false, 
      errorMessage: 'Le mot de passe doit comporter au moins 6 caractères.' 
    };
  }
  if (password.length > 128) {
    return { 
      isValid: false, 
      errorMessage: 'Le mot de passe ne doit pas dépasser 128 caractères.' 
    };
  }
  return { isValid: true };
}

export const AuthService = {
  /**
   * Vendor Registration (Créer mon compte)
   * Strictly isolated from login. Creates a new Firebase Auth account and initialises
   * the corresponding Firestore seller document with role 'seller'.
   * Zero passwords stored in Firestore or localStorage.
   */
  async register(
    phone: string, 
    password: string, 
    confirmPassword?: string, 
    name?: string
  ): Promise<Vendeur> {
    // 1. Validate WhatsApp phone number
    const phoneNorm = normalizeWhatsAppNumber(phone);
    if (!phoneNorm.isValid) {
      throw new Error(phoneNorm.errorMessage || 'Numéro WhatsApp invalide.');
    }

    // 2. Validate password
    const pwdCheck = validatePassword(password);
    if (!pwdCheck.isValid) {
      throw new Error(pwdCheck.errorMessage || 'Mot de passe invalide.');
    }

    // 3. Validate password confirmation
    if (confirmPassword !== undefined && password !== confirmPassword) {
      throw new Error('Les deux mots de passe ne correspondent pas.');
    }

    // 4. Map normalized WhatsApp phone to technical Firebase Auth identifier
    // Technical alias format: ${cleanDigits}@wa.wca.app (Passes Firebase Auth RFC 5322 email spec)
    const authEmail = phoneToAuthEmail(phoneNorm.cleanDigits);

    // 5. Create Firebase Auth account
    let userCred;
    try {
      userCred = await createUserWithEmailAndPassword(auth, authEmail, password);
    } catch (err: any) {
      if (err?.code === 'auth/operation-not-allowed') {
        throw new Error(
          'Le service d’accès par mot de passe n’est pas encore activé sur le serveur Firebase (Email/Password Provider). Veuillez l’activer dans la console Firebase (Authentication > Sign-in method).'
        );
      }
      if (err?.code === 'auth/email-already-in-use') {
        throw new Error('Ce numéro WhatsApp possède déjà un compte. Veuillez vous connecter.');
      }
      if (err?.code === 'auth/weak-password') {
        throw new Error('Le mot de passe doit comporter au moins 6 caractères.');
      }
      if (err?.code === 'auth/invalid-email') {
        throw new Error('Numéro WhatsApp non convertible en identifiant de sécurité.');
      }
      if (err?.code === 'auth/network-request-failed') {
        throw new Error('Erreur de connexion réseau. Veuillez vérifier votre connexion Internet.');
      }
      if (err?.code === 'auth/too-many-requests') {
        throw new Error('Trop de tentatives infructueuses. Veuillez patienter quelques minutes.');
      }
      throw new Error(err?.message || 'Erreur lors de la création du compte de sécurité.');
    }

    const uid = userCred.user.uid;

    // 6. Fetch dynamic trial configuration from global settings
    let trialDays = 7;
    try {
      const globalConfig = await FirestoreService.getGlobalSettings();
      trialDays = globalConfig.trialDays ?? globalConfig.trial_days ?? 7;
    } catch (e) {
      console.warn('Could not read dynamic trial configuration, using default of 7 days:', e);
    }

    const now = new Date().toISOString();
    const trialEndsAt = new Date(Date.now() + trialDays * 86400000).toISOString();
    const cleanDigits = phoneNorm.cleanDigits;
    const fullPhone = phoneNorm.fullPhone;
    const publicSlug = `boutique-${cleanDigits.slice(-6) || uid.slice(0, 8)}`;

    // 7. Initialise seller profile document in Firestore (NO password stored)
    const newVendor: Partial<Vendeur> = {
      uid,
      id: uid,
      phone: fullPhone,
      whatsappNumber: fullPhone,
      phoneNormalized: cleanDigits,
      name: name?.trim() || `Boutique ${cleanDigits.slice(-4)}`,
      slogan: 'Vente directe & service rapide sur WhatsApp',
      location: cleanDigits.startsWith('212') ? 'Casablanca, Maroc' : 'Abidjan, Côte d’Ivoire',
      logo: 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=400&q=80',
      currency: cleanDigits.startsWith('212') ? 'MAD' : 'CFA',
      role: 'seller', // Enforced seller role
      status: 'Actif',
      plan: 'Essai',
      trialStartedAt: now,
      trialEndsAt: trialEndsAt,
      date_expiration_essai: trialEndsAt,
      publicSlug: publicSlug,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const savedProfile = await FirestoreService.saveUserProfile(uid, newVendor);
      return savedProfile;
    } catch (saveErr: any) {
      console.error('Critical: Firebase Auth account created but Firestore profile write failed:', saveErr);
      // Safe recovery guarantee: user can log in to finish setup
      throw new Error(
        'Votre compte d’authentification a été créé mais le profil Firestore a rencontré un problème d’écriture. Veuillez vous connecter pour finaliser la synchronisation de votre profil.'
      );
    }
  },

  /**
   * Vendor Login (Se connecter)
   * Strictly checks existing accounts.
   * ABSOLUTE RULE: If the account does not exist, connection is rejected.
   * NEVER calls createUserWithEmailAndPassword nor any registration function.
   * NEVER creates an account automatically.
   */
  async login(phone: string, password: string): Promise<Vendeur> {
    const phoneNorm = normalizeWhatsAppNumber(phone);
    if (!phoneNorm.isValid) {
      throw new Error(phoneNorm.errorMessage || 'Veuillez saisir un numéro WhatsApp valide.');
    }
    if (!password || password.trim().length === 0) {
      throw new Error('Veuillez saisir votre mot de passe.');
    }

    const authEmail = phoneToAuthEmail(phoneNorm.cleanDigits);

    let userCred;
    try {
      userCred = await signInWithEmailAndPassword(auth, authEmail, password);
    } catch (err: any) {
      if (err?.code === 'auth/operation-not-allowed') {
        throw new Error(
          'Le service d’accès par mot de passe n’est pas encore activé sur le serveur Firebase (Email/Password Provider). Veuillez l’activer dans la console Firebase (Authentication > Sign-in method).'
        );
      }
      // Rejection of invalid / non-existent accounts
      if (
        err?.code === 'auth/user-not-found' || 
        err?.code === 'auth/wrong-password' || 
        err?.code === 'auth/invalid-credential'
      ) {
        throw new Error('Numéro WhatsApp ou mot de passe incorrect. Si vous n’avez pas encore de compte, veuillez cliquer sur « Créer mon compte ».');
      }
      if (err?.code === 'auth/network-request-failed') {
        throw new Error('Erreur de connexion réseau. Veuillez vérifier votre connexion Internet.');
      }
      if (err?.code === 'auth/too-many-requests') {
        throw new Error('Trop de tentatives infructueuses. Veuillez patienter quelques minutes.');
      }
      throw new Error(err?.message || 'Erreur lors de la connexion.');
    }

    const uid = userCred.user.uid;

    // Fetch vendor profile in Firestore
    let profile = await FirestoreService.getUserProfile(uid);

    // Safe recovery mechanism:
    // If user is authenticated in Firebase Auth but profile document was missing or interrupted during previous registration
    if (!profile) {
      console.warn(`User ${uid} authenticated but missing Firestore profile. Restoring seller profile safely.`);
      const config = await FirestoreService.getGlobalSettings().catch(() => DEFAULT_GLOBAL_SETTINGS);
      const trialDays = config.trialDays ?? config.trial_days ?? 7;
      const now = new Date().toISOString();
      const trialEndsAt = new Date(Date.now() + trialDays * 86400000).toISOString();
      const cleanDigits = phoneNorm.cleanDigits;
      const fullPhone = phoneNorm.fullPhone;

      profile = await FirestoreService.saveUserProfile(uid, {
        uid,
        id: uid,
        phone: fullPhone,
        whatsappNumber: fullPhone,
        phoneNormalized: cleanDigits,
        name: `Boutique ${cleanDigits.slice(-4)}`,
        slogan: 'Vente directe & service rapide sur WhatsApp',
        location: cleanDigits.startsWith('212') ? 'Casablanca, Maroc' : 'Abidjan, Côte d’Ivoire',
        logo: 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=400&q=80',
        currency: cleanDigits.startsWith('212') ? 'MAD' : 'CFA',
        role: 'seller',
        status: 'Actif',
        plan: 'Essai',
        trialStartedAt: now,
        trialEndsAt: trialEndsAt,
        date_expiration_essai: trialEndsAt,
        publicSlug: `boutique-${cleanDigits.slice(-6) || uid.slice(0, 8)}`,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (profile.status === 'Inactif' || profile.status === 'Suspendu') {
      throw new Error('Votre compte vendeur est suspendu ou désactivé par l’administration.');
    }

    return profile;
  },

  /**
   * Verified check whether a user or email is the authorized admin
   */
  isAdminUser(user?: FirebaseUser | null): boolean {
    const u = user || auth.currentUser;
    return Boolean(u && u.email && u.email.trim().toLowerCase() === 'foosco80@gmail.com');
  },

  /**
   * Super Admin Firebase Google Authentication (Strictly for foosco80@gmail.com)
   */
  async loginAdminWithGoogle(): Promise<FirebaseUser> {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    const email = user.email?.trim().toLowerCase();

    if (email !== 'foosco80@gmail.com') {
      await signOut(auth);
      throw new Error(`Accès refusé : Le compte Google (${user.email || 'inconnu'}) n’est pas autorisé. Seul le compte foosco80@gmail.com a les droits administrateur.`);
    }

    // Ensure admin document exists in Firestore
    let profile = await FirestoreService.getUserProfile(user.uid);
    if (!profile) {
      const now = new Date().toISOString();
      await FirestoreService.saveUserProfile(user.uid, {
        uid: user.uid,
        id: user.uid,
        phone: user.phoneNumber || '+212600000000',
        whatsappNumber: user.phoneNumber || '+212600000000',
        phoneNormalized: (user.phoneNumber || '').replace(/\D/g, ''),
        name: user.displayName || 'Super Administrateur',
        role: 'admin',
        status: 'Actif',
        plan: 'VIP',
        createdAt: now,
      });
    }

    return user;
  },

  /**
   * Super Admin Firebase Email/Password Authentication (Strictly for foosco80@gmail.com)
   * Validated server-side by Firebase Authentication. Never bypasses.
   */
  async loginAdminWithPassword(password: string): Promise<FirebaseUser> {
    if (!password || password.trim().length === 0) {
      throw new Error('Veuillez saisir votre mot de passe administrateur.');
    }

    let userCred;
    try {
      userCred = await signInWithEmailAndPassword(auth, 'foosco80@gmail.com', password.trim());
    } catch (err: any) {
      if (err?.code === 'auth/wrong-password' || err?.code === 'auth/invalid-credential') {
        throw new Error('Mot de passe administrateur incorrect.');
      }
      if (err?.code === 'auth/user-not-found') {
        throw new Error('Aucun compte administrateur trouvé pour foosco80@gmail.com. Vous pouvez utiliser la connexion Google autorisée.');
      }
      if (err?.code === 'auth/too-many-requests') {
        throw new Error('Trop de tentatives infructueuses. Veuillez patienter quelques minutes.');
      }
      throw new Error(err?.message || 'Erreur d’authentification administrateur.');
    }

    const user = userCred.user;
    if (user.email?.trim().toLowerCase() !== 'foosco80@gmail.com') {
      await signOut(auth);
      throw new Error('Accès refusé : Seul le compte foosco80@gmail.com est autorisé.');
    }

    return user;
  },

  /**
   * Auxiliary Google Sign-In (Reserved for administration / Workspace identity if needed)
   */
  async loginWithGoogle(): Promise<Vendeur> {
    const user = await this.loginAdminWithGoogle();
    const profile = await FirestoreService.getUserProfile(user.uid);
    return profile || {
      id: user.uid,
      uid: user.uid,
      phone: user.phoneNumber || '+212600000000',
      whatsappNumber: user.phoneNumber || '+212600000000',
      phoneNormalized: (user.phoneNumber || '').replace(/\D/g, ''),
      name: user.displayName || 'Super Administrateur',
      role: 'admin',
      status: 'Actif',
      plan: 'VIP',
      currency: 'MAD',
      is_active: true,
      createdAt: new Date().toISOString(),
    } as Vendeur;
  },

  /**
   * Disconnects current session
   */
  async logout(): Promise<void> {
    await signOut(auth);
  },

  /**
   * Return current authenticated Firebase user
   */
  getCurrentUser(): FirebaseUser | null {
    return auth.currentUser;
  }
};
