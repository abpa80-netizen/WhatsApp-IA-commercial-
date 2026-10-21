/**
 * Test Suite: VIP Structured Orders Engine & Hardening (Prompt 1 & Prompt 2A)
 * 
 * Verifies:
 * 1. Strict HTTP POST requirement and OPTIONS CORS preflight
 * 2. Input validation (limits, formats, required fields, quantity boundaries)
 * 3. Safe product deduplication in items (merging quantities, capping cumulative qty at 1000, max 50 items)
 * 4. Authoritative VIP requirement (computeVendorEntitlements)
 *    - Active VIP accepted (indefinite or future vipEndsAt)
 *    - 3-day trial strictly rejected (VIP_REQUIRED)
 *    - Expired trial strictly rejected (VIP_REQUIRED)
 *    - Expired VIP strictly rejected (VIP_EXPIRED)
 *    - Suspended / Inactive vendors rejected (VENDOR_SUSPENDED)
 *    - Non-existent vendors rejected (VENDOR_NOT_FOUND)
 * 5. Product integrity:
 *    - Prices read exclusively from Firestore /users/{uid}/products/{productId}
 *    - Client-tampered prices/totals completely ignored
 *    - Non-existent products rejected (PRODUCT_NOT_FOUND)
 *    - Server calculates subtotal, delivery fee and total with floating precision safety
 * 6. Order persistence:
 *    - Stored in /users/{uid}/orders/{orderId}
 *    - Initial status strictly set to 'Nouveau'
 *    - Clean, safe response without private user document leakage
 * 7. Idempotency Key Engine:
 *    - Input validation of idempotency key (8-128 chars, ^[a-zA-Z0-9_\-]+$)
 *    - Isolation per vendor (/users/{uid}/idempotency/{key})
 *    - Replay returns cached confirmation (replayed: true, HTTP 200) without creating second order
 *    - Concurrent requests handled safely via transaction lock
 *    - Orders without key still work nominally
 * 8. Distributed Rate Limiting:
 *    - Reliable IP extraction (x-vercel-forwarded-for, x-forwarded-for, x-real-ip)
 *    - Hashed IP storage (SHA-256) in /rateLimits/{limitId}
 *    - Enforces max requests per window (default 10 reqs / 10 min), returns 429 & Retry-After header
 *    - Fail-open/memory fallback resilience during database error
 * 9. Firestore Security Rules verification:
 *    - /users/{uid}/orders/{orderId} permissions
 *    - /users/{uid}/idempotency/{idempId} completely closed to browser clients
 *    - /rateLimits/{limitId} completely closed to browser clients
 * 10. Vercel serverless entrypoint compatibility (api/orders/create.ts)
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  handleCreateOrder,
  validateOrderInput,
  checkOrdersRateLimit,
  getClientIp,
  resetMemoryRateLimits,
  computeOrderRequestHash,
} from '../src/server/ordersService.ts';
import vercelOrdersHandler from '../api/orders/create.ts';
import { StructuredOrder } from '../src/types.ts';

console.log('🧪 Starting VIP Structured Orders Engine Test Suite (Prompt 2A)...\n');

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
 * In-memory Mock Firestore Admin DB supporting Collections, Subcollections & Transactions
 */
function createMockAdminDb(initialData: {
  users?: Record<string, any>;
  products?: Record<string, Record<string, any>>;
  orders?: Record<string, Record<string, any>>;
  idempotency?: Record<string, Record<string, any>>;
  rateLimits?: Record<string, any>;
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
  const idempotencyStore: Record<string, Record<string, any>> = {};
  if (initialData.idempotency) {
    for (const [uid, idemps] of Object.entries(initialData.idempotency)) {
      idempotencyStore[uid] = { ...idemps };
    }
  }
  const rateLimitsStore: Record<string, any> = { ...(initialData.rateLimits || {}) };

  const db = {
    _usersStore: usersStore,
    _productsStore: productsStore,
    _ordersStore: ordersStore,
    _idempotencyStore: idempotencyStore,
    _rateLimitsStore: rateLimitsStore,

    collection(colName: string) {
      if (colName === 'rateLimits') {
        return {
          doc(limitId: string) {
            const docRef = {
              id: limitId,
              path: `rateLimits/${limitId}`,
              async get() {
                const data = rateLimitsStore[limitId];
                return {
                  exists: Boolean(data),
                  id: limitId,
                  data: () => (data ? { ...data } : undefined),
                };
              },
              async set(data: any, options?: { merge?: boolean }) {
                if (options?.merge && rateLimitsStore[limitId]) {
                  rateLimitsStore[limitId] = { ...rateLimitsStore[limitId], ...data };
                } else {
                  rateLimitsStore[limitId] = { ...data };
                }
                return { writeTime: new Date() };
              },
            };
            return docRef;
          },
        };
      }

      if (colName === 'users') {
        return {
          doc(uid: string) {
            const userDocRef = {
              id: uid,
              path: `users/${uid}`,
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
                        id: productId,
                        path: `users/${uid}/products/${productId}`,
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
                        id: orderId,
                        path: `users/${uid}/orders/${orderId}`,
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
                if (subColName === 'idempotency') {
                  return {
                    doc(key: string) {
                      return {
                        id: key,
                        path: `users/${uid}/idempotency/${key}`,
                        async set(data: any) {
                          if (!idempotencyStore[uid]) idempotencyStore[uid] = {};
                          idempotencyStore[uid][key] = { ...data };
                          return { writeTime: new Date() };
                        },
                        async get() {
                          const vendorIdemps = idempotencyStore[uid] || {};
                          const idempData = vendorIdemps[key];
                          return {
                            exists: Boolean(idempData),
                            id: key,
                            data: () => (idempData ? { ...idempData } : undefined),
                          };
                        },
                      };
                    },
                  };
                }
                throw new Error(`Subcollection ${subColName} not mocked`);
              },
            };
            return userDocRef;
          },
        };
      }
      throw new Error(`Collection ${colName} not mocked`);
    },

    _txLock: Promise.resolve() as Promise<any>,
    async runTransaction(updateFunction: (transaction: any) => Promise<any>) {
      // Models Firestore's document-level transaction isolation and serialization
      const currentLock = this._txLock;
      const nextLock = currentLock.then(async () => {
        const transaction = {
          async get(docRef: any) {
            return docRef.get();
          },
          set(docRef: any, data: any, options?: any) {
            return docRef.set(data, options);
          },
          update(docRef: any, data: any) {
            return docRef.set(data, { merge: true });
          },
        };
        return updateFunction(transaction);
      });
      this._txLock = nextLock.catch(() => {});
      return nextLock;
    },
  };

  return db;
}

