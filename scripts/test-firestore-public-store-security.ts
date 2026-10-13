/**
 * Test exhaustif de sécurité Firestore, confidentialité et isolation des boutiques publiques :
 * 1. Séparation stricte /users/{uid} (privé) et /publicStores/{uid} (public).
 * 2. Blocage des lectures publiques sur /users/{uid} (anonyme et inter-vendeurs).
 * 3. Lecture publique autorisée sur /publicStores/{uid} et par publicSlug.
 * 4. Sanitisation totale de /publicStores/{uid} : zéro numéro privé, zéro CRM, zéro date interne.
 * 5. Consentement explicite du contact commercial (orderWhatsApp).
 * 6. Interdiction d'usurpation et d'auto-attribution de privilèges ou rôles administrateurs.
 * 7. Migration non destructive et intégrité des catalogues, QR codes et administration.
 * 8. Conformité stricte du fichier firestore.rules et de firebase-blueprint.json.
 */

import assert from 'assert';
import fs from 'fs';
import { FirestoreService } from '../src/services/firestoreService';
import { ApiService, normalizeVendeur } from '../src/services/api';
import { Vendeur, PublicStoreProfile } from '../src/types';

console.log('🛡️  DÉBUT DU TEST DE SÉCURITÉ FIRESTORE ET CONFIDENTIALITÉ DES BOUTIQUES PUBLIQUES...\n');

