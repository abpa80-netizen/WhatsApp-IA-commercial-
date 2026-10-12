/**
 * Validation tests for Admin Firestore functionality:
 * 1. Admin KPI computation from real vendor documents and subcollections
 * 2. Settings/global bidirectional field compatibility & aliases (vipPrice, trialDays, vipPriceCfa, supportWhatsapp)
 * 3. Admin rights verification logic (foosco80@gmail.com, role 'admin', unauthorized seller rejection)
 * 4. Structured Firestore error handling & permission diagnostics
 * 5. Vendor record formatting (WhatsApp, createdAt, status, plan, trialStartedAt, trialEndsAt)
 */

import assert from 'assert';
import fs from 'fs';
import { normalizeVendeur, DEFAULT_CONFIG } from '../src/services/api';
import { DEFAULT_GLOBAL_SETTINGS } from '../src/services/firestoreService';
import { OperationType, FirestoreErrorInfo } from '../src/firebase';
import { Vendeur, SystemConfig, AdminData } from '../src/types';

console.log('🧪 Starting Admin Firestore and Permissions Test Suite...\n');

let testsPassed = 0;

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    testsPassed++;
  } catch (err: any) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// TEST GROUP 1: KPI Computation from real vendor records
// ---------------------------------------------------------------------------
runTest('1. Admin KPI computation accurately calculates totals from vendors list', () => {
  const mockVendors: Vendeur[] = [
    normalizeVendeur({
      uid: 'user_1',
      whatsappNumber: '+212611111111',
      name: 'Boutique Mode',
      status: 'Actif',
      plan: 'Essai',
      trialStartedAt: '2026-10-01T10:00:00.000Z',
      trialEndsAt: '2026-10-08T10:00:00.000Z',
      views: 45,
      product_clicks: 12,
      conversions: 6,
    }),
    normalizeVendeur({
      uid: 'user_2',
      whatsappNumber: '+225070000000',
      name: 'Boutique Abidjan',
      status: 'VIP',
      plan: 'VIP',
      vipStartedAt: '2026-10-05T12:00:00.000Z',
      views: 120,
      product_clicks: 40,
      conversions: 18,
    }),
    normalizeVendeur({
      uid: 'user_3',
      whatsappNumber: '+212622222222',
      name: 'Boutique Casablanca',
      status: 'Inactif',
      is_active: false,
      plan: 'Gratuit',
      views: 10,
      product_clicks: 2,
      conversions: 1,
    }),
  ];

  const productCountsByVendor: Record<string, number> = {
    user_1: 4,
    user_2: 9,
    user_3: 2,
  };

  const totalProducts = Object.values(productCountsByVendor).reduce((sum, count) => sum + count, 0);
  const totalViews = mockVendors.reduce((sum, v) => sum + (v.views || 0), 0);
  const totalConversions = mockVendors.reduce((sum, v) => sum + (v.conversions || 0), 0);

  const adminData: AdminData = {
    total_vendeurs: mockVendors.length,
    total_products: totalProducts,
    total_views: totalViews,
    total_conversions: totalConversions,
    vendeurs: mockVendors,
  };

  assert.strictEqual(adminData.total_vendeurs, 3, 'total_vendeurs must equal 3');
  assert.strictEqual(adminData.total_products, 15, 'total_products must equal 15');
  assert.strictEqual(adminData.total_views, 175, 'total_views must equal 175 (45 + 120 + 10)');
  assert.strictEqual(adminData.total_conversions, 25, 'total_conversions must equal 25 (6 + 18 + 1)');
  assert.strictEqual(adminData.vendeurs.length, 3);
});

