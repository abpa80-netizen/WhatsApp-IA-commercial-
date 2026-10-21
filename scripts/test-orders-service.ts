/**
 * Test Suite: VIP Structured Orders Engine & Validation (Prompt 1/3)
 * 
 * Verifies:
 * 1. Strict HTTP POST requirement and OPTIONS CORS preflight
 * 2. Input validation (limits, formats, required fields, quantity boundaries)
 * 3. Authoritative VIP requirement (computeVendorEntitlements)
 *    - Active VIP accepted (indefinite or future vipEndsAt)
 *    - 3-day trial strictly rejected (VIP_REQUIRED)
 *    - Expired trial strictly rejected (VIP_REQUIRED)
 *    - Expired VIP strictly rejected (VIP_EXPIRED)
 *    - Suspended / Inactive vendors rejected (VENDOR_SUSPENDED)
 *    - Non-existent vendors rejected (VENDOR_NOT_FOUND)
 * 4. Product integrity:
 *    - Prices read exclusively from Firestore /users/{uid}/products/{productId}
 *    - Client-tampered prices/totals completely ignored
 *    - Non-existent products rejected (PRODUCT_NOT_FOUND)
 *    - Server calculates subtotal, delivery fee and total with floating precision safety
 * 5. Order persistence:
 *    - Stored in /users/{uid}/orders/{orderId}
 *    - Initial status strictly set to 'Nouveau'
 *    - Clean, safe response without private user document leakage
 * 6. Vercel serverless entrypoint compatibility (api/orders/create.ts)
 * 7. Firestore Security Rules verification for orders subcollection
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  handleCreateOrder,
  validateOrderInput,
} from '../src/server/ordersService.ts';
import vercelOrdersHandler from '../api/orders/create.ts';
import { StructuredOrder } from '../src/types.ts';

console.log('🧪 Starting VIP Structured Orders Engine Test Suite...\n');

let testsPassed = 0;

function runTest(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      console.log(`  ✅ [PASS] ${name}`);
      testsPassed++;
    })
    .catch((err: any) => {
      console.error(`  ❌ [FAIL] ${name}`);
      console.error(`     Error: ${err.message}`);
      process.exit(1);
    });
}

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    data: null as any,
    ended: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.data = payload;
      this.ended = true;
      return this;
    },
    end(payload?: any) {
      if (payload) {
        try {
          this.data = JSON.parse(payload);
        } catch {
          this.data = payload;
        }
      }
      this.ended = true;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };
}

/**
 * In-memory Mock Firestore Admin DB
 */
function createMockAdminDb(initialData: {
  users?: Record<string, any>;
  products?: Record<string, Record<string, any>>;
  orders?: Record<string, Record<string, any>>;
}) {
  const usersStore = { ...(initialData.users || {}) };
  const productsStore: Record<string, Record<string, any>> = {};
  if (initialData.products) {
    for (const [uid, prods] of Object.entries(initialData.products)) {
      productsStore[uid] = { ...prods };
    }
  }
  const ordersStore: Record<string, Record<string, any>> = {};
  if (initialData.orders) {
    for (const [uid, ords] of Object.entries(initialData.orders)) {
      ordersStore[uid] = { ...ords };
    }
  }

  return {
    _ordersStore: ordersStore,
    collection(colName: string) {
      if (colName === 'users') {
        return {
          doc(uid: string) {
            return {
              async get() {
                const data = usersStore[uid];
                return {
                  exists: Boolean(data),
                  id: uid,
                  data: () => (data ? { ...data } : undefined),
                };
              },
              collection(subColName: string) {
                if (subColName === 'products') {
                  return {
                    doc(productId: string) {
                      return {
                        async get() {
                          const vendorProds = productsStore[uid] || {};
                          const prod = vendorProds[productId];
                          return {
                            exists: Boolean(prod),
                            id: productId,
                            data: () => (prod ? { ...prod } : undefined),
                          };
                        },
                      };
                    },
                  };
                }
                if (subColName === 'orders') {
                  return {
                    doc(orderId: string) {
                      return {
                        async set(data: any) {
                          if (!ordersStore[uid]) ordersStore[uid] = {};
                          ordersStore[uid][orderId] = { ...data };
                          return { writeTime: new Date() };
                        },
                        async get() {
                          const vendorOrders = ordersStore[uid] || {};
                          const order = vendorOrders[orderId];
                          return {
                            exists: Boolean(order),
                            id: orderId,
                            data: () => (order ? { ...order } : undefined),
                          };
                        },
                      };
                    },
                  };
                }
                throw new Error(`Subcollection ${subColName} not mocked`);
              },
            };
          },
        };
      }
      throw new Error(`Collection ${colName} not mocked`);
    },
  };
}