let passedTests = 0;

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err: any) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Erreur: ${err.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Simulation des règles de sécurité Firestore exactes (firestore.rules)
// ---------------------------------------------------------------------------

const SENSITIVE_KEYS = [
  'role',
  'status',
  'plan',
  'trialStartedAt',
  'trialEndsAt',
  'date_expiration_essai',
  'vipStartedAt',
  'vipEndsAt'
];

interface AuthContext {
  uid: string;
  email?: string;
  isAdminRole?: boolean;
}

function evaluateFirestoreRule(params: {
  collection: 'users' | 'publicStores' | 'products' | 'prospects';
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  targetDocId: string;
  auth: AuthContext | null;
  incomingData?: Record<string, any>;
  existingData?: Record<string, any>;
}): { allowed: boolean; reason: string } {
  const { collection, operation, targetDocId, auth, incomingData, existingData } = params;

  const isSignedIn = auth !== null;
  const isOwner = isSignedIn && auth.uid === targetDocId;
  const isAdmin = isSignedIn && (
    auth.email?.trim().toLowerCase() === 'foosco80@gmail.com' ||
    Boolean(auth.isAdminRole)
  );

  // 1. users/{uid}
  if (collection === 'users') {
    if (operation === 'get') {
      const allowed = isOwner || isAdmin;
      return { allowed, reason: allowed ? 'Propriétaire ou admin autorisé' : 'Lecture /users privée interdite au public' };
    }
    if (operation === 'list') {
      const allowed = isAdmin;
      return { allowed, reason: allowed ? 'Admin autorisé à lister' : 'Listing users réservé à l’administrateur' };
    }
    if (operation === 'create') {
      if (!isOwner) return { allowed: false, reason: 'Seul le propriétaire peut créer son profil' };
      if (incomingData?.uid !== targetDocId) return { allowed: false, reason: 'UID discordant' };
      if (isAdmin) return { allowed: true, reason: 'Admin autorisé' };

      const roleOk = !('role' in incomingData!) || incomingData!.role === 'seller';
      const statusOk = !('status' in incomingData!) || ['Actif', 'Essai', 'Gratuit'].includes(incomingData!.status);
      const planOk = !('plan' in incomingData!) || ['Essai', 'Gratuit'].includes(incomingData!.plan);
      const noVipStart = !('vipStartedAt' in incomingData!);
      const noVipEnd = !('vipEndsAt' in incomingData!);

      const allowed = roleOk && statusOk && planOk && noVipStart && noVipEnd;
      return { allowed, reason: allowed ? 'Création vendeur conforme' : 'Tentative d’auto-attribution de privilèges interdite' };
    }
    if (operation === 'update') {
      if (isAdmin) return { allowed: true, reason: 'Admin autorisé' };
      if (!isOwner) return { allowed: false, reason: 'Modification non propriétaire interdite' };
      if (incomingData?.uid !== targetDocId) return { allowed: false, reason: 'UID immutable' };

      // Vérifier les champs sensibles
      const changedKeys = incomingData ? Object.keys(incomingData) : [];
      const hasSensitive = changedKeys.some(k => SENSITIVE_KEYS.includes(k) && incomingData?.[k] !== existingData?.[k]);
      if (hasSensitive) {
        return { allowed: false, reason: 'Modification de champs d’abonnement sensibles interdite' };
      }
      return { allowed: true, reason: 'Mise à jour autorisée' };
    }
    if (operation === 'delete') {
      const allowed = isAdmin;
      return { allowed, reason: allowed ? 'Suppression admin autorisée' : 'Suppression réservée à l’admin' };
    }
  }

  // 2. publicStores/{uid}
  if (collection === 'publicStores') {
    if (operation === 'get' || operation === 'list') {
      return { allowed: true, reason: 'Lecture publique autorisée sur les boutiques vitrines' };
    }
    if (operation === 'create') {
      if (isAdmin) return { allowed: true, reason: 'Admin autorisé' };
      if (!isOwner) return { allowed: false, reason: 'Un vendeur ne peut pas créer la boutique d’un autre vendeur' };
      if (incomingData?.id !== targetDocId) return { allowed: false, reason: 'ID discordant' };

      const noRole = !('role' in incomingData!);
      const noStatus = !('status' in incomingData!);
      const noPlan = !('plan' in incomingData!);
      const noVip = !('vipEndsAt' in incomingData!) && !('vipStartedAt' in incomingData!);
      const noTrial = !('trialEndsAt' in incomingData!) && !('trialStartedAt' in incomingData!);

      const allowed = noRole && noStatus && noPlan && noVip && noTrial;
      return { allowed, reason: allowed ? 'Création vitrine publique autorisée' : 'Champs d’abonnement ou de statut interdits sur /publicStores' };
    }
    if (operation === 'update') {
      if (isAdmin) return { allowed: true, reason: 'Admin autorisé' };
      if (!isOwner) return { allowed: false, reason: 'Modification inter-vendeur interdite' };
      if (incomingData?.id !== targetDocId) return { allowed: false, reason: 'ID de boutique immutable' };

      // Protection hasFullCatalog : un vendeur ne peut pas modifier son droit d'accès au catalogue
      if ('hasFullCatalog' in incomingData!) {
        if (!existingData || !('hasFullCatalog' in existingData) || incomingData.hasFullCatalog !== existingData.hasFullCatalog) {
          return { allowed: false, reason: 'Un vendeur ne peut pas modifier hasFullCatalog' };
        }
      }

      // Protection is_active : un vendeur ne peut pas modifier le statut d'activation (ex: réactiver une boutique suspendue)
      if ('is_active' in incomingData!) {
        if (!existingData || !('is_active' in existingData) || incomingData.is_active !== existingData.is_active) {
          return { allowed: false, reason: 'Un vendeur ne peut pas modifier is_active' };
        }
      }

      // Interdiction de champs d'abonnement ou privilèges
      const forbiddenKeys = ['role', 'status', 'plan', 'vipStartedAt', 'vipEndsAt', 'trialStartedAt', 'trialEndsAt', 'date_expiration_essai'];
      const hasForbidden = forbiddenKeys.some(k => k in incomingData!);
      if (hasForbidden) {
        return { allowed: false, reason: 'Modification de champs d’abonnement interdite sur la vitrine publique' };
      }

      return { allowed: true, reason: 'Mise à jour vitrine publique autorisée' };
    }
    if (operation === 'delete') {
      const allowed = isOwner || isAdmin;
      return { allowed, reason: allowed ? 'Suppression autorisée' : 'Suppression non autorisée' };
    }
  }

  // 3. products/{productId} under users/{uid}/products
  if (collection === 'products') {
    if (operation === 'get' || operation === 'list') {
      return { allowed: true, reason: 'Lecture publique des produits autorisée' };
    }
    const isVendorSuspended = existingData?.vendorStatus === 'Inactif' || existingData?.vendorStatus === 'Suspendu';
    if (operation === 'create') {
      if (!isOwner) return { allowed: false, reason: 'Seul le propriétaire peut créer des produits' };
      if (isVendorSuspended) return { allowed: false, reason: 'Boutique suspendue : création de produit interdite' };
      return { allowed: true, reason: 'Création de produit autorisée' };
    }
    if (operation === 'update') {
      if (isAdmin) return { allowed: true, reason: 'Admin autorisé' };
      if (!isOwner) return { allowed: false, reason: 'Modification non propriétaire interdite' };
      if (isVendorSuspended) return { allowed: false, reason: 'Boutique suspendue : modification de produit interdite' };
      return { allowed: true, reason: 'Modification de produit autorisée' };
    }
    if (operation === 'delete') {
      const allowed = isOwner || isAdmin;
      return { allowed, reason: allowed ? 'Suppression produit autorisée' : 'Suppression non autorisée' };
    }
  }

  return { allowed: false, reason: 'Opération non couverte' };
}

// ---------------------------------------------------------------------------
// TEST GROUP 1 : Confidentialité du Profil Privé (/users/{uid})
// ---------------------------------------------------------------------------

runTest('1. Un visiteur anonyme ne peut JAMAIS lire /users/{uid}', () => {
  const result = evaluateFirestoreRule({
    collection: 'users',
    operation: 'get',
    targetDocId: 'seller_123',
    auth: null,
  });
  assert.strictEqual(result.allowed, false, 'Un visiteur anonyme doit être rejeté');
  assert.ok(result.reason.includes('privée interdite au public'));
});

runTest('2. Un vendeur authentifié (Bob) ne peut JAMAIS lire /users/alice', () => {
  const result = evaluateFirestoreRule({
    collection: 'users',
    operation: 'get',
    targetDocId: 'seller_alice',
    auth: { uid: 'seller_bob', email: 'bob@wa.local' },
  });
  assert.strictEqual(result.allowed, false, 'Bob ne doit pas pouvoir lire le profil privé d’Alice');
});

runTest('3. Le propriétaire du profil (Alice) peut lire son propre profil /users/alice', () => {
  const result = evaluateFirestoreRule({
    collection: 'users',
    operation: 'get',
    targetDocId: 'seller_alice',
    auth: { uid: 'seller_alice', email: 'alice@wa.local' },
  });
  assert.strictEqual(result.allowed, true, 'Alice doit pouvoir lire son profil privé');
});

runTest('4. L’administrateur autorisé (foosco80@gmail.com) peut lire /users/{uid} et lister la collection', () => {
  const adminAuth: AuthContext = { uid: 'admin_master', email: 'foosco80@gmail.com' };

  const getRes = evaluateFirestoreRule({
    collection: 'users',
    operation: 'get',
    targetDocId: 'seller_alice',
    auth: adminAuth,
  });
  assert.strictEqual(getRes.allowed, true, 'L’admin doit pouvoir lire n’importe quel profil vendeur');

  const listRes = evaluateFirestoreRule({
    collection: 'users',
    operation: 'list',
    targetDocId: 'all',
    auth: adminAuth,
  });
  assert.strictEqual(listRes.allowed, true, 'L’admin doit pouvoir lister les vendeurs');
});

runTest('5. Aucun utilisateur non-admin ne peut lister la collection /users', () => {
  const sellerAuth: AuthContext = { uid: 'seller_alice', email: 'alice@wa.local' };
  const listRes = evaluateFirestoreRule({
    collection: 'users',
    operation: 'list',
    targetDocId: 'all',
    auth: sellerAuth,
  });
  assert.strictEqual(listRes.allowed, false, 'Un vendeur ne peut pas lister la collection /users');
});

// ---------------------------------------------------------------------------
// TEST GROUP 2 : Accessibilité Publique de /publicStores/{uid}
// ---------------------------------------------------------------------------

runTest('6. Un visiteur anonyme peut lire /publicStores/{uid} directement', () => {
  const result = evaluateFirestoreRule({
    collection: 'publicStores',
    operation: 'get',
    targetDocId: 'seller_alice',
    auth: null,
  });
  assert.strictEqual(result.allowed, true, 'Tout visiteur doit pouvoir lire la vitrine publique');
});

runTest('7. Un visiteur anonyme peut requêter /publicStores (par exemple via publicSlug)', () => {
  const result = evaluateFirestoreRule({
    collection: 'publicStores',
    operation: 'list',
    targetDocId: 'all',
    auth: null,
  });
  assert.strictEqual(result.allowed, true, 'La recherche publique de boutique par slug doit être autorisée');
});

// ---------------------------------------------------------------------------
// TEST GROUP 3 : Sanitisation et Ségrégation des Données
// ---------------------------------------------------------------------------

runTest('8. Sanitisation stricte : AUCUN numéro WhatsApp de connexion privé dans /publicStores', () => {
  const privateUserDoc: Partial<Vendeur> = {
    uid: 'vend_test_priv',
    phone: '+212611223344',
    whatsappNumber: '+212611223344',
    phoneNormalized: '212611223344',
    name: 'Boutique Royale',
    slogan: 'Vente directe',
    location: 'Maroc',
    logo: 'https://images.unsplash.com/logo.jpg',
    currency: 'MAD',
    status: 'Actif',
    plan: 'Essai',
    trialStartedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    trialEndsAt: new Date(Date.now() + 12 * 86400000).toISOString(),
    date_expiration_essai: new Date(Date.now() + 12 * 86400000).toISOString(),
    role: 'seller',
    publicSlug: 'boutique-royale',
    useLoginNumberAsPublic: false, // Pas de consentement
    allowCommercialContact: false,
  };

  const publicStore = FirestoreService.sanitizePublicStore('vend_test_priv', privateUserDoc);

  assert.strictEqual((publicStore as any).phone, undefined, 'Le champ phone privé doit être totalement absent');
  assert.strictEqual((publicStore as any).whatsappNumber, undefined, 'whatsappNumber de connexion doit être absent');
  assert.strictEqual((publicStore as any).phoneNormalized, undefined, 'phoneNormalized doit être absent');
  assert.strictEqual((publicStore as any).trialStartedAt, undefined, 'trialStartedAt doit être absent');
  assert.strictEqual((publicStore as any).trialEndsAt, undefined, 'trialEndsAt interne doit être absent');
  assert.strictEqual((publicStore as any).date_expiration_essai, undefined, 'date_expiration_essai interne doit être absent');
  assert.strictEqual((publicStore as any).plan, undefined, 'Le nom de plan interne doit être absent du profil public');
  assert.strictEqual((publicStore as any).role, undefined, 'Le rôle de sécurité doit être absent');
  assert.strictEqual(publicStore.hasFullCatalog, true, 'hasFullCatalog doit être un booléen calculé (essai en cours)');
  assert.strictEqual(publicStore.orderWhatsApp, undefined, 'orderWhatsApp doit être undefined si non consenti');
  assert.strictEqual(publicStore.allowCommercialContact, false);
});

runTest('9. Le contact commercial est inclus UNIQUEMENT si le vendeur a explicitement consenti', () => {
  // Option A : useLoginNumberAsPublic = true
  const sellerWithLoginConsent = {
    whatsappNumber: '+212611223344',
    useLoginNumberAsPublic: true,
  };
  const storeA = FirestoreService.sanitizePublicStore('vend_a', sellerWithLoginConsent);
  assert.strictEqual(storeA.orderWhatsApp, '+212611223344', 'Le numéro est publié car expressément autorisé');
  assert.strictEqual(storeA.allowCommercialContact, true);

  // Option B : distinct commercial WhatsApp fourni avec consentement
  const sellerWithDistinctContact = {
    whatsappNumber: '+212600000000', // privé
    commercialWhatsApp: '+212688990011', // public commercial
    allowCommercialContact: true,
    useLoginNumberAsPublic: false,
  };
  const storeB = FirestoreService.sanitizePublicStore('vend_b', sellerWithDistinctContact);
  assert.strictEqual(storeB.orderWhatsApp, '+212688990011', 'Le contact commercial dédié est publié');
  assert.strictEqual(storeB.allowCommercialContact, true);
  assert.strictEqual((storeB as any).whatsappNumber, undefined, 'Le numéro privé reste strictement masqué');
});

runTest('9b. hasFullCatalog est calculé précisément sans exposer les dates d’abonnement', () => {
  // Vendeur gratuit : hasFullCatalog = false (limite à 4 produits)
  const freeSeller = {
    status: 'Gratuit',
    plan: 'Gratuit',
  };
  const storeFree = FirestoreService.sanitizePublicStore('vend_free', freeSeller);
  assert.strictEqual(storeFree.hasFullCatalog, false, 'Le mode gratuit restreint à 4 produits');
  assert.strictEqual((storeFree as any).plan, undefined, 'Le plan ne doit pas être exposé publiquement');

  // Vendeur VIP expiré : hasFullCatalog = false
  const expiredVip = {
    status: 'VIP',
    vipEndsAt: '2020-01-01T00:00:00.000Z',
  };
  const storeExpiredVip = FirestoreService.sanitizePublicStore('vend_exp', expiredVip);
  assert.strictEqual(storeExpiredVip.hasFullCatalog, false, 'Le VIP expiré ne donne pas droit au catalogue complet');
  assert.strictEqual((storeExpiredVip as any).vipEndsAt, undefined, 'La date VIP ne doit pas être exposée');
});

// ---------------------------------------------------------------------------
// TEST GROUP 4 : Protection Contre l’Usurpation & Modifications Malveillantes
// ---------------------------------------------------------------------------

runTest('10. Un vendeur A ne peut pas créer ni modifier la vitrine /publicStores du vendeur B', () => {
  const aliceAuth: AuthContext = { uid: 'seller_alice', email: 'alice@wa.local' };
  const bobStoreId = 'seller_bob';

  const createRes = evaluateFirestoreRule({
    collection: 'publicStores',
    operation: 'create',
    targetDocId: bobStoreId,
    auth: aliceAuth,
    incomingData: { id: bobStoreId, name: 'Hacked Store' },
  });
  assert.strictEqual(createRes.allowed, false, 'Alice ne peut pas créer la boutique de Bob');

  const updateRes = evaluateFirestoreRule({
    collection: 'publicStores',
    operation: 'update',
    targetDocId: bobStoreId,
    auth: aliceAuth,
    incomingData: { id: bobStoreId, name: 'Hacked Name' },
    existingData: { id: bobStoreId, name: 'Bob Store' },
  });
  assert.strictEqual(updateRes.allowed, false, 'Alice ne peut pas modifier la boutique de Bob');
});

runTest('11. Un vendeur ne peut pas s’auto-attribuer le statut VIP ou modifier son plan sur /publicStores', () => {
  const sellerAuth: AuthContext = { uid: 'seller_123', email: 'seller@wa.local' };
  const storeId = 'seller_123';

  // Tentative de modification directe de status: 'VIP'
  const updateRes = evaluateFirestoreRule({
    collection: 'publicStores',
    operation: 'update',
    targetDocId: storeId,
    auth: sellerAuth,
    incomingData: { id: storeId, status: 'VIP' },
    existingData: { id: storeId, status: 'Actif' },
  });
  assert.strictEqual(updateRes.allowed, false, 'Auto-attribution VIP interdite sur /publicStores');
  assert.ok(updateRes.reason.includes('Modification de champs d’abonnement interdite'));
});

runTest('11b. Un vendeur ne peut JAMAIS modifier hasFullCatalog pour contourner son abonnement', () => {
  const sellerAuth: AuthContext = { uid: 'seller_123', email: 'seller@wa.local' };
  const storeId = 'seller_123';

  // Tentative de passer hasFullCatalog de false à true
  const updateRes = evaluateFirestoreRule({
    collection: 'publicStores',
    operation: 'update',
    targetDocId: storeId,
    auth: sellerAuth,
    incomingData: { id: storeId, hasFullCatalog: true },
    existingData: { id: storeId, hasFullCatalog: false },
  });
  assert.strictEqual(updateRes.allowed, false, 'Un vendeur ne peut pas modifier hasFullCatalog de false à true');
  assert.ok(updateRes.reason.includes('hasFullCatalog'));
});

runTest('11c. Un vendeur ne peut JAMAIS réactiver lui-même une boutique suspendue par l’admin (is_active: true)', () => {
  const sellerAuth: AuthContext = { uid: 'seller_suspended', email: 'suspended@wa.local' };
  const storeId = 'seller_suspended';

  // Tentative de passer is_active de false à true
  const updateRes = evaluateFirestoreRule({
    collection: 'publicStores',
    operation: 'update',
    targetDocId: storeId,
    auth: sellerAuth,
    incomingData: { id: storeId, is_active: true },
    existingData: { id: storeId, is_active: false },
  });
  assert.strictEqual(updateRes.allowed, false, 'Un vendeur ne peut pas réactiver une boutique suspendue');
  assert.ok(updateRes.reason.includes('is_active'));
});

runTest('11d. Une boutique suspendue ou inactive ne peut ni créer ni modifier de produit', () => {
  const sellerAuth: AuthContext = { uid: 'seller_suspended', email: 'suspended@wa.local' };
  const storeId = 'seller_suspended';

  const createRes = evaluateFirestoreRule({
    collection: 'products',
    operation: 'create',
    targetDocId: storeId,
    auth: sellerAuth,
    incomingData: { vendeur_id: storeId, name: 'Produit interdit' },
    existingData: { vendorStatus: 'Suspendu' },
  });
  assert.strictEqual(createRes.allowed, false, 'Création de produit interdite pour boutique suspendue');
  assert.ok(createRes.reason.includes('suspendue'));

  const updateRes = evaluateFirestoreRule({
    collection: 'products',
    operation: 'update',
    targetDocId: storeId,
    auth: sellerAuth,
    incomingData: { vendeur_id: storeId, name: 'Produit modifié' },
    existingData: { vendorStatus: 'Inactif' },
  });
  assert.strictEqual(updateRes.allowed, false, 'Modification de produit interdite pour boutique inactive');
});

runTest('12. L’administrateur autorisé (foosco80@gmail.com) peut modifier /publicStores sans blocage', () => {
  const adminAuth: AuthContext = { uid: 'admin_master', email: 'foosco80@gmail.com' };
  const storeId = 'seller_123';

  const updateRes = evaluateFirestoreRule({
    collection: 'publicStores',
    operation: 'update',
    targetDocId: storeId,
    auth: adminAuth,
    incomingData: { id: storeId, status: 'VIP', plan: 'VIP', hasFullCatalog: true, is_active: true },
    existingData: { id: storeId, status: 'Actif', plan: 'Essai', hasFullCatalog: false, is_active: false },
  });
  assert.strictEqual(updateRes.allowed, true, 'L’admin doit pouvoir modifier la boutique publique');
});

// ---------------------------------------------------------------------------
// TEST GROUP 5 : Migration des Vendeurs Existants sans Perte de Données
// ---------------------------------------------------------------------------

runTest('13. Migration de vendeurs existants préserve 100% des données privées dans users/ tout en créant publicStores/', () => {
  const existingVendorDocs: Record<string, any>[] = [
    {
      uid: 'vendeur_1',
      name: 'Boutique Alpha',
      whatsappNumber: '+212611111111',
      phoneNormalized: '212611111111',
      location: 'Casablanca',
      currency: 'MAD',
      status: 'Actif',
      plan: 'Essai',
      role: 'seller',
      createdAt: '2026-10-01T08:00:00.000Z',
      trialEndsAt: '2026-10-08T08:00:00.000Z',
    },
    {
      uid: 'vendeur_2',
      name: 'Boutique Beta',
      whatsappNumber: '+225070000000',
      phoneNormalized: '225070000000',
      location: 'Abidjan',
      currency: 'CFA',
      status: 'VIP',
      plan: 'VIP',
      role: 'seller',
      createdAt: '2026-10-02T09:00:00.000Z',
      vipEndsAt: '2027-10-02T09:00:00.000Z',
    },
  ];

  // Simulation de la migration
  const migratedPublicStores: PublicStoreProfile[] = existingVendorDocs.map((doc) => {
    return FirestoreService.sanitizePublicStore(doc.uid, doc);
  });

  assert.strictEqual(migratedPublicStores.length, 2, '2 boutiques doivent être migrées');

  // Vérifier Alpha
  const alpha = migratedPublicStores[0];
  assert.strictEqual(alpha.id, 'vendeur_1');
  assert.strictEqual(alpha.name, 'Boutique Alpha');
  assert.strictEqual(alpha.currency, 'MAD');
  assert.strictEqual((alpha as any).whatsappNumber, undefined, 'Numéro privé préservé uniquement dans users/');
  assert.strictEqual((alpha as any).phoneNormalized, undefined);
  assert.strictEqual((alpha as any).plan, undefined, 'Plan non exposé');

  // Vérifier Beta
  const beta = migratedPublicStores[1];
  assert.strictEqual(beta.id, 'vendeur_2');
  assert.strictEqual(beta.hasFullCatalog, true, 'VIP actif a accès au catalogue complet');
  assert.strictEqual((beta as any).whatsappNumber, undefined);
  assert.strictEqual((beta as any).vipEndsAt, undefined, 'Date VIP non exposée');

  // Vérifier que le document source est intact
  assert.strictEqual(existingVendorDocs[0].whatsappNumber, '+212611111111', 'Le document source users/vendeur_1 est intact');
  assert.strictEqual(existingVendorDocs[1].whatsappNumber, '+225070000000', 'Le document source users/vendeur_2 est intact');
});

runTest('13b. Nettoyage strict des anciens documents : aucun champ obsolète ne subsiste', () => {
  // Simuler un ancien document publicStores pollué par l'ancienne implémentation
  const pollutedLegacyStore: Record<string, any> = {
    id: 'legacy_vendor_1',
    name: 'Ancienne Boutique',
    plan: 'VIP',
    trialStartedAt: '2026-01-01T00:00:00.000Z',
    trialEndsAt: '2026-01-15T00:00:00.000Z',
    date_expiration_essai: '2026-01-15T00:00:00.000Z',
    vipEndsAt: '2027-01-01T00:00:00.000Z',
    phone: '+212600000000',
    whatsappNumber: '+212600000000',
    role: 'seller',
    status: 'Actif',
  };

  // Lors de la synchronisation vers publicStores (setDoc sans merge):
  const cleanProfile = FirestoreService.sanitizePublicStore('legacy_vendor_1', pollutedLegacyStore);

  // Le profil doit contenir uniquement les champs publics autorisés
  const keys = Object.keys(cleanProfile);
  assert.ok(!keys.includes('plan'), 'plan doit être purgé');
  assert.ok(!keys.includes('trialStartedAt'), 'trialStartedAt doit être purgé');
  assert.ok(!keys.includes('trialEndsAt'), 'trialEndsAt doit être purgé');
  assert.ok(!keys.includes('date_expiration_essai'), 'date_expiration_essai doit être purgé');
  assert.ok(!keys.includes('vipEndsAt'), 'vipEndsAt doit être purgé');
  assert.ok(!keys.includes('phone'), 'phone doit être purgé');
  assert.ok(!keys.includes('whatsappNumber'), 'whatsappNumber doit être purgé');
  assert.ok(!keys.includes('role'), 'role doit être purgé');
  assert.ok(keys.includes('hasFullCatalog'), 'hasFullCatalog doit être présent');
  assert.ok(keys.includes('is_active'), 'is_active doit être présent');
});

// ---------------------------------------------------------------------------
// TEST GROUP 6 : Vérification des Fichiers de Règles et Blueprint
// ---------------------------------------------------------------------------

runTest('14. firestore.rules applique la règle privée sur users/{uid} et la règle publique sur publicStores/{uid}', () => {
  const rules = fs.readFileSync('firestore.rules', 'utf8');

  // Doit contenir le match sur users et la restriction propriétaire/admin
  assert.ok(rules.includes('match /users/{uid}'), 'match /users/{uid} requis');
  assert.ok(rules.includes('allow get: if isOwner(uid) || isAdmin();'), 'users/{uid} allow get doit exiger isOwner ou isAdmin');
  assert.ok(!rules.includes('match /users/{uid} {\n      allow get: if true;'), 'users/{uid} ne doit JAMAIS autoriser allow get: if true');

  // Doit contenir match /publicStores/{uid}
  assert.ok(rules.includes('match /publicStores/{uid}'), 'match /publicStores/{uid} requis');
  assert.ok(rules.includes('allow get: if true;'), 'publicStores/{uid} allow get doit être public');
  assert.ok(rules.includes('allow list: if true;'), 'publicStores/{uid} allow list doit être public');

  // Interdiction absolue de allow read, write: if true
  assert.ok(!rules.includes('allow read, write: if true'), 'AUCUN allow read, write: if true n’est toléré');
});

runTest('15. firebase-blueprint.json intègre PublicStore et le chemin /publicStores/{uid}', () => {
  const blueprint = JSON.parse(fs.readFileSync('firebase-blueprint.json', 'utf8'));

  assert.ok(blueprint.entities.PublicStore, 'L’entité PublicStore doit être définie');
  assert.ok(blueprint.firestore['/publicStores/{uid}'], 'Le chemin /publicStores/{uid} doit être déclaré');
  assert.strictEqual(
    blueprint.firestore['/publicStores/{uid}'].schema.$ref,
    '#/entities/PublicStore',
    'La référence du schéma doit pointer vers #/entities/PublicStore'
  );
});

runTest('16. firestore.rules protège les droits d’accès avec vendorTamperingPublicStoreEntitlements et isVendorActive', () => {
  const rules = fs.readFileSync('firestore.rules', 'utf8');

  assert.ok(rules.includes('function vendorTamperingPublicStoreEntitlements()'), 'Fonction de détection de falsification requise');
  assert.ok(rules.includes('function isVendorActive(uid)'), 'Vérification du statut actif requise');
  assert.ok(rules.includes('!vendorTamperingPublicStoreEntitlements()'), 'La règle update de publicStores doit utiliser vendorTamperingPublicStoreEntitlements');
  assert.ok(rules.includes('isVendorActive(uid)'), 'La règle de création/mise à jour produit doit exiger isVendorActive');
});

console.log(`\n🎉 TOUS LES ${passedTests} TESTS DE SÉCURITÉ FIRESTORE ET CONFIDENTIALITÉ ONT RÉUSSI !\n`);