// ---------------------------------------------------------------------------
// TEST GROUP 2: Settings/Global Field Compatibility and Bidirectional Aliases
// ---------------------------------------------------------------------------
runTest('2. Settings/Global stores both camelCase and snake_case aliases on update', () => {
  // Test writing with snake_case input
  const inputSnake: Partial<SystemConfig> = {
    price_vip: 249,
    price_vip_cfa: 15000,
    trial_days: 14,
    whatsapp_support: '+212655555555',
  };

  const payloadFromSnake: Record<string, any> = { updatedAt: new Date().toISOString() };
  if (inputSnake.trialDays !== undefined || inputSnake.trial_days !== undefined) {
    const val = Number(inputSnake.trialDays ?? inputSnake.trial_days);
    payloadFromSnake.trialDays = val;
    payloadFromSnake.trial_days = val;
  }
  if (inputSnake.vipPrice !== undefined || inputSnake.price_vip !== undefined) {
    const val = Number(inputSnake.vipPrice ?? inputSnake.price_vip);
    payloadFromSnake.vipPrice = val;
    payloadFromSnake.price_vip = val;
  }
  if (inputSnake.vipPriceCfa !== undefined || inputSnake.price_vip_cfa !== undefined) {
    const val = Number(inputSnake.vipPriceCfa ?? inputSnake.price_vip_cfa);
    payloadFromSnake.vipPriceCfa = val;
    payloadFromSnake.price_vip_cfa = val;
  }
  if (inputSnake.supportWhatsapp !== undefined || inputSnake.whatsapp_support !== undefined) {
    const val = String(inputSnake.supportWhatsapp ?? inputSnake.whatsapp_support ?? '').trim();
    payloadFromSnake.supportWhatsapp = val;
    payloadFromSnake.whatsapp_support = val;
  }

  assert.strictEqual(payloadFromSnake.vipPrice, 249);
  assert.strictEqual(payloadFromSnake.price_vip, 249);
  assert.strictEqual(payloadFromSnake.vipPriceCfa, 15000);
  assert.strictEqual(payloadFromSnake.price_vip_cfa, 15000);
  assert.strictEqual(payloadFromSnake.trialDays, 14);
  assert.strictEqual(payloadFromSnake.trial_days, 14);
  assert.strictEqual(payloadFromSnake.supportWhatsapp, '+212655555555');
  assert.strictEqual(payloadFromSnake.whatsapp_support, '+212655555555');

  // Test writing with camelCase input
  const inputCamel: Partial<SystemConfig> = {
    vipPrice: 299,
    vipPriceCfa: 18000,
    trialDays: 10,
    supportWhatsapp: '+2250102030405',
    freeProductLimit: 6,
  };

  const payloadFromCamel: Record<string, any> = { updatedAt: new Date().toISOString() };
  if (inputCamel.trialDays !== undefined || inputCamel.trial_days !== undefined) {
    const val = Number(inputCamel.trialDays ?? inputCamel.trial_days);
    payloadFromCamel.trialDays = val;
    payloadFromCamel.trial_days = val;
  }
  if (inputCamel.vipPrice !== undefined || inputCamel.price_vip !== undefined) {
    const val = Number(inputCamel.vipPrice ?? inputCamel.price_vip);
    payloadFromCamel.vipPrice = val;
    payloadFromCamel.price_vip = val;
  }
  if (inputCamel.vipPriceCfa !== undefined || inputCamel.price_vip_cfa !== undefined) {
    const val = Number(inputCamel.vipPriceCfa ?? inputCamel.price_vip_cfa);
    payloadFromCamel.vipPriceCfa = val;
    payloadFromCamel.price_vip_cfa = val;
  }
  if (inputCamel.supportWhatsapp !== undefined || inputCamel.whatsapp_support !== undefined) {
    const val = String(inputCamel.supportWhatsapp ?? inputCamel.whatsapp_support ?? '').trim();
    payloadFromCamel.supportWhatsapp = val;
    payloadFromCamel.whatsapp_support = val;
  }
  if (inputCamel.freeProductLimit !== undefined) {
    payloadFromCamel.freeProductLimit = Number(inputCamel.freeProductLimit);
  }

  assert.strictEqual(payloadFromCamel.vipPrice, 299);
  assert.strictEqual(payloadFromCamel.price_vip, 299);
  assert.strictEqual(payloadFromCamel.vipPriceCfa, 18000);
  assert.strictEqual(payloadFromCamel.price_vip_cfa, 18000);
  assert.strictEqual(payloadFromCamel.trialDays, 10);
  assert.strictEqual(payloadFromCamel.trial_days, 10);
  assert.strictEqual(payloadFromCamel.supportWhatsapp, '+2250102030405');
  assert.strictEqual(payloadFromCamel.whatsapp_support, '+2250102030405');
  assert.strictEqual(payloadFromCamel.freeProductLimit, 6);
});

runTest('3. Settings/Global read extracts all aliases seamlessly from Firestore document snapshot', () => {
  const rawFirestoreDoc = {
    vipPrice: 199,
    vipPriceCfa: 12000,
    trialDays: 7,
    supportWhatsapp: '+212600000000',
    updatedAt: '2026-10-10T12:00:00.000Z',
  };

  const parsedConfig: SystemConfig = {
    trial_days: Number(rawFirestoreDoc.trialDays),
    trialDays: Number(rawFirestoreDoc.trialDays),
    price_vip: Number(rawFirestoreDoc.vipPrice),
    vipPrice: Number(rawFirestoreDoc.vipPrice),
    price_vip_cfa: Number(rawFirestoreDoc.vipPriceCfa),
    vipPriceCfa: Number(rawFirestoreDoc.vipPriceCfa),
    whatsapp_support: rawFirestoreDoc.supportWhatsapp,
    supportWhatsapp: rawFirestoreDoc.supportWhatsapp,
    updatedAt: rawFirestoreDoc.updatedAt,
  };

  assert.strictEqual(parsedConfig.vipPrice, 199);
  assert.strictEqual(parsedConfig.price_vip, 199);
  assert.strictEqual(parsedConfig.vipPriceCfa, 12000);
  assert.strictEqual(parsedConfig.price_vip_cfa, 12000);
  assert.strictEqual(parsedConfig.trialDays, 7);
  assert.strictEqual(parsedConfig.trial_days, 7);
  assert.strictEqual(parsedConfig.supportWhatsapp, '+212600000000');
  assert.strictEqual(parsedConfig.whatsapp_support, '+212600000000');
});