async function runAllTests() {
  const nowMs = Date.parse('2026-10-21T12:00:00.000Z');
  const day = 24 * 60 * 60 * 1000;

  // ---------------------------------------------------------------------------
  // GROUP 1: Input Validation & Methods
  // ---------------------------------------------------------------------------
  await runTest('1.1 Rejet de la méthode GET avec 405 Method Not Allowed', async () => {
    const req = { method: 'GET', body: {} };
    const res = createMockResponse();
    await handleCreateOrder(req, res);
    assert.strictEqual(res.statusCode, 405);
    assert.strictEqual(res.data.code, 'METHOD_NOT_ALLOWED');
  });

  await runTest('1.2 Requête OPTIONS répond 204 avec les en-têtes CORS', async () => {
    const req = { method: 'OPTIONS' };
    const res = createMockResponse();
    await handleCreateOrder(req, res);
    assert.strictEqual(res.statusCode, 204);
    assert.strictEqual(res.headers['Access-Control-Allow-Origin'], '*');
  });

  await runTest('1.3 Rejet d’un corps vide ou invalide (400)', async () => {
    const res = createMockResponse();
    await handleCreateOrder({ method: 'POST', body: null }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.data.code, 'INVALID_INPUT');
  });

  await runTest('1.4 Rejet si vendeur_id manquant ou caractères invalides (400)', async () => {
    const res1 = createMockResponse();
    await handleCreateOrder({ method: 'POST', body: { customerName: 'Ahmed' } }, res1);
    assert.strictEqual(res1.statusCode, 400);

    const res2 = createMockResponse();
    await handleCreateOrder({ method: 'POST', body: { vendeur_id: 'bad id with spaces!' } }, res2);
    assert.strictEqual(res2.statusCode, 400);
  });

  await runTest('1.5 Rejet si customerName manquant ou trop long (400)', async () => {
    const res = createMockResponse();
    await handleCreateOrder({
      method: 'POST',
      body: {
        vendeur_id: 'seller_1',
        customerName: 'A'.repeat(101),
        customerWhatsApp: '+212600000000',
        deliveryAddress: 'Casablanca',
        items: [{ productId: 'p1', quantity: 1 }],
      },
    }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.data.code, 'INVALID_INPUT');
  });

  await runTest('1.6 Rejet si customerWhatsApp invalide (<6 chiffres) (400)', async () => {
    const res = createMockResponse();
    await handleCreateOrder({
      method: 'POST',
      body: {
        vendeur_id: 'seller_1',
        customerName: 'Fatima',
        customerWhatsApp: 'abc-12',
        deliveryAddress: 'Marrakech',
        items: [{ productId: 'p1', quantity: 1 }],
      },
    }, res);
    assert.strictEqual(res.statusCode, 400);
  });

  await runTest('1.7 Rejet si liste d’articles (items) vide ou > 50 (400)', async () => {
    const res1 = createMockResponse();
    await handleCreateOrder({
      method: 'POST',
      body: {
        vendeur_id: 'seller_1',
        customerName: 'Fatima',
        customerWhatsApp: '+212600000000',
        deliveryAddress: 'Rabat',
        items: [],
      },
    }, res1);
    assert.strictEqual(res1.statusCode, 400);

    const res2 = createMockResponse();
    const lotsOfItems = Array.from({ length: 51 }, (_, i) => ({ productId: `p_${i}`, quantity: 1 }));
    await handleCreateOrder({
      method: 'POST',
      body: {
        vendeur_id: 'seller_1',
        customerName: 'Fatima',
        customerWhatsApp: '+212600000000',
        deliveryAddress: 'Rabat',
        items: lotsOfItems,
      },
    }, res2);
    assert.strictEqual(res2.statusCode, 400);
  });

  await runTest('1.8 Rejet si quantité invalide (0, négative, décimale, string non numérique) (400)', () => {
    const checkQty = (q: any) => validateOrderInput({
      vendeur_id: 'seller_1',
      customerName: 'Client',
      customerWhatsApp: '+212600000000',
      deliveryAddress: 'Casablanca',
      items: [{ productId: 'p1', quantity: q }],
    });

    assert.strictEqual(checkQty(0).valid, false);
    assert.strictEqual(checkQty(-1).valid, false);
    assert.strictEqual(checkQty(1.5).valid, false);
    assert.strictEqual(checkQty('deux').valid, false);
    assert.strictEqual(checkQty(1001).valid, false); // Over limit
    assert.strictEqual(checkQty(2).valid, true);
  });

  // ---------------------------------------------------------------------------
  // GROUP 2: Vendor Entitlements & Subscription Enforcement
  // ---------------------------------------------------------------------------
  const mockDb = createMockAdminDb({
    users: {
      vip_active_seller: {
        uid: 'vip_active_seller',
        status: 'VIP',
        plan: 'VIP',
        vipStartedAt: new Date(nowMs - 5 * day).toISOString(),
        vipEndsAt: new Date(nowMs + 25 * day).toISOString(),
        currency: 'MAD',
      },
      vip_indefinite_seller: {
        uid: 'vip_indefinite_seller',
        status: 'VIP',
        plan: 'VIP',
        currency: 'CFA',
      },
      trial_active_seller: {
        uid: 'trial_active_seller',
        status: 'Actif',
        plan: 'Essai',
        trialStartedAt: new Date(nowMs - 1 * day).toISOString(),
        trialEndsAt: new Date(nowMs + 2 * day).toISOString(),
        currency: 'MAD',
      },
      trial_expired_seller: {
        uid: 'trial_expired_seller',
        status: 'Actif',
        plan: 'Essai',
        trialStartedAt: new Date(nowMs - 5 * day).toISOString(),
        trialEndsAt: new Date(nowMs - 2 * day).toISOString(),
        currency: 'MAD',
      },
      vip_expired_seller: {
        uid: 'vip_expired_seller',
        status: 'VIP',
        plan: 'VIP',
        vipEndsAt: new Date(nowMs - 1 * day).toISOString(),
        currency: 'MAD',
      },
      suspended_seller: {
        uid: 'suspended_seller',
        status: 'Suspendu',
        plan: 'VIP',
        vipEndsAt: new Date(nowMs + 30 * day).toISOString(),
        currency: 'MAD',
      },
      free_seller: {
        uid: 'free_seller',
        status: 'Gratuit',
        plan: 'Gratuit',
        currency: 'MAD',
      },
    },
    products: {
      vip_active_seller: {
        prod_shoes: {
          id: 'prod_shoes',
          vendeur_id: 'vip_active_seller',
          name: 'Baskets Air Runner',
          price: 450,
          images: ['https://res.cloudinary.com/test/shoes.webp'],
        },
        prod_socks: {
          id: 'prod_socks',
          vendeur_id: 'vip_active_seller',
          name: 'Chaussettes Sport x3',
          price: 50,
          images: [],
        },
      },
      vip_indefinite_seller: {
        prod_bag: {
          id: 'prod_bag',
          vendeur_id: 'vip_indefinite_seller',
          name: 'Sac en cuir',
          price: 15000,
          images: ['https://res.cloudinary.com/test/bag.webp'],
        },
      },
      trial_active_seller: {
        prod_trial: {
          id: 'prod_trial',
          vendeur_id: 'trial_active_seller',
          name: 'Produit Essai',
          price: 100,
          images: [],
        },
      },
    },
  });

  await runTest('2.1 Vendeur inexistant refusé avec 404 VENDOR_NOT_FOUND', async () => {
    const res = createMockResponse();
    await handleCreateOrder({
      method: 'POST',
      body: {
        vendeur_id: 'seller_ghost',
        customerName: 'Yassine',
        customerWhatsApp: '+212611223344',
        deliveryAddress: 'Tanger',
        items: [{ productId: 'p1', quantity: 1 }],
      },
    }, res, { adminDb: mockDb, nowMs });
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.data.code, 'VENDOR_NOT_FOUND');
  });

  await runTest('2.2 Vendeur suspendu refusé avec 403 VENDOR_SUSPENDED', async () => {
    const res = createMockResponse();
    await handleCreateOrder({
      method: 'POST',
      body: {
        vendeur_id: 'suspended_seller',
        customerName: 'Yassine',
        customerWhatsApp: '+212611223344',
        deliveryAddress: 'Tanger',
        items: [{ productId: 'p1', quantity: 1 }],
      },
    }, res, { adminDb: mockDb, nowMs });
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.data.code, 'VENDOR_SUSPENDED');
  });

  await runTest('2.3 Vendeur en essai gratuit refusé avec 403 VIP_REQUIRED (l’essai ne donne pas accès aux commandes structurées)', async () => {
    const res = createMockResponse();
    await handleCreateOrder({
      method: 'POST',
      body: {
        vendeur_id: 'trial_active_seller',
        customerName: 'Nadia',
        customerWhatsApp: '+212622334455',
        deliveryAddress: 'Agadir',
        items: [{ productId: 'prod_trial', quantity: 1 }],
      },
    }, res, { adminDb: mockDb, nowMs });
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.data.code, 'VIP_REQUIRED');
    assert.ok(res.data.error.includes('réservée aux vendeurs VIP'), 'Message explicite sur l’essai gratuit');
  });

  await runTest('2.4 Vendeur avec essai expiré refusé avec 403 VIP_REQUIRED', async () => {
    const res = createMockResponse();
    await handleCreateOrder({
      method: 'POST',
      body: {
        vendeur_id: 'trial_expired_seller',
        customerName: 'Nadia',
        customerWhatsApp: '+212622334455',
        deliveryAddress: 'Agadir',
        items: [{ productId: 'p1', quantity: 1 }],
      },
    }, res, { adminDb: mockDb, nowMs });
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.data.code, 'VIP_REQUIRED');
  });

  await runTest('2.5 Vendeur avec VIP expiré refusé avec 403 VIP_EXPIRED', async () => {
    const res = createMockResponse();
    await handleCreateOrder({
      method: 'POST',
      body: {
        vendeur_id: 'vip_expired_seller',
        customerName: 'Omar',
        customerWhatsApp: '+212633445566',
        deliveryAddress: 'Fès',
        items: [{ productId: 'p1', quantity: 1 }],
      },
    }, res, { adminDb: mockDb, nowMs });
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.data.code, 'VIP_EXPIRED');
  });

  await runTest('2.6 Vendeur Gratuit refusé avec 403 VIP_REQUIRED', async () => {
    const res = createMockResponse();
    await handleCreateOrder({
      method: 'POST',
      body: {
        vendeur_id: 'free_seller',
        customerName: 'Salma',
        customerWhatsApp: '+212644556677',
        deliveryAddress: 'Oujda',
        items: [{ productId: 'p1', quantity: 1 }],
      },
    }, res, { adminDb: mockDb, nowMs });
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.data.code, 'VIP_REQUIRED');
  });

  // ---------------------------------------------------------------------------
  // GROUP 3: Product Integrity & Server-Side Calculations
  // ---------------------------------------------------------------------------
  await runTest('3.1 Rejet si un des produits demandés n’existe pas dans Firestore (404 PRODUCT_NOT_FOUND)', async () => {
    const res = createMockResponse();
    await handleCreateOrder({
      method: 'POST',
      body: {
        vendeur_id: 'vip_active_seller',
        customerName: 'Karim',
        customerWhatsApp: '+212655667788',
        deliveryAddress: 'Casablanca Anfa',
        items: [
          { productId: 'prod_shoes', quantity: 1 },
          { productId: 'prod_inexistant', quantity: 2 },
        ],
      },
    }, res, { adminDb: mockDb, nowMs });
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.data.code, 'PRODUCT_NOT_FOUND');
  });

  await runTest('3.2 Commande nominale avec VIP actif : succès 201 et sauvegarde conforme dans Firestore', async () => {
    const res = createMockResponse();
    await handleCreateOrder({
      method: 'POST',
      body: {
        vendeur_id: 'vip_active_seller',
        customerName: 'Karim Bennani',
        customerWhatsApp: '+212655667788',
        deliveryAddress: 'Casablanca, Bd d’Anfa n°12',
        deliveryFee: 35,
        notes: 'Sonner au 3ème étage svp',
        items: [
          { productId: 'prod_shoes', quantity: 2 }, // 450 * 2 = 900
          { productId: 'prod_socks', quantity: 1 }, // 50 * 1 = 50
        ],
      },
    }, res, { adminDb: mockDb, nowMs });

    assert.strictEqual(res.statusCode, 201, 'Status code doit être 201 Created');
    assert.strictEqual(res.data.success, true);
    assert.ok(res.data.orderId.startsWith('ord_'), 'orderId généré avec préfixe ord_');
    assert.strictEqual(res.data.subtotal, 950, 'Sous-total calculé côté serveur = 950 MAD');
    assert.strictEqual(res.data.deliveryFee, 35, 'Frais de livraison = 35 MAD');
    assert.strictEqual(res.data.total, 985, 'Total = 950 + 35 = 985 MAD');
    assert.strictEqual(res.data.currency, 'MAD');
    assert.strictEqual(res.data.status, 'Nouveau');

    // Vérifier l'enregistrement effectif dans le document Firestore /users/{uid}/orders/{orderId}
    const savedOrder: StructuredOrder = mockDb._ordersStore['vip_active_seller'][res.data.orderId];
    assert.ok(savedOrder, 'La commande doit être enregistrée dans la sous-collection orders');
    assert.strictEqual(savedOrder.id, res.data.orderId);
    assert.strictEqual(savedOrder.vendeur_id, 'vip_active_seller');
    assert.strictEqual(savedOrder.customerName, 'Karim Bennani');
    assert.strictEqual(savedOrder.customerWhatsApp, '+212655667788');
    assert.strictEqual(savedOrder.deliveryAddress, 'Casablanca, Bd d’Anfa n°12');
    assert.strictEqual(savedOrder.notes, 'Sonner au 3ème étage svp');
    assert.strictEqual(savedOrder.status, 'Nouveau', 'Statut initial obligatoire Nouveau');
    assert.strictEqual(savedOrder.items.length, 2);
    assert.strictEqual(savedOrder.items[0].name, 'Baskets Air Runner');
    assert.strictEqual(savedOrder.items[0].price, 450);
    assert.strictEqual(savedOrder.items[0].quantity, 2);
    assert.strictEqual(savedOrder.items[0].total, 900);
    assert.strictEqual(savedOrder.items[0].image, 'https://res.cloudinary.com/test/shoes.webp');
  });

  await runTest('3.3 Sécurité absolue : les prix et totaux manipulés par le client sont IGNORÉS', async () => {
    const res = createMockResponse();
    // Le client tente d'injecter un prix de 1 MAD et un total de 2 MAD
    await handleCreateOrder({
      method: 'POST',
      body: {
        vendeur_id: 'vip_active_seller',
        customerName: 'Hacker Test',
        customerWhatsApp: '+212699999999',
        deliveryAddress: 'Rabat',
        deliveryFee: 0,
        items: [
          {
            productId: 'prod_shoes', // Vrai prix catalogue = 450 MAD
            quantity: 2,
            price: 1, // TENTATIVE DE FRAUDE
            total: 2, // TENTATIVE DE FRAUDE
            name: 'Faux nom gratuit',
          },
        ],
      },
    }, res, { adminDb: mockDb, nowMs });

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.data.subtotal, 900, 'Le serveur applique le prix officiel Firestore (450 * 2 = 900)');
    assert.strictEqual(res.data.total, 900, 'Le total frauduleux est rejeté');

    const savedOrder = mockDb._ordersStore['vip_active_seller'][res.data.orderId];
    assert.strictEqual(savedOrder.items[0].price, 450);
    assert.strictEqual(savedOrder.items[0].name, 'Baskets Air Runner');
    assert.strictEqual(savedOrder.total, 900);
  });

  await runTest('3.4 VIP Indéfini (sans vipEndsAt) et devise CFA acceptés avec exactitude', async () => {
    const res = createMockResponse();
    await handleCreateOrder({
      method: 'POST',
      body: {
        vendeur_id: 'vip_indefinite_seller',
        customerName: 'Kouassi Amadou',
        customerWhatsApp: '+2250708091011',
        deliveryAddress: 'Abidjan Cocody',
        deliveryFee: 1500,
        items: [
          { productId: 'prod_bag', quantity: 1 }, // 15 000 CFA
        ],
      },
    }, res, { adminDb: mockDb, nowMs });

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.data.currency, 'CFA');
    assert.strictEqual(res.data.subtotal, 15000);
    assert.strictEqual(res.data.deliveryFee, 1500);
    assert.strictEqual(res.data.total, 16500);
  });

  // ---------------------------------------------------------------------------
  // GROUP 4: Vercel Serverless Function & Non-exposure
  // ---------------------------------------------------------------------------
  await runTest('4.1 Handler Vercel api/orders/create.ts opérationnel', async () => {
    const req = { method: 'OPTIONS' };
    const res = createMockResponse();
    await vercelOrdersHandler(req, res);
    assert.strictEqual(res.statusCode, 204);
  });

  await runTest('4.2 Pas de fuite de données privées du vendeur dans la réponse de commande', async () => {
    const res = createMockResponse();
    await handleCreateOrder({
      method: 'POST',
      body: {
        vendeur_id: 'vip_active_seller',
        customerName: 'Amina',
        customerWhatsApp: '+212612345678',
        deliveryAddress: 'Marrakech',
        items: [{ productId: 'prod_shoes', quantity: 1 }],
      },
    }, res, { adminDb: mockDb, nowMs });

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.data.role, undefined);
    assert.strictEqual(res.data.plan, undefined);
    assert.strictEqual(res.data.vipEndsAt, undefined);
    assert.strictEqual(res.data.phoneNormalized, undefined);
    assert.strictEqual(res.data.whatsappNumber, undefined);
  });

  // ---------------------------------------------------------------------------
  // GROUP 5: Firestore Rules Verification
  // ---------------------------------------------------------------------------
  await runTest('5.1 Vérification de l’intégrité des règles firestore.rules pour /users/{uid}/orders/{orderId}', () => {
    const rulesContent = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');
    
    assert.ok(rulesContent.includes('match /orders/{orderId}'), 'Règle match /orders/{orderId} présente');
    assert.ok(rulesContent.includes('allow create: if false;'), 'Création directe navigateur interdite (allow create: if false)');
    assert.ok(rulesContent.includes('allow read: if isOwner(uid) || isAdmin();'), 'Lecture réservée au propriétaire ou admin');
    assert.ok(rulesContent.includes('allow delete: if isAdmin();'), 'Suppression réservée à admin');
    assert.ok(rulesContent.includes('affectedKeys().hasOnly([\'status\', \'updatedAt\'])'), 'Modification limitée à status et updatedAt');
    assert.ok(rulesContent.includes('\'Nouveau\', \'Confirmée\', \'En préparation\', \'Expédiée\', \'Livrée\', \'Annulée\''), 'Validation des 6 statuts autorisés');
  });

  console.log(`\n==================================================`);
  console.log(`RÉSULTATS : ${testsPassed} passés, 0 échoués`);
  console.log(`==================================================\n`);
}

runAllTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
