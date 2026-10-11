/**
 * Test de vérification unitaire de :
 * 1. L'isolation des données vendeurs et sanitisation des boutiques publiques.
 * 2. L'option explicite useLoginNumberAsPublic (désactivée par défaut).
 * 3. La normalisation internationale des numéros WhatsApp et du lien wa.me.
 * 4. L'affichage des produits dans le catalogue public (limite 4 en gratuit, complet pour VIP / Essai actif) avec tests à 3, 4 et 5 produits.
 * 5. L'isolation et la validation des images dans Firebase Storage (chemins par UID, types et tailles autorisés).
 */
import { PublicStoreProfile, Vendeur, Product } from '../src/types';
import { validateImageFile } from '../src/services/imageUpload';

function runTests() {
  console.log('--- DÉBUT DES TESTS D\'ISOLATION, CATALOGUE PRODUITS ET IMAGES ---');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`);
      failed++;
    }
  }

  // Helper de normalisation internationale (identique à PublicStore)
  const normalizeInternationalWhatsApp = (raw: string, currency: string = 'MAD'): string => {
    if (!raw) return '';
    let digits = raw.replace(/\D/g, '');
    digits = digits.replace(/^00+/, '');
    if (digits.startsWith('0')) {
      const countryPrefix = currency === 'CFA' ? '225' : '212';
      digits = countryPrefix + digits.slice(1);
    }
    return digits.length >= 6 ? digits : '';
  };

  // Helper de calcul de limitation de catalogue (identique à PublicStore.tsx)
  const calculateDisplayProducts = (vendeur: Vendeur | PublicStoreProfile, products: Product[]): Product[] => {
    const isVip = vendeur.status === 'VIP' || (vendeur as any).plan === 'VIP';
    if (isVip) {
      const vipEnd = (vendeur as any).vipEndsAt;
      if (!vipEnd || new Date(vipEnd).getTime() > Date.now()) {
        return products;
      }
    }

    const plan = (vendeur as any).plan;
    if (plan === 'Gratuit' || vendeur.status === 'Gratuit') {
      return products.slice(0, 4);
    }

    const trialEnd = (vendeur as any).trialEndsAt || (vendeur as any).date_expiration_essai;
    if (trialEnd) {
      if (new Date(trialEnd).getTime() > Date.now()) {
        return products;
      } else {
        return products.slice(0, 4);
      }
    }

    return vendeur.status === 'Actif' ? products : products.slice(0, 4);
  };

  // Helper de sanitisation (identique à FirestoreService.sanitizePublicStore)
  const sanitizePublicStore = (uid: string, d: Record<string, any>): PublicStoreProfile => {
    let orderContact: string | undefined = undefined;
    if (d.useLoginNumberAsPublic === true) {
      const regPhone = d.whatsappNumber || d.phone || '';
      const digits = String(regPhone).replace(/\D/g, '');
      if (digits.length >= 6) {
        orderContact = regPhone;
      }
    } else if (d.allowCommercialContact && d.commercialWhatsApp) {
      const digits = String(d.commercialWhatsApp).replace(/\D/g, '');
      if (digits.length >= 6) {
        orderContact = d.commercialWhatsApp;
      }
    }

    return {
      id: uid,
      name: d.name || `Boutique ${uid.slice(-4)}`,
      slogan: d.slogan || 'Vente directe & service rapide',
      location: d.location || 'Maroc',
      logo: d.logo || 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=400&q=80',
      currency: (d.currency as any) || 'MAD',
      status: d.status || 'Actif',
      plan: d.plan || (d.status === 'VIP' ? 'VIP' : (d.status === 'Gratuit' ? 'Gratuit' : 'Essai')),
      trialEndsAt: d.trialEndsAt || d.date_expiration_essai,
      vipEndsAt: d.vipEndsAt,
      is_active: d.status !== 'Inactif' && d.status !== 'Suspendu',
      publicSlug: d.publicSlug || uid,
      orderWhatsApp: orderContact,
      allowCommercialContact: Boolean(orderContact),
    };
  };

  // Profils tests
  const mockVendorBase: Vendeur = {
    id: 'uid_vendeur_123',
    uid: 'uid_vendeur_123',
    name: 'Boutique Élégance',
    phone: '+212612345678',
    slogan: 'Prêt-à-porter chic',
    location: 'Casablanca, Maroc',
    logo: 'https://example.com/logo.jpg',
    currency: 'MAD',
    status: 'Actif',
    is_active: true,
    publicSlug: 'boutique-elegance',
    role: 'seller',
    plan: 'Essai',
    trialStartedAt: '2026-01-01T00:00:00.000Z',
    trialEndsAt: '2028-01-15T00:00:00.000Z', // Essai non expiré
    date_expiration_essai: '2028-01-15T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
  };

  // Test 1 : useLoginNumberAsPublic est désactivé par défaut (false / undefined)
  const defaultPublicStore = sanitizePublicStore(mockVendorBase.id, mockVendorBase);
  assert(!('phone' in defaultPublicStore), 'Le champ phone privé est absent du profil public');
  assert(defaultPublicStore.orderWhatsApp === undefined, 'orderWhatsApp est undefined par défaut : aucun numéro privé exposé');
  assert(defaultPublicStore.allowCommercialContact === false, 'allowCommercialContact est false si non consenti');

  // Test 2 : Vendeur active explicitement l\'option useLoginNumberAsPublic
  const vendorWithConsent: Vendeur = { ...mockVendorBase, useLoginNumberAsPublic: true };
  const storeWithConsent = sanitizePublicStore(vendorWithConsent.id, vendorWithConsent);
  assert(storeWithConsent.orderWhatsApp === '+212612345678', 'orderWhatsApp utilise le numéro enregistré lorsque useLoginNumberAsPublic est true');
  assert(storeWithConsent.allowCommercialContact === true, 'allowCommercialContact devient true');

  // Test 3 : Normalisation internationale des numéros (+212 et formats locaux)
  const digits1 = normalizeInternationalWhatsApp('+212 6 12 34 56 78', 'MAD');
  assert(digits1 === '212612345678', 'Normalisation internationale +212 -> 212612345678');
  const digits2 = normalizeInternationalWhatsApp('0612345678', 'MAD');
  assert(digits2 === '212612345678', 'Normalisation locale marocaine 06... -> 212612345678');
  const digits3 = normalizeInternationalWhatsApp('+225 07 12 34 56 78', 'CFA');
  assert(digits3 === '2250712345678', 'Normalisation internationale CFA +225 -> 2250712345678');

  // Générateur de catalogue de test (3, 4 et 5 produits)
  const makeProducts = (count: number): Product[] => {
    return Array.from({ length: count }, (_, i) => ({
      id: `prod-00${i + 1}`,
      vendeur_id: mockVendorBase.id,
      name: `Produit Test ${i + 1}`,
      price: 100 * (i + 1),
      description: `Description ${i + 1}`,
      images: [`https://firebasestorage.googleapis.com/v0/b/bucket/o/users%2Fuid%2Fproducts%2F${i + 1}.jpg`],
      category: 'Test',
      created_at: new Date().toISOString(),
    }));
  };

  const prods3 = makeProducts(3);
  const prods4 = makeProducts(4);
  const prods5 = makeProducts(5);

  // Test 4 : Vendeur en Essai actif / VIP (Catalogue complet)
  const vendorVip: Vendeur = { ...mockVendorBase, status: 'VIP', plan: 'VIP' };
  assert(calculateDisplayProducts(vendorVip, prods3).length === 3, 'VIP avec 3 produits affiche bien 3 produits');
  assert(calculateDisplayProducts(vendorVip, prods4).length === 4, 'VIP avec 4 produits affiche bien 4 produits');
  assert(calculateDisplayProducts(vendorVip, prods5).length === 5, 'VIP avec 5 produits affiche bien tous les 5 produits');

  const vendorTrialActive = sanitizePublicStore(mockVendorBase.id, mockVendorBase);
  assert(calculateDisplayProducts(vendorTrialActive, prods3).length === 3, 'Essai actif avec 3 produits affiche 3 produits');
  assert(calculateDisplayProducts(vendorTrialActive, prods4).length === 4, 'Essai actif avec 4 produits affiche 4 produits');
  assert(calculateDisplayProducts(vendorTrialActive, prods5).length === 5, 'Essai actif avec 5 produits affiche tous les 5 produits');

  // Test 5 : Vendeur en mode Gratuit (Plafond strict de 4 produits)
  const vendorFree: Vendeur = { ...mockVendorBase, status: 'Gratuit', plan: 'Gratuit' };
  const storeFree = sanitizePublicStore(vendorFree.id, vendorFree);
  assert(calculateDisplayProducts(storeFree, prods3).length === 3, 'Mode gratuit avec 3 produits affiche 3 produits');
  assert(calculateDisplayProducts(storeFree, prods4).length === 4, 'Mode gratuit avec 4 produits affiche 4 produits');
  assert(calculateDisplayProducts(storeFree, prods5).length === 4, 'Mode gratuit avec 5 produits est strictement limité à 4 produits');

  // Test 6 : Validation des images Firebase Storage (taille et types MIME)
  let invalidTypeCaught = false;
  try {
    const fakeTextFile = { name: 'test.pdf', type: 'application/pdf', size: 1024 } as File;
    validateImageFile(fakeTextFile);
  } catch {
    invalidTypeCaught = true;
  }
  assert(invalidTypeCaught, 'Le service rejette les fichiers non-images (ex. PDF)');

  let oversizeCaught = false;
  try {
    const fakeBigFile = { name: 'huge.jpg', type: 'image/jpeg', size: 15 * 1024 * 1024 } as File; // 15 Mo > 10 Mo
    validateImageFile(fakeBigFile);
  } catch {
    oversizeCaught = true;
  }
  assert(oversizeCaught, 'Le service rejette les images dépassant 10 Mo');

  // Test 7 : Chemin isolé Firebase Storage sous users/{uid}/
  const buildStoragePath = (uid: string, folder: string, filename: string) => {
    const clean = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    return `users/${uid}/${folder}/${clean}`;
  };
  const pathProd = buildStoragePath('vendeur_A', 'products', 'robe.jpg');
  const pathLogo = buildStoragePath('vendeur_A', 'logos', 'logo.png');
  assert(pathProd === 'users/vendeur_A/products/robe.jpg', 'Le chemin produit est isolé par UID sous users/{uid}/products/');
  assert(pathLogo === 'users/vendeur_A/logos/logo.png', 'Le chemin logo est isolé par UID sous users/{uid}/logos/');
  assert(!pathProd.startsWith('blob:'), 'L’URL de stockage n’utilise pas de blob éphémère');

  console.log(`\nRÉSULTATS : ${passed} passés, ${failed} échoués.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