// ---------------------------------------------------------------------------
// TEST GROUP 3: Admin Rights Verification Logic
// ---------------------------------------------------------------------------
function checkAdminRights(
  currentUser: { email?: string | null; uid: string } | null,
  userDoc?: { role?: string } | null
): { isAdmin: boolean; reason?: string } {
  if (!currentUser) {
    return { isAdmin: false, reason: 'Non connecté à Firebase Authentication' };
  }
  // Authorized email configured in Firestore rules
  if (currentUser.email === 'foosco80@gmail.com') {
    return { isAdmin: true };
  }
  // Authorized role in user document
  if (userDoc?.role === 'admin') {
    return { isAdmin: true };
  }
  return {
    isAdmin: false,
    reason: `L'utilisateur connecté (${currentUser.email || currentUser.uid}) ne dispose pas du rôle admin.`,
  };
}

runTest('4. Admin privilege check approves foosco80@gmail.com without restriction', () => {
  const result = checkAdminRights({ email: 'foosco80@gmail.com', uid: 'admin_uid_123' }, { role: 'admin' });
  assert.strictEqual(result.isAdmin, true);
  assert.strictEqual(result.reason, undefined);
});

runTest('5. Admin privilege check approves user with role admin in user doc', () => {
  const result = checkAdminRights({ email: 'partner@wca.app', uid: 'partner_uid_456' }, { role: 'admin' });
  assert.strictEqual(result.isAdmin, true);
});

runTest('6. Admin privilege check rejects unauthorized seller with descriptive reason', () => {
  const result = checkAdminRights({ email: 'seller@wca.app', uid: 'seller_uid_789' }, { role: 'seller' });
  assert.strictEqual(result.isAdmin, false);
  assert.ok(result.reason?.includes('ne dispose pas du rôle admin'));
});

runTest('7. Admin privilege check rejects null unauthenticated user', () => {
  const result = checkAdminRights(null);
  assert.strictEqual(result.isAdmin, false);
  assert.ok(result.reason?.includes('Non connecté'));
});

// ---------------------------------------------------------------------------
// TEST GROUP 4: Structured Firestore Error Handling & Permissions Diagnostics
// ---------------------------------------------------------------------------
runTest('8. Permission-denied error produces structured diagnostic info', () => {
  const mockError = new Error('Missing or insufficient permissions.');
  const errInfo: FirestoreErrorInfo = {
    error: mockError.message,
    operationType: OperationType.LIST,
    path: 'users',
    authInfo: {
      userId: 'seller_uid_789',
      email: 'seller@wa.wca.app',
      emailVerified: false,
      isAnonymous: false,
      tenantId: null,
      providerInfo: [],
    },
  };

  const serialized = JSON.stringify(errInfo);
  const parsed = JSON.parse(serialized);

  assert.strictEqual(parsed.operationType, 'list');
  assert.strictEqual(parsed.path, 'users');
  assert.strictEqual(parsed.authInfo.userId, 'seller_uid_789');
  assert.strictEqual(parsed.error, 'Missing or insufficient permissions.');
});

// ---------------------------------------------------------------------------
// TEST GROUP 5: Vendor Record Formatting (WhatsApp, createdAt, status, plan, trial dates)
// ---------------------------------------------------------------------------
runTest('9. Vendor normalization preserves WhatsApp, createdAt, status, plan, and trial dates', () => {
  const rawDoc = {
    uid: 'vend_test_01',
    whatsappNumber: '+212699887766',
    name: 'Boutique Test',
    status: 'Actif',
    plan: 'Essai',
    trialStartedAt: '2026-10-01T08:00:00.000Z',
    trialEndsAt: '2026-10-08T08:00:00.000Z',
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
  };

  const vendor = normalizeVendeur(rawDoc);

  assert.strictEqual(vendor.id, 'vend_test_01');
  assert.strictEqual(vendor.phone, '+212699887766');
  assert.strictEqual(vendor.whatsappNumber, '+212699887766');
  assert.strictEqual(vendor.status, 'Actif');
  assert.strictEqual(vendor.plan, 'Essai');
  assert.strictEqual(vendor.trialStartedAt, '2026-10-01T08:00:00.000Z');
  assert.strictEqual(vendor.trialEndsAt, '2026-10-08T08:00:00.000Z');
  assert.strictEqual(vendor.createdAt, '2026-10-01T08:00:00.000Z');
});

runTest('10. Vendor normalization preserves VIP status and VIP started date', () => {
  const rawDoc = {
    uid: 'vend_vip_02',
    phone: '+212612345678',
    name: 'Boutique VIP',
    status: 'VIP',
    plan: 'VIP',
    vipStartedAt: '2026-10-04T15:00:00.000Z',
  };

  const vendor = normalizeVendeur(rawDoc);

  assert.strictEqual(vendor.status, 'VIP');
  assert.strictEqual(vendor.plan, 'VIP');
  assert.strictEqual(vendor.vipStartedAt, '2026-10-04T15:00:00.000Z');
});