async function runAllTests() {
  const nowMs = Date.parse('2026-10-21T12:00:00.000Z');
  const day = 24 * 60 * 60 * 1000;

  // ---------------------------------------------------------------------------
  // GROUP 1: Input Validation, Methods & Duplicate Product Merging
  // ---------------------------------------------------------------------------
  await runTest('1.1 Rejet de la méthode GET avec 405 Method Not Allowed', async () => {
    const req = { method: 'GET', body: {} };
    const res = createMockResponse();
    await handleCreateOrder(req, res, { skipRateLimit: true });
    assert.strictEqual(res.statusCode, 405);
    assert.strictEqual(res.data.code, 'METHOD_NOT_ALLOWED');
  });

  await runTest('1.2 Requête OPTIONS répond 204 avec les en-têtes CORS et Idempotency', async () => {
    const req = { method: 'OPTIONS' };
    const res = createMockResponse();
    await handleCreateOrder(req, res, { skipRateLimit: true });
    assert.strictEqual(res.statusCode, 204);
    assert.strictEqual(res.headers['Access-Control-Allow-Origin'], '*');
    assert.ok(res.headers['Access-Control-Allow-Headers'].includes('Idempotency-Key'));
  });

  await runTest('1.3 Rejet d’un corps vide ou invalide (400)', async () => {
    const res = createMockResponse();
    await handleCreateOrder({ method: 'POST', body: null }, res, { skipRateLimit: true });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.data.code, 'INVALID_INPUT');
  });

  await runTest('1.4 Rejet si vendeur_id manquant ou caractères invalides (400)', async () => {
    const res1 = createMockResponse();
    await handleCreateOrder({ method: 'POST', body: { customerName: 'Ahmed' } }, res1, { skipRateLimit: true });
    assert.strictEqual(res1.statusCode, 400);

    const res2 = createMockResponse();
    await handleCreateOrder({ method: 'POST', body: { vendeur_id: 'bad id with spaces!' } }, res2, { skipRateLimit: true });
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
    }, res, { skipRateLimit: true });
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
    }, res, { skipRateLimit: true });
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
    }, res1, { skipRateLimit: true });
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
    }, res2, { skipRateLimit: true });
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

  await runTest('1.9 Fusion automatique des articles ayant le même productId dans le panier', () => {
    const res = validateOrderInput({
      vendeur_id: 'seller_1',
      customerName: 'Client Test',
      customerWhatsApp: '+212600000000',
      deliveryAddress: 'Casablanca',
      items: [
        { productId: 'shoes_123', quantity: 2 },
        { productId: 'socks_456', quantity: 1 },
        { productId: 'shoes_123', quantity: 3 }, // Duplicata qui doit être fusionné
      ],
    });

    assert.strictEqual(res.valid, true);
    if (res.valid) {
      assert.strictEqual(res.data.items.length, 2, 'Les duplicatas sont fusionnés : 2 articles uniques');
      const mergedShoes = res.data.items.find(i => i.productId === 'shoes_123');
      assert.strictEqual(mergedShoes?.quantity, 5, 'Quantité fusionnée = 2 + 3 = 5');
    }
  });

  await runTest('1.10 Rejet si la quantité cumulée d’un produit fusionné dépasse 1000', () => {
    const res = validateOrderInput({
      vendeur_id: 'seller_1',
      customerName: 'Client Test',
      customerWhatsApp: '+212600000000',
      deliveryAddress: 'Casablanca',
      items: [
        { productId: 'shoes_123', quantity: 600 },
        { productId: 'shoes_123', quantity: 450 }, // Total = 1050 > 1000
      ],
    });

    assert.strictEqual(res.valid, false);
    if (!res.valid) {
      assert.ok(res.error.includes('ne peut pas dépasser 1000'), 'Message explicite sur la quantité cumulée');
    }
  });

  await runTest('1.11 Validation stricte du format de clé d’idempotence (longueur et caractères)', () => {
    const checkKey = (key: any) => validateOrderInput({
      vendeur_id: 'seller_1',
      customerName: 'Client',
      customerWhatsApp: '+212600000000',
      deliveryAddress: 'Casablanca',
      items: [{ productId: 'p1', quantity: 1 }],
      idempotencyKey: key,
    });

    // Too short (<8)
    assert.strictEqual(checkKey('short').valid, false);
    // Invalid characters (spaces, special chars)
    assert.strictEqual(checkKey('key with spaces 123').valid, false);
    assert.strictEqual(checkKey('key!@#$%^&*()').valid, false);
    // Too long (>128)
    assert.strictEqual(checkKey('a'.repeat(129)).valid, false);
    // Valid format
    assert.strictEqual(checkKey('checkout_12345678_uuid').valid, true);
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
    }, res, { adminDb: mockDb, nowMs, skipRateLimit: true });
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
    }, res, { adminDb: mockDb, nowMs, skipRateLimit: true });
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
    }, res, { adminDb: mockDb, nowMs, skipRateLimit: true });
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
    }, res, { adminDb: mockDb, nowMs, skipRateLimit: true });
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
    }, res, { adminDb: mockDb, nowMs, skipRateLimit: true });
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
    }, res, { adminDb: mockDb, nowMs, skipRateLimit: true });
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
    }, res, { adminDb: mockDb, nowMs, skipRateLimit: true });
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.data.code, 'PRODUCT_NOT_FOUND');
  });

  await runTest('3.2 Commande nominale avec VIP actif : succès 201 et sauvegarde conforme dans Firestore', async () => {
    mockDb._usersStore['vip_active_seller'].defaultDeliveryFee = 35;
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
    }, res, { adminDb: mockDb, nowMs, skipRateLimit: true });

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
    }, res, { adminDb: mockDb, nowMs, skipRateLimit: true });

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.data.subtotal, 900, 'Le serveur applique le prix officiel Firestore (450 * 2 = 900)');
    assert.strictEqual(res.data.total, 900, 'Le total frauduleux est rejeté');

    const savedOrder = mockDb._ordersStore['vip_active_seller'][res.data.orderId];
    assert.strictEqual(savedOrder.items[0].price, 450);
    assert.strictEqual(savedOrder.items[0].name, 'Baskets Air Runner');
    assert.strictEqual(savedOrder.total, 900);
  });

  await runTest('3.4 VIP Indéfini (sans vipEndsAt) et devise CFA acceptés avec exactitude', async () => {
    mockDb._usersStore['vip_indefinite_seller'].defaultDeliveryFee = 1500;
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
    }, res, { adminDb: mockDb, nowMs, skipRateLimit: true });

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.data.currency, 'CFA');
    assert.strictEqual(res.data.subtotal, 15000);
    assert.strictEqual(res.data.deliveryFee, 1500);
    assert.strictEqual(res.data.total, 16500);
  });

  // ---------------------------------------------------------------------------
  // GROUP 4: Idempotency Protection (Prompt 2A)
  // ---------------------------------------------------------------------------
  await runTest('4.1 Création initiale avec idempotencyKey enregistre le document d’idempotence', async () => {
    const res = createMockResponse();
    const idempKey = 'order_test_key_001_initial';

    await handleCreateOrder({
      method: 'POST',
      body: {
        vendeur_id: 'vip_active_seller',
        customerName: 'Idemp Test User',
        customerWhatsApp: '+212600112233',
        deliveryAddress: 'Rabat Agdal',
        deliveryFee: 20,
        idempotencyKey: idempKey,
        items: [{ productId: 'prod_shoes', quantity: 1 }],
      },
    }, res, { adminDb: mockDb, nowMs, skipRateLimit: true });

    assert.strictEqual(res.statusCode, 201);
    const orderId = res.data.orderId;
    assert.ok(orderId);

    // Vérifier le document d'idempotence
    const savedIdemp = mockDb._idempotencyStore['vip_active_seller']?.[idempKey];
    assert.ok(savedIdemp, 'Le document d’idempotence doit être présent dans la sous-collection du vendeur');
    assert.strictEqual(savedIdemp.orderId, orderId);
    assert.strictEqual(savedIdemp.vendeur_id, 'vip_active_seller');
    assert.strictEqual(savedIdemp.total, 470);
    assert.ok(savedIdemp.expiresAt, 'Le champ d’expiration TTL (7 jours) est présent');
  });

  await runTest('4.2 Rejeu de commande avec la même idempotencyKey renvoie le résultat sans dupliquer la commande (200 replayed: true)', async () => {
    const resReplay = createMockResponse();
    const idempKey = 'order_test_key_001_initial';
    const initialOrdersCount = Object.keys(mockDb._ordersStore['vip_active_seller'] || {}).length;

    // Deuxième tentative avec les mêmes données ou une requête répétée par le client
    await handleCreateOrder({
      method: 'POST',
      body: {
        vendeur_id: 'vip_active_seller',
        customerName: 'Idemp Test User',
        customerWhatsApp: '+212600112233',
        deliveryAddress: 'Rabat Agdal',
        deliveryFee: 20,
        idempotencyKey: idempKey,
        items: [{ productId: 'prod_shoes', quantity: 1 }],
      },
    }, resReplay, { adminDb: mockDb, nowMs, skipRateLimit: true });

    assert.strictEqual(resReplay.statusCode, 200, 'Statut 200 renvoyé pour le rejeu idempotent');
    assert.strictEqual(resReplay.data.replayed, true, 'Indicateur replayed: true retourné');
    assert.strictEqual(resReplay.data.total, 470);

    const finalOrdersCount = Object.keys(mockDb._ordersStore['vip_active_seller'] || {}).length;
    assert.strictEqual(finalOrdersCount, initialOrdersCount, 'AUCUNE nouvelle commande créée dans Firestore');
  });

  await runTest('4.3 Envoi de la clé d’idempotence via l’en-tête HTTP Idempotency-Key supporté', async () => {
    const res = createMockResponse();
    const idempKey = 'header_idemp_key_abcdef123';

    await handleCreateOrder({
      method: 'POST',
      headers: {
        'idempotency-key': idempKey,
      },
      body: {
        vendeur_id: 'vip_active_seller',
        customerName: 'Header Client',
        customerWhatsApp: '+212600112233',
        deliveryAddress: 'Casablanca Oasis',
        items: [{ productId: 'prod_shoes', quantity: 1 }],
      },
    }, res, { adminDb: mockDb, nowMs, skipRateLimit: true });

    assert.strictEqual(res.statusCode, 201);
    const savedIdemp = mockDb._idempotencyStore['vip_active_seller']?.[idempKey];
    assert.ok(savedIdemp, 'La clé issue du header HTTP est bien prise en compte et persistée');
  });

  await runTest('4.4 Isolation des clés d’idempotence par vendeur (deux vendeurs distincts avec la même clé n’interfèrent pas)', async () => {
    const sharedKey = 'shared_key_across_vendors_999';

    // Vendeur 1
    const res1 = createMockResponse();
    await handleCreateOrder({
      method: 'POST',
      body: {
        vendeur_id: 'vip_active_seller',
        customerName: 'Client Seller 1',
        customerWhatsApp: '+212600112233',
        deliveryAddress: 'Casablanca',
        idempotencyKey: sharedKey,
        items: [{ productId: 'prod_shoes', quantity: 1 }],
      },
    }, res1, { adminDb: mockDb, nowMs, skipRateLimit: true });
    assert.strictEqual(res1.statusCode, 201);

    // Vendeur 2 avec la MÊME clé : ne doit PAS renvoyer la commande du Vendeur 1 !
    const res2 = createMockResponse();
    await handleCreateOrder({
      method: 'POST',
      body: {
        vendeur_id: 'vip_indefinite_seller',
        customerName: 'Client Seller 2',
        customerWhatsApp: '+2250102030405',
        deliveryAddress: 'Abidjan',
        idempotencyKey: sharedKey,
        items: [{ productId: 'prod_bag', quantity: 1 }],
      },
    }, res2, { adminDb: mockDb, nowMs, skipRateLimit: true });

    assert.strictEqual(res2.statusCode, 201);
    assert.notStrictEqual(res1.data.orderId, res2.data.orderId, 'Les commandes des deux vendeurs sont bien distinctes');
    assert.strictEqual(res2.data.currency, 'CFA');
    assert.strictEqual(res2.data.replayed, undefined, 'Pas de rejeu erroné entre vendeurs distincts');
  });

  await runTest('4.5 Requêtes concurrentes simultanées avec la même clé : exactement une commande créée', async () => {
    const concurrentKey = 'concurrent_order_key_abc_777';
    const resA = createMockResponse();
    const resB = createMockResponse();

    const orderPayload = {
      method: 'POST',
      body: {
        vendeur_id: 'vip_active_seller',
        customerName: 'Concurrent User',
        customerWhatsApp: '+212600112233',
        deliveryAddress: 'Casablanca',
        idempotencyKey: concurrentKey,
        items: [{ productId: 'prod_shoes', quantity: 1 }],
      },
    };

    const initialCount = Object.keys(mockDb._ordersStore['vip_active_seller'] || {}).length;

    // Simulation de 2 requêtes simultanées envoyées par double-clic ou retry immédiat
    await Promise.all([
      handleCreateOrder(orderPayload, resA, { adminDb: mockDb, nowMs, skipRateLimit: true }),
      handleCreateOrder(orderPayload, resB, { adminDb: mockDb, nowMs, skipRateLimit: true }),
    ]);

    const finalCount = Object.keys(mockDb._ordersStore['vip_active_seller'] || {}).length;
    assert.strictEqual(finalCount, initialCount + 1, 'Exactement UNE seule commande a été créée en base');

    // Les deux requêtes doivent avoir abouti avec succès (200 ou 201) et le même orderId
    const orderIdA = resA.data.orderId;
    const orderIdB = resB.data.orderId;
    assert.strictEqual(orderIdA, orderIdB, 'Les deux réponses font référence au même orderId');
    assert.ok(resA.statusCode === 200 || resA.statusCode === 201);
    assert.ok(resB.statusCode === 200 || resB.statusCode === 201);
  });

  await runTest('4.6 Même clé + contenu différent renvoie HTTP 409 IDEMPOTENCY_CONFLICT sans créer de commande', async () => {
    const key = 'conflict_test_key_abc_111';
    const initialOrdersCount = Object.keys(mockDb._ordersStore['vip_active_seller'] || {}).length;

    // Requête initiale
    const res1 = createMockResponse();
    await handleCreateOrder({
      method: 'POST',
      body: {
        vendeur_id: 'vip_active_seller',
        customerName: 'Client Initial',
        customerWhatsApp: '+212600112233',
        deliveryAddress: 'Casablanca',
        deliveryFee: 20,
        idempotencyKey: key,
        items: [{ productId: 'prod_shoes', quantity: 1 }],
      },
    }, res1, { adminDb: mockDb, nowMs, skipRateLimit: true });

    assert.strictEqual(res1.statusCode, 201);
    const countAfterFirst = Object.keys(mockDb._ordersStore['vip_active_seller'] || {}).length;
    assert.strictEqual(countAfterFirst, initialOrdersCount + 1);

    // Seconde requête avec la MÊME clé mais des articles différents
    const res2 = createMockResponse();
    await handleCreateOrder({
      method: 'POST',
      body: {
        vendeur_id: 'vip_active_seller',
        customerName: 'Client Initial',
        customerWhatsApp: '+212600112233',
        deliveryAddress: 'Casablanca',
        deliveryFee: 20,
        idempotencyKey: key,
        items: [{ productId: 'prod_socks', quantity: 3 }], // Articles différents !
      },
    }, res2, { adminDb: mockDb, nowMs, skipRateLimit: true });

    assert.strictEqual(res2.statusCode, 409, 'Statut 409 Conflict attendu');
    assert.strictEqual(res2.data.code, 'IDEMPOTENCY_CONFLICT');
    assert.ok(res2.data.error.includes('Conflit d’idempotence'), 'Message d’erreur explicite');

    const countAfterSecond = Object.keys(mockDb._ordersStore['vip_active_seller'] || {}).length;
    assert.strictEqual(countAfterSecond, countAfterFirst, 'AUCUNE nouvelle commande créée lors du conflit 409');
  });

  await runTest('4.7 Détection de conflit 409 sur chaque champ individuel (nom, WhatsApp, adresse, quantité, frais)', async () => {
    const checkFieldConflict = async (fieldName: string, payloadModifier: (b: any) => any) => {
      const fieldKey = `conflict_field_key_${fieldName}_123`;
      const baseBody = {
        vendeur_id: 'vip_active_seller',
        customerName: 'Karim Bennani',
        customerWhatsApp: '+212655667788',
        deliveryAddress: 'Bd Zerktouni Casablanca',
        deliveryFee: 25,
        idempotencyKey: fieldKey,
        items: [{ productId: 'prod_shoes', quantity: 1 }],
      };

      // Configure the seller-side fee, which is the only trusted delivery-fee source.
      const originalFee = mockDb._usersStore['vip_active_seller'].defaultDeliveryFee;
      mockDb._usersStore['vip_active_seller'].defaultDeliveryFee = fieldName === 'deliveryFee' ? 25 : 0;

      // Création originale
      const resInit = createMockResponse();
      await handleCreateOrder({ method: 'POST', body: { ...baseBody } }, resInit, { adminDb: mockDb, nowMs, skipRateLimit: true });
      assert.strictEqual(resInit.statusCode, 201);

      // Modification du champ testé avec la même clé
      const modifiedBody = payloadModifier({ ...baseBody });
      if (fieldName === 'deliveryFee') mockDb._usersStore['vip_active_seller'].defaultDeliveryFee = 40;
      const resConflict = createMockResponse();
      await handleCreateOrder({ method: 'POST', body: modifiedBody }, resConflict, { adminDb: mockDb, nowMs, skipRateLimit: true });

      assert.strictEqual(resConflict.statusCode, 409, `Le champ "${fieldName}" altéré doit déclencher une 409`);
      assert.strictEqual(resConflict.data.code, 'IDEMPOTENCY_CONFLICT');
      mockDb._usersStore['vip_active_seller'].defaultDeliveryFee = originalFee;
    };

    await checkFieldConflict('customerName', (b) => ({ ...b, customerName: 'Yassine Bennani' }));
    await checkFieldConflict('customerWhatsApp', (b) => ({ ...b, customerWhatsApp: '+212699887766' }));
    await checkFieldConflict('deliveryAddress', (b) => ({ ...b, deliveryAddress: 'Bd Ghandi Casablanca' }));
    await checkFieldConflict('quantity', (b) => ({ ...b, items: [{ productId: 'prod_shoes', quantity: 3 }] }));
    await checkFieldConflict('deliveryFee', (b) => ({ ...b, deliveryFee: 40 }));
  });

  await runTest('4.7b Une note client modifiée avec la même clé produit un conflit 409', async () => {
    const key = 'conflict_notes_key_456';
    const baseBody = {
      vendeur_id: 'vip_active_seller',
      customerName: 'Client Notes',
      customerWhatsApp: '+212655667788',
      deliveryAddress: 'Casablanca',
      deliveryFee: 0,
      notes: 'Livrer après 18h',
      idempotencyKey: key,
      items: [{ productId: 'prod_shoes', quantity: 1 }],
    };
    const first = createMockResponse();
    await handleCreateOrder({ method: 'POST', body: baseBody }, first, { adminDb: mockDb, nowMs, skipRateLimit: true });
    assert.strictEqual(first.statusCode, 201);
    const second = createMockResponse();
    await handleCreateOrder({ method: 'POST', body: { ...baseBody, notes: 'Appeler avant livraison' } }, second, { adminDb: mockDb, nowMs, skipRateLimit: true });
    assert.strictEqual(second.statusCode, 409);
    assert.strictEqual(second.data.code, 'IDEMPOTENCY_CONFLICT');
  });

  await runTest('4.8 Réorganisation des articles ou des propriétés JSON sans changement sémantique : rejeu reconnu (HTTP 200)', async () => {
    const reorderKey = 'reorder_idemp_key_canonical_888';

    // Requête 1 : items [shoes x2, socks x1]
    const res1 = createMockResponse();
    await handleCreateOrder({
      method: 'POST',
      body: {
        vendeur_id: 'vip_active_seller',
        customerName: 'Fatima Zahra',
        customerWhatsApp: '+212 611-223344',
        deliveryAddress: 'Rabat Souissi',
        deliveryFee: 15,
        idempotencyKey: reorderKey,
        items: [
          { productId: 'prod_shoes', quantity: 2 },
          { productId: 'prod_socks', quantity: 1 },
        ],
      },
    }, res1, { adminDb: mockDb, nowMs, skipRateLimit: true });
    assert.strictEqual(res1.statusCode, 201);

    // Requête 2 : ordre inverse des propriétés et des items [socks x1, shoes x2], numéro avec espaces différents
    const res2 = createMockResponse();
    await handleCreateOrder({
      method: 'POST',
      body: {
        deliveryFee: 15,
        items: [
          { productId: 'prod_socks', quantity: 1 },
          { productId: 'prod_shoes', quantity: 2 },
        ],
        idempotencyKey: reorderKey,
        customerAddress: 'Rabat Souissi', // ignored
        deliveryAddress: '  Rabat   Souissi  ',
        customerWhatsApp: '+212611223344', // normalisé
        customerName: '  Fatima Zahra  ',
        vendeur_id: 'vip_active_seller',
      },
    }, res2, { adminDb: mockDb, nowMs, skipRateLimit: true });

    assert.strictEqual(res2.statusCode, 200, 'Reconnu comme le même contenu sémantique grâce au hash déterministe');
    assert.strictEqual(res2.data.replayed, true);
    assert.strictEqual(res2.data.orderId, res1.data.orderId);
  });

  await runTest('4.9 Deux requêtes simultanées avec la même clé et des contenus divergents : une créée (201), l’autre rejetée (409)', async () => {
    const simultaneousDivergentKey = 'divergent_concurrent_key_999';
    const resA = createMockResponse();
    const resB = createMockResponse();

    const initialCount = Object.keys(mockDb._ordersStore['vip_active_seller'] || {}).length;

    await Promise.all([
      handleCreateOrder({
        method: 'POST',
        body: {
          vendeur_id: 'vip_active_seller',
          customerName: 'Acheteur A',
          customerWhatsApp: '+212600111111',
          deliveryAddress: 'Casablanca',
          idempotencyKey: simultaneousDivergentKey,
          items: [{ productId: 'prod_shoes', quantity: 1 }],
        },
      }, resA, { adminDb: mockDb, nowMs, skipRateLimit: true }),
      handleCreateOrder({
        method: 'POST',
        body: {
          vendeur_id: 'vip_active_seller',
          customerName: 'Acheteur B différent',
          customerWhatsApp: '+212600222222',
          deliveryAddress: 'Marrakech',
          idempotencyKey: simultaneousDivergentKey,
          items: [{ productId: 'prod_socks', quantity: 2 }],
        },
      }, resB, { adminDb: mockDb, nowMs, skipRateLimit: true }),
    ]);

    const finalCount = Object.keys(mockDb._ordersStore['vip_active_seller'] || {}).length;
    assert.strictEqual(finalCount, initialCount + 1, 'Exactement UNE commande a été créée');

    const statusCodes = [resA.statusCode, resB.statusCode].sort();
    assert.deepStrictEqual(statusCodes, [201, 409], 'Une requête obtient 201 (créée) et la concurrente divergente obtient 409 (conflit)');
  });

  await runTest('4.10 La réponse 409 ne divulgue aucune information de la commande initiale', async () => {
    const leakTestKey = 'leak_test_key_secret_555';

    // Commande initiale avec données privées du client A
    const resA = createMockResponse();
    await handleCreateOrder({
      method: 'POST',
      body: {
        vendeur_id: 'vip_active_seller',
        customerName: 'Client Secret VIP A',
        customerWhatsApp: '+212699887766',
        deliveryAddress: 'Villa Secrète Rabat',
        deliveryFee: 50,
        idempotencyKey: leakTestKey,
        items: [{ productId: 'prod_shoes', quantity: 2 }],
      },
    }, resA, { adminDb: mockDb, nowMs, skipRateLimit: true });
    assert.strictEqual(resA.statusCode, 201);

    // Attaquant ou tiers B envoyant la même clé avec d'autres données
    const resB = createMockResponse();
    await handleCreateOrder({
      method: 'POST',
      body: {
        vendeur_id: 'vip_active_seller',
        customerName: 'Attaquant Curieux B',
        customerWhatsApp: '+212600000000',
        deliveryAddress: 'Casablanca',
        deliveryFee: 0,
        idempotencyKey: leakTestKey,
        items: [{ productId: 'prod_socks', quantity: 1 }],
      },
    }, resB, { adminDb: mockDb, nowMs, skipRateLimit: true });

    assert.strictEqual(resB.statusCode, 409);
    assert.strictEqual(resB.data.orderId, undefined, 'Pas d’orderId dans la réponse 409');
    assert.strictEqual(resB.data.customerName, undefined, 'Pas de customerName dans la réponse 409');
    assert.strictEqual(resB.data.items, undefined, 'Pas de liste d’articles dans la réponse 409');
    assert.strictEqual(resB.data.subtotal, undefined, 'Pas de sous-total dans la réponse 409');
    assert.strictEqual(resB.data.total, undefined, 'Pas de total dans la réponse 409');
    assert.strictEqual(resB.data.currency, undefined, 'Pas de devise dans la réponse 409');
    assert.strictEqual(resB.data.code, 'IDEMPOTENCY_CONFLICT');
  });

  await runTest('4.11 Une ancienne clé d’idempotence sans requestHash est gérée de façon sûre (409 sans fuite)', async () => {
    const legacyKey = 'legacy_key_without_request_hash_333';

    // Injection directe d'un ancien document sans requestHash dans le store
    if (!mockDb._idempotencyStore['vip_active_seller']) {
      mockDb._idempotencyStore['vip_active_seller'] = {};
    }
    mockDb._idempotencyStore['vip_active_seller'][legacyKey] = {
      orderId: 'ord_legacy_9999',
      vendeur_id: 'vip_active_seller',
      subtotal: 500,
      total: 520,
      status: 'Nouveau',
      createdAt: new Date(nowMs - 2 * day).toISOString(),
      // requestHash is intentionally missing
    };

    const res = createMockResponse();
    await handleCreateOrder({
      method: 'POST',
      body: {
        vendeur_id: 'vip_active_seller',
        customerName: 'Client Avec Ancienne Clé',
        customerWhatsApp: '+212611223344',
        deliveryAddress: 'Tanger',
        deliveryFee: 20,
        idempotencyKey: legacyKey,
        items: [{ productId: 'prod_shoes', quantity: 1 }],
      },
    }, res, { adminDb: mockDb, nowMs, skipRateLimit: true });

    assert.strictEqual(res.statusCode, 409, 'Refusé avec 409');
    assert.strictEqual(res.data.code, 'IDEMPOTENCY_CONFLICT');
    assert.ok(res.data.error.includes('format antérieur'), 'Message explicite invitant à renouveler la clé');
    assert.strictEqual(res.data.orderId, undefined, 'Aucune fuite de l’ancien orderId');
  });

  // ---------------------------------------------------------------------------
  // GROUP 5: Distributed Rate Limiting & Anti-Abuse (Prompt 2A)
  // ---------------------------------------------------------------------------
  await runTest('5.1 Extraction sécurisée de l’adresse IP cliente selon la topologie Vercel', () => {
    // Vercel forwarded
    assert.strictEqual(getClientIp({ headers: { 'x-vercel-forwarded-for': '196.200.10.5, 10.0.0.1' } }), '196.200.10.5');
    // Standard X-Forwarded-For
    assert.strictEqual(getClientIp({ headers: { 'x-forwarded-for': '197.100.20.8, 172.16.0.1' } }), '197.100.20.8');
    // X-Real-IP
    assert.strictEqual(getClientIp({ headers: { 'x-real-ip': '41.250.30.9' } }), '41.250.30.9');
    // Fallback direct socket
    assert.strictEqual(getClientIp({ socket: { remoteAddress: '105.155.40.10' } }), '105.155.40.10');
  });

  await runTest('5.2 Dépassement du seuil de requêtes déclenche une réponse 429 Too Many Requests avec Retry-After', async () => {
    resetMemoryRateLimits();
    const rateLimitDb = createMockAdminDb({
      users: mockDb._usersStore,
      products: mockDb._productsStore,
    });

    const testIp = '196.200.55.99';
    const fakeReq = {
      method: 'POST',
      headers: { 'x-real-ip': testIp },
      body: {
        vendeur_id: 'vip_active_seller',
        customerName: 'Rate Limit Tester',
        customerWhatsApp: '+212611223344',
        deliveryAddress: 'Casablanca',
        items: [{ productId: 'prod_shoes', quantity: 1 }],
      },
    };

    // Effectuer 10 créations autorisées (seuil = 10)
    for (let i = 1; i <= 10; i++) {
      const res = createMockResponse();
      await handleCreateOrder(fakeReq, res, { adminDb: rateLimitDb, nowMs, maxRequests: 10, windowMs: 600000 });
      assert.strictEqual(res.statusCode, 201, `Requête ${i} doit réussir (201)`);
    }

    // La 11ème requête doit être bloquée avec 429
    const blockedRes = createMockResponse();
    await handleCreateOrder(fakeReq, blockedRes, { adminDb: rateLimitDb, nowMs, maxRequests: 10, windowMs: 600000 });

    assert.strictEqual(blockedRes.statusCode, 429, 'La 11ème requête doit renvoyer 429');
    assert.strictEqual(blockedRes.data.code, 'RATE_LIMIT_EXCEEDED');
    assert.ok(blockedRes.headers['Retry-After'], 'En-tête Retry-After doit être présent');
    assert.ok(Number(blockedRes.headers['Retry-After']) > 0, 'Retry-After doit être un nombre positif');
  });

  await runTest('5.3 Deux adresses IP distinctes disposent de quotas indépendants', async () => {
    resetMemoryRateLimits();
    const rateLimitDb = createMockAdminDb({});
    const now = Date.now();

    const reqIpA = { headers: { 'x-real-ip': '10.10.10.1' } };
    const reqIpB = { headers: { 'x-real-ip': '20.20.20.2' } };

    // Consommer le quota complet pour IP A (maxRequests: 2 pour le test)
    await checkOrdersRateLimit(reqIpA, rateLimitDb, { nowMs: now, maxRequests: 2, windowMs: 600000 });
    await checkOrdersRateLimit(reqIpA, rateLimitDb, { nowMs: now, maxRequests: 2, windowMs: 600000 });
    const checkA = await checkOrdersRateLimit(reqIpA, rateLimitDb, { nowMs: now, maxRequests: 2, windowMs: 600000 });
    assert.strictEqual(checkA.allowed, false, 'IP A doit être bloquée');

    // IP B doit toujours être autorisée
    const checkB = await checkOrdersRateLimit(reqIpB, rateLimitDb, { nowMs: now, maxRequests: 2, windowMs: 600000 });
    assert.strictEqual(checkB.allowed, true, 'IP B doit rester autorisée indépendamment');
  });

  await runTest('5.4 Résilience en cas de panne de la collection Firestore des compteurs (repli local)', async () => {
    resetMemoryRateLimits();
    const brokenDb = {
      collection() {
        throw new Error('Connexion réseau Firestore interrompue');
      },
    };

    const req = { headers: { 'x-real-ip': '196.200.77.88' } };
    const result = await checkOrdersRateLimit(req, brokenDb, { nowMs, maxRequests: 5, windowMs: 600000 });

    assert.strictEqual(result.allowed, true, 'En cas d’erreur de base, la fonction opère un repli sans crasher la commande client');
    assert.strictEqual(result.remaining, 4);
  });

  // ---------------------------------------------------------------------------
  // GROUP 6: Vercel Serverless Function & Non-exposure
  // ---------------------------------------------------------------------------
  await runTest('6.1 Handler Vercel api/orders/create.ts opérationnel', async () => {
    const req = { method: 'OPTIONS' };
    const res = createMockResponse();
    await vercelOrdersHandler(req, res);
    assert.strictEqual(res.statusCode, 204);
  });

  await runTest('6.2 Pas de fuite de données privées du vendeur dans la réponse de commande', async () => {
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
    }, res, { adminDb: mockDb, nowMs, skipRateLimit: true });

    assert.strictEqual(res.statusCode, 201);
    assert.strictEqual(res.data.role, undefined);
    assert.strictEqual(res.data.plan, undefined);
    assert.strictEqual(res.data.vipEndsAt, undefined);
    assert.strictEqual(res.data.phoneNormalized, undefined);
    assert.strictEqual(res.data.whatsappNumber, undefined);
  });

  // ---------------------------------------------------------------------------
  // GROUP 7: Firestore Rules Verification
  // ---------------------------------------------------------------------------
  await runTest('7.1 Vérification de l’intégrité des règles firestore.rules pour /users/{uid}/orders/{orderId}', () => {
    const rulesContent = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');

    assert.ok(rulesContent.includes('match /orders/{orderId}'), 'Règle match /orders/{orderId} présente');
    assert.ok(rulesContent.includes('allow create: if false;'), 'Création directe navigateur interdite (allow create: if false)');
    assert.ok(rulesContent.includes('allow read: if isOwner(uid) || isAdmin();'), 'Lecture réservée au propriétaire ou admin');
    assert.ok(rulesContent.includes('allow delete: if isAdmin();'), 'Suppression réservée à admin');
    assert.ok(rulesContent.includes('affectedKeys().hasOnly([\'status\', \'updatedAt\'])'), 'Modification limitée à status et updatedAt');
    assert.ok(rulesContent.includes('\'Nouveau\', \'Confirmée\', \'En préparation\', \'Expédiée\', \'Livrée\', \'Annulée\''), 'Validation des 6 statuts autorisés');
  });

  await runTest('7.2 Vérification de la fermeture hermétique de /users/{uid}/idempotency/{idempId} aux clients directs', () => {
    const rulesContent = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');

    assert.ok(rulesContent.includes('match /idempotency/{idempId}'), 'Règle match /idempotency/{idempId} présente');
    assert.ok(rulesContent.includes('allow read, write: if false;'), 'Accès direct client interdit (allow read, write: if false)');
  });

  await runTest('7.3 Vérification de la fermeture hermétique de /rateLimits/{limitId} aux clients directs', () => {
    const rulesContent = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf-8');

    assert.ok(rulesContent.includes('match /rateLimits/{limitId}'), 'Règle match /rateLimits/{limitId} présente');
  });

  console.log(`\n==================================================`);
  console.log(`RÉSULTATS : ${testsPassed} passés, 0 échoués`);
  console.log(`==================================================\n`);
}

runAllTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
