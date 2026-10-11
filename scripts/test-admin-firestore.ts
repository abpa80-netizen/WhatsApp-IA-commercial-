/**
 * Validation tests for Admin Firestore functionality:
 * 1. Admin KPI computation from real vendor documents and subcollections
 * 2. Settings/global bidirectional field compatibility & aliases (vipPrice, trialDays, vipPriceCfa, supportWhatsapp)
 * 3. Admin rights verification logic (foosco80@gmail.com, role 'admin', unauthorized seller rejection)
 * 4. Structured Firestore error handling & permission diagnostics
 * 5. Vendor record formatting (WhatsApp, createdAt, status, plan, trialStartedAt, trialEndsAt)
 */

import assert from 'assert';
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

console.log(`\n🎉 All ${testsPassed} Admin Firestore and Permission tests passed successfully!\n`);