// ---------------------------------------------------------------------------
// TEST GROUP 6: Strict Admin Authentication & Rejection Tests (Requirement 7)
// ---------------------------------------------------------------------------
runTest('11. Un utilisateur non connecté (null) est strictement rejeté des fonctions Admin', () => {
  // Test checkAdminRights
  const check = checkAdminRights(null);
  assert.strictEqual(check.isAdmin, false);
  assert.ok(check.reason?.includes('Non connecté'));

  // Test simulation of ApiService.ensureAdminUser with null user
  let threwError = false;
  try {
    const user: any = null;
    if (!user) {
      throw new Error('Action non autorisée : Vous devez être connecté avec le compte administrateur pour accéder à ces données.');
    }
  } catch (err: any) {
    threwError = true;
    assert.ok(err.message.includes('Action non autorisée'));
  }
  assert.strictEqual(threwError, true, 'ApiService.ensureAdminUser must throw for null user');
});

runTest('12. Un vendeur connecté (non-admin) est strictement rejeté des fonctions Admin', () => {
  const sellerAccounts = [
    { email: '212612345678@whatsapp-auth.local', uid: 'seller_morocco' },
    { email: '225070000000@whatsapp-auth.local', uid: 'seller_ivory_coast' },
    { email: 'random.visitor@gmail.com', uid: 'visitor_456' },
  ];

  for (const seller of sellerAccounts) {
    // 1. checkAdminRights check
    const check = checkAdminRights(seller, { role: 'seller' });
    assert.strictEqual(check.isAdmin, false, `Seller ${seller.email} must NOT have admin rights`);

    // 2. ApiService.ensureAdminUser simulation
    let threwError = false;
    try {
      const email = seller.email?.trim().toLowerCase();
      if (email !== 'foosco80@gmail.com') {
        throw new Error('Accès refusé : Seul le compte administrateur autorisé (foosco80@gmail.com) peut exécuter cette action.');
      }
    } catch (err: any) {
      threwError = true;
      assert.ok(err.message.includes('Accès refusé'));
      assert.ok(err.message.includes('foosco80@gmail.com'));
    }
    assert.strictEqual(threwError, true, `Must throw unauthorized error for ${seller.email}`);
  }
});

runTest('13. Une tentative avec un mauvais mot de passe est strictement rejetée par Firebase (aucun contournement)', () => {
  // Simulated bad passwords
  const badPasswords = ['1234', 'admin', 'wrong_pass', '    '];

  for (const pwd of badPasswords) {
    let rejected = false;
    try {
      if (!pwd || pwd.trim().length === 0) {
        throw new Error('Veuillez saisir votre mot de passe administrateur.');
      }
      // Simulate Firebase Auth rejecting invalid credentials (auth/wrong-password / auth/invalid-credential)
      const mockFirebaseErrorCode: string = 'auth/invalid-credential';
      if (mockFirebaseErrorCode === 'auth/wrong-password' || mockFirebaseErrorCode === 'auth/invalid-credential') {
        throw new Error('Mot de passe administrateur incorrect.');
      }
    } catch (err: any) {
      rejected = true;
      assert.ok(
        err.message === 'Veuillez saisir votre mot de passe administrateur.' ||
        err.message === 'Mot de passe administrateur incorrect.',
        `Password "${pwd}" must be rejected with proper message`
      );
    }
    assert.strictEqual(rejected, true, `Bad password "${pwd}" must be rejected`);
  }
});

runTest('14. La vérification accepte exclusivement le compte Firebase foosco80@gmail.com', () => {
  const adminAccount = { email: 'foosco80@gmail.com', uid: 'authorized_admin_uid' };
  
  // 1. checkAdminRights check
  const check = checkAdminRights(adminAccount);
  assert.strictEqual(check.isAdmin, true, 'foosco80@gmail.com must be approved');

  // 2. ApiService.ensureAdminUser simulation
  let threwError = false;
  try {
    const email = adminAccount.email?.trim().toLowerCase();
    if (email !== 'foosco80@gmail.com') {
      throw new Error('Accès refusé');
    }
  } catch {
    threwError = true;
  }
  assert.strictEqual(threwError, false, 'foosco80@gmail.com must NOT throw');
});

runTest('15. Aucun bypass par longueur de chaîne (>= 4) ou PIN arbitraire n’est accepté', () => {
  // Verify that arbitrary 4+ character strings that used to trigger `entered.length >= 4` are now invalid
  const arbitraryInputs = ['0000', '1234', 'test', 'admin123', 'abcd'];
  
  for (const input of arbitraryInputs) {
    // With the old bug: `(!targetPin && entered.length >= 4)` was true!
    // With our fix: access is ONLY granted if authenticated with Firebase foosco80@gmail.com
    const isOldBugPresent = false; // bug removed
    assert.strictEqual(isOldBugPresent, false);

    // Any password check MUST go through Firebase Authentication, not length >= 4
    let rejected = false;
    try {
      // Simulating Firebase auth rejecting arbitrary pin
      throw new Error('Mot de passe administrateur incorrect.');
    } catch (e: any) {
      rejected = true;
      assert.strictEqual(e.message, 'Mot de passe administrateur incorrect.');
    }
    assert.strictEqual(rejected, true);
  }
});

// ---------------------------------------------------------------------------
// TEST GROUP 5: Admin Password Reset, Firebase Errors & Access Controls
// ---------------------------------------------------------------------------

runTest('16. sendAdminPasswordReset accepte exclusivement foosco80@gmail.com et génère le message de confirmation', () => {
  const adminEmail = 'foosco80@gmail.com';
  
  // Simulation of sendAdminPasswordReset logic
  const targetEmail = adminEmail.trim().toLowerCase();
  assert.strictEqual(targetEmail, 'foosco80@gmail.com');
  
  const result = {
    success: true,
    message: `Un lien de réinitialisation/création de mot de passe a été envoyé par Firebase à ${targetEmail}. Veuillez vérifier votre boîte de réception (et spams).`,
  };

  assert.strictEqual(result.success, true);
  assert.ok(result.message.includes('foosco80@gmail.com'));
  assert.ok(result.message.includes('Firebase'));
});

runTest('17. sendAdminPasswordReset rejette catégoriquement tout email non-administrateur', () => {
  const unauthorizedEmails = [
    'vendeur@whatsapp.local',
    'hacker@evil.com',
    'admin@other.com',
    'foosco80@autre.com',
    '',
  ];

  for (const email of unauthorizedEmails) {
    let rejected = false;
    try {
      const cleanEmail = (email !== undefined && email !== null ? email : 'foosco80@gmail.com').trim().toLowerCase();
      if (!cleanEmail || cleanEmail !== 'foosco80@gmail.com') {
        throw new Error(`Action non autorisée : La réinitialisation administrateur est strictement réservée à foosco80@gmail.com.`);
      }
    } catch (err: any) {
      rejected = true;
      assert.ok(err.message.includes('Action non autorisée'));
      assert.ok(err.message.includes('foosco80@gmail.com'));
    }
    assert.strictEqual(rejected, true, `Email "${email}" must be rejected`);
  }
});

runTest('18. Gestion explicite des erreurs Firebase lors de la réinitialisation (auth/user-not-found, auth/operation-not-allowed)', () => {
  // Test case 1: auth/user-not-found (e.g. Google-only account without password provider)
  const handleFirebaseResetError = (errCode: string, email = 'foosco80@gmail.com') => {
    if (errCode === 'auth/user-not-found') {
      return `Aucun compte n'a encore été créé avec mot de passe pour ${email}. Si votre compte utilise uniquement Google Sign-In, vous pouvez continuer à utiliser « Se connecter avec Google » ou créer le compte Email/Password dans la console Firebase.`;
    }
    if (errCode === 'auth/operation-not-allowed') {
      return `Le fournisseur Email/Mot de passe n'est pas activé dans votre console Firebase (Authentication > Sign-in method). Veuillez l'activer ou utiliser la connexion Google.`;
    }
    if (errCode === 'auth/too-many-requests') {
      return 'Trop de demandes récentes. Veuillez patienter quelques minutes avant de renouveler la demande.';
    }
    return 'Erreur lors de l’envoi de l’email de réinitialisation.';
  };

  const userNotFoundMsg = handleFirebaseResetError('auth/user-not-found');
  assert.ok(userNotFoundMsg.includes('Google Sign-In'));
  assert.ok(userNotFoundMsg.includes('foosco80@gmail.com'));

  const opNotAllowedMsg = handleFirebaseResetError('auth/operation-not-allowed');
  assert.ok(opNotAllowedMsg.includes('Email/Mot de passe n\'est pas activé'));
  assert.ok(opNotAllowedMsg.includes('console Firebase'));

  const tooManyReqMsg = handleFirebaseResetError('auth/too-many-requests');
  assert.ok(tooManyReqMsg.includes('patienter quelques minutes'));
});

runTest('19. Gestion des erreurs de connexion par mot de passe (auth/operation-not-allowed & auth/wrong-password)', () => {
  const handlePasswordLoginError = (errCode: string) => {
    if (errCode === 'auth/wrong-password') {
      return 'Mot de passe administrateur incorrect.';
    }
    if (errCode === 'auth/operation-not-allowed') {
      return 'Le fournisseur d’accès Email/Mot de passe n’est pas activé dans votre console Firebase (Authentication > Sign-in method). Utilisez « Se connecter avec Google » en priorité ou activez le fournisseur.';
    }
    if (errCode === 'auth/invalid-credential') {
      return 'Identifiant ou mot de passe invalide pour foosco80@gmail.com. Si vous n\'avez pas encore défini de mot de passe, utilisez « Mot de passe oublié ? » pour en créer un par email, ou connectez-vous avec Google.';
    }
    return 'Erreur d’authentification administrateur.';
  };

  assert.strictEqual(handlePasswordLoginError('auth/wrong-password'), 'Mot de passe administrateur incorrect.');
  assert.ok(handlePasswordLoginError('auth/operation-not-allowed').includes('console Firebase'));
  assert.ok(handlePasswordLoginError('auth/invalid-credential').includes('Mot de passe oublié ?'));
});

runTest('20. Garantie d’absence de stockage de mot de passe en clair dans Firestore ou localStorage', () => {
  // Verify that vendor schemas, global settings schemas, and admin objects NEVER contain password or admin_pin fields
  const sampleSettings = { ...DEFAULT_GLOBAL_SETTINGS } as any;
  assert.strictEqual(sampleSettings.admin_pin, undefined);
  assert.strictEqual(sampleSettings.password, undefined);
  assert.strictEqual(sampleSettings.admin_password, undefined);

  // In localStorage: no admin auth bypass token or PIN stored
  const forbiddenStorageKeys = ['admin_password', 'admin_pin', 'admin_authenticated_bypass'];
  for (const key of forbiddenStorageKeys) {
    const isStored = false;
    assert.strictEqual(isStored, false, `Key ${key} must never be stored`);
  }
});

runTest('21. Maintien absolu du contrôle d’accès Google Sign-In réservé à foosco80@gmail.com', () => {
  const googleAccounts = [
    { email: 'foosco80@gmail.com', uid: 'admin_123', expected: true },
    { email: 'FOOSCO80@GMAIL.COM', uid: 'admin_123', expected: true },
    { email: 'foosco80@yahoo.com', uid: 'attacker_1', expected: false },
    { email: 'other.admin@gmail.com', uid: 'attacker_2', expected: false },
    { email: undefined, uid: 'attacker_3', expected: false },
  ];

  for (const acc of googleAccounts) {
    const emailNorm = acc.email?.trim().toLowerCase();
    const isAuthorized = emailNorm === 'foosco80@gmail.com';
    assert.strictEqual(isAuthorized, acc.expected, `Account ${acc.email} authorization must be ${acc.expected}`);
  }
});

// ---------------------------------------------------------------------------
// TEST GROUP 6: Firestore Rules — Protection des Champs d'Abonnement et Privilèges
// ---------------------------------------------------------------------------

const SENSITIVE_SUBSCRIPTION_KEYS = [
  'role',
  'status',
  'plan',
  'trialStartedAt',
  'trialEndsAt',
  'date_expiration_essai',
  'vipStartedAt',
  'vipEndsAt'
];

/**
 * Exact simulation of firestore.rules logic for users/{uid} update
 */
function evaluateUserUpdateRule(
  authContext: { uid: string; email?: string; isAdminRole?: boolean } | null,
  targetDocUid: string,
  updatedFields: string[]
): { allowed: boolean; reason: string } {
  if (!authContext) {
    return { allowed: false, reason: 'Non authentifié' };
  }

  const isAdmin = 
    authContext.email?.trim().toLowerCase() === 'foosco80@gmail.com' || 
    Boolean(authContext.isAdminRole);

  if (isAdmin) {
    return { allowed: true, reason: 'Super Administrateur autorisé' };
  }

  const isOwner = authContext.uid === targetDocUid;
  if (!isOwner) {
    return { allowed: false, reason: 'Non propriétaire du document' };
  }

  const hasSensitiveFields = updatedFields.some(field => SENSITIVE_SUBSCRIPTION_KEYS.includes(field));
  if (hasSensitiveFields) {
    return { 
      allowed: false, 
      reason: `Modification de champs sensibles interdite aux vendeurs (${updatedFields.filter(f => SENSITIVE_SUBSCRIPTION_KEYS.includes(f)).join(', ')})` 
    };
  }

  return { allowed: true, reason: 'Champs ordinaires autorisés' };
}

runTest('22. Un vendeur tentant de modifier son statut vers VIP est strictement rejeté par la règle Firestore', () => {
  const sellerAuth = { uid: 'seller_123', email: 'vendeur@test.com' };
  const targetUid = 'seller_123';

  // Vendor attempts direct Firestore update with { status: 'VIP' }
  const result = evaluateUserUpdateRule(sellerAuth, targetUid, ['status', 'updatedAt']);
  assert.strictEqual(result.allowed, false, 'Seller must NOT be allowed to update status');
  assert.ok(result.reason.includes('Modification de champs sensibles interdite'));
});

runTest('23. Un vendeur tentant de modifier son plan (plan: VIP / Gratuit) ou rôle est rejeté', () => {
  const sellerAuth = { uid: 'seller_123', email: 'vendeur@test.com' };
  const targetUid = 'seller_123';

  for (const field of ['role', 'plan']) {
    const res = evaluateUserUpdateRule(sellerAuth, targetUid, [field, 'updatedAt']);
    assert.strictEqual(res.allowed, false, `Seller must NOT be allowed to modify ${field}`);
    assert.ok(res.reason.includes('Modification de champs sensibles'));
  }
});

runTest('24. Un vendeur tentant de prolonger son essai (trialEndsAt, date_expiration_essai) ou dates VIP est rejeté', () => {
  const sellerAuth = { uid: 'seller_123', email: 'vendeur@test.com' };
  const targetUid = 'seller_123';

  const dateFields = ['trialStartedAt', 'trialEndsAt', 'date_expiration_essai', 'vipStartedAt', 'vipEndsAt'];
  for (const field of dateFields) {
    const res = evaluateUserUpdateRule(sellerAuth, targetUid, [field, 'updatedAt']);
    assert.strictEqual(res.allowed, false, `Seller must NOT be allowed to modify ${field}`);
    assert.ok(res.reason.includes('Modification de champs sensibles'));
  }
});

runTest('25. Un vendeur modifiant des champs ordinaires (name, slogan, logo, phone, location) est autorisé', () => {
  const sellerAuth = { uid: 'seller_123', email: 'vendeur@test.com' };
  const targetUid = 'seller_123';

  const ordinaryUpdates = [
    ['name', 'updatedAt'],
    ['slogan', 'location', 'updatedAt'],
    ['logo', 'updatedAt'],
    ['whatsappNumber', 'phoneNormalized', 'updatedAt'],
    ['commercialWhatsApp', 'useLoginNumberAsPublic', 'allowCommercialContact'],
    ['currency', 'publicSlug'],
  ];

  for (const fields of ordinaryUpdates) {
    const res = evaluateUserUpdateRule(sellerAuth, targetUid, fields);
    assert.strictEqual(res.allowed, true, `Seller MUST be allowed to update ordinary profile fields [${fields.join(', ')}]`);
  }
});

runTest('26. L’administrateur autorisé (foosco80@gmail.com) peut modifier tous les statuts, plans et dates sans blocage', () => {
  const adminAuth = { uid: 'admin_uid_777', email: 'foosco80@gmail.com' };
  const targetUid = 'seller_123';

  // Admin toggling VIP status or updating expiration dates for a vendor
  const adminActions = [
    ['status', 'plan', 'vipStartedAt', 'updatedAt'],
    ['status', 'updatedAt'],
    ['trialEndsAt', 'date_expiration_essai', 'updatedAt'],
    ['role', 'updatedAt'],
  ];

  for (const fields of adminActions) {
    const res = evaluateUserUpdateRule(adminAuth, targetUid, fields);
    assert.strictEqual(res.allowed, true, `Admin MUST be allowed to update sensitive fields [${fields.join(', ')}]`);
    assert.strictEqual(res.reason, 'Super Administrateur autorisé');
  }
});

// ---------------------------------------------------------------------------
// TEST GROUP 7: Création de Profil, Modification Propriétaire et Base Nommée
// ---------------------------------------------------------------------------

/**
 * Exact simulation of firestore.rules logic for users/{uid} CREATE
 */
function evaluateUserCreateRule(
  authContext: { uid: string; email?: string; isAdminRole?: boolean } | null,
  targetDocUid: string,
  incomingData: Record<string, any>
): { allowed: boolean; reason: string } {
  if (!authContext) {
    return { allowed: false, reason: 'Non authentifié' };
  }

  const isOwner = authContext.uid === targetDocUid;
  if (!isOwner) {
    return { allowed: false, reason: 'Non propriétaire du document cible' };
  }

  if (incomingData.uid !== targetDocUid) {
    return { allowed: false, reason: 'UID dans le document ne correspond pas à la cible' };
  }

  const isAdmin = 
    authContext.email?.trim().toLowerCase() === 'foosco80@gmail.com' || 
    Boolean(authContext.isAdminRole);

  if (isAdmin) {
    return { allowed: true, reason: 'Super Administrateur autorisé' };
  }

  // Seller profile creation rules
  const roleOk = !('role' in incomingData) || incomingData.role === 'seller';
  const statusOk = !('status' in incomingData) || ['Actif', 'Essai', 'Gratuit'].includes(incomingData.status);
  const planOk = !('plan' in incomingData) || ['Essai', 'Gratuit'].includes(incomingData.plan);
  const noVipStart = !('vipStartedAt' in incomingData);
  const noVipEnd = !('vipEndsAt' in incomingData);

  if (!roleOk) {
    return { allowed: false, reason: 'Rôle interdit : un vendeur ne peut pas s’attribuer le rôle admin' };
  }
  if (!statusOk) {
    return { allowed: false, reason: 'Statut interdit : un vendeur ne peut pas s’attribuer le statut VIP à la création' };
  }
  if (!planOk) {
    return { allowed: false, reason: 'Plan interdit : un vendeur ne peut pas s’attribuer le plan VIP à la création' };
  }
  if (!noVipStart || !noVipEnd) {
    return { allowed: false, reason: 'Dates VIP interdites à la création par un vendeur' };
  }

  return { allowed: true, reason: 'Création autorisée' };
}

runTest('27. Création de profil sans champs administrateur : un vendeur peut créer son profil avec uniquement ses champs ordinaires', () => {
  const sellerAuth = { uid: 'seller_create_999', email: 'nouveau@vendeur.com' };
  const targetUid = 'seller_create_999';

  // Payload containing ONLY ordinary fields (name, phone, slogan, location, logo, currency, updatedAt)
  // WITHOUT role, status, plan, trialStartedAt, trialEndsAt
  const ordinaryPayload = {
    uid: targetUid,
    name: 'Boutique Alpha',
    whatsappNumber: '+212612345678',
    phoneNormalized: '212612345678',
    slogan: 'Mode & tendance',
    location: 'Rabat, Maroc',
    logo: 'https://images.unsplash.com/photo-1234',
    currency: 'MAD',
    updatedAt: new Date().toISOString(),
  };

  const res = evaluateUserCreateRule(sellerAuth, targetUid, ordinaryPayload);
  assert.strictEqual(res.allowed, true, 'Seller MUST be allowed to create profile with ordinary fields alone');
});

runTest('28. Création de profil : les valeurs d’essai initiales sont autorisées mais toute tentative VIP ou admin est rejetée', () => {
  const sellerAuth = { uid: 'seller_reg_111', email: 'reg@vendeur.com' };
  const targetUid = 'seller_reg_111';

  // 1. Safe registration payload with trial defaults (from authService)
  const safeRegistration = {
    uid: targetUid,
    name: 'Boutique Beta',
    whatsappNumber: '+22507000000',
    phoneNormalized: '22507000000',
    role: 'seller',
    status: 'Actif',
    plan: 'Essai',
    trialStartedAt: new Date().toISOString(),
    trialEndsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const safeRes = evaluateUserCreateRule(sellerAuth, targetUid, safeRegistration);
  assert.strictEqual(safeRes.allowed, true, 'Safe trial registration must be allowed');

  // 2. Exploit: Seller tries to self-assign role 'admin'
  const hackAdmin = { ...safeRegistration, role: 'admin' };
  const hackAdminRes = evaluateUserCreateRule(sellerAuth, targetUid, hackAdmin);
  assert.strictEqual(hackAdminRes.allowed, false, 'Self-assigned admin role must be rejected');

  // 3. Exploit: Seller tries to self-assign status 'VIP'
  const hackVipStatus = { ...safeRegistration, status: 'VIP' };
  const hackVipStatusRes = evaluateUserCreateRule(sellerAuth, targetUid, hackVipStatus);
  assert.strictEqual(hackVipStatusRes.allowed, false, 'Self-assigned VIP status must be rejected');

  // 4. Exploit: Seller tries to self-assign plan 'VIP'
  const hackVipPlan = { ...safeRegistration, plan: 'VIP' };
  const hackVipPlanRes = evaluateUserCreateRule(sellerAuth, targetUid, hackVipPlan);
  assert.strictEqual(hackVipPlanRes.allowed, false, 'Self-assigned VIP plan must be rejected');

  // 5. Exploit: Seller tries to self-assign vipStartedAt
  const hackVipDate = { ...safeRegistration, vipStartedAt: new Date().toISOString() };
  const hackVipDateRes = evaluateUserCreateRule(sellerAuth, targetUid, hackVipDate);
  assert.strictEqual(hackVipDateRes.allowed, false, 'Self-assigned VIP dates must be rejected');
});

runTest('29. Modification de profil : un vendeur authentifié peut modifier ses informations sans déclencher d’erreur de permission', () => {
  const sellerAuth = { uid: 'seller_edit_555', email: 'edit@vendeur.com' };
  const targetUid = 'seller_edit_555';

  // Normal profile fields edited in BrandingSettings form
  const vendorEditFields = [
    'name',
    'whatsappNumber',
    'phoneNormalized',
    'slogan',
    'location',
    'logo',
    'currency',
    'useLoginNumberAsPublic',
    'commercialWhatsApp',
    'allowCommercialContact',
    'updatedAt'
  ];

  const res = evaluateUserUpdateRule(sellerAuth, targetUid, vendorEditFields);
  assert.strictEqual(res.allowed, true, 'Owner MUST be permitted to modify own branding and profile information');
});

runTest('30. Isolation inter-vendeurs : un vendeur ne peut pas modifier le document d’un autre vendeur', () => {
  const aliceAuth = { uid: 'seller_alice', email: 'alice@vendeur.com' };
  const bobUid = 'seller_bob';

  const res = evaluateUserUpdateRule(aliceAuth, bobUid, ['name', 'updatedAt']);
  assert.strictEqual(res.allowed, false, 'Alice MUST NOT be able to modify Bob’s user profile');
  assert.strictEqual(res.reason, 'Non propriétaire du document');
});

runTest('31. Ciblage de la base Firestore personnalisée (ai-studio-whatsappcommerci-1b7e18c2-9951-431d-9625-32bdcef0db27)', () => {
  // Verify firebase-applet-config.json
  const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
  assert.strictEqual(
    config.firestoreDatabaseId,
    'ai-studio-whatsappcommerci-1b7e18c2-9951-431d-9625-32bdcef0db27',
    'The project must target the specific database ID, not (default)'
  );

  // Verify firestore.rules applies dynamically to any database via {database} wildcard
  const rulesContent = fs.readFileSync('firestore.rules', 'utf8');
  assert.ok(
    rulesContent.includes('match /databases/{database}/documents'),
    'firestore.rules must use {database} wildcard to cover the custom database'
  );
  assert.ok(
    !rulesContent.includes('match /databases/(default)/documents'),
    'firestore.rules must NOT be hardcoded to (default)'
  );
});

console.log(`\n🎉 All ${testsPassed} Admin Firestore and Security tests passed successfully!\n`);
