import assert from 'node:assert/strict';
import { handleListOrders, handleUpdateOrderStatus } from '../src/server/ordersManagementService.ts';

type StoredOrder = Record<string, any>;

function createMockDb() {
  const users: Record<string, any> = {
    vip_seller_123: { status: 'VIP', plan: 'VIP', currency: 'MAD' },
    trial_seller_123: { status: 'Actif', plan: 'Essai', trialStartedAt: new Date(Date.now() - 60_000).toISOString() },
    expired_vip_123: { status: 'VIP', plan: 'VIP', vipEndsAt: new Date(Date.now() - 60_000).toISOString() },
  };
  const orders: Record<string, Record<string, StoredOrder>> = {
    vip_seller_123: {
      order_123: {
        customerName: 'Client Test',
        customerWhatsApp: '+212600000000',
        deliveryAddress: 'Casablanca',
        items: [{ productId: 'p1', name: 'Produit', price: 100, quantity: 2, total: 200 }],
        subtotal: 200,
        deliveryFee: 20,
        total: 220,
        currency: 'MAD',
        status: 'Nouveau',
        createdAt: new Date('2026-10-20T10:00:00.000Z').toISOString(),
        updatedAt: new Date('2026-10-20T10:00:00.000Z').toISOString(),
      },
    },
  };

  const db: any = {
    collection(name: string) {
      if (name !== 'users') throw new Error('Unexpected top-level collection');
      return {
        doc(uid: string) {
          return {
            async get() {
              const data = users[uid];
              return { exists: Boolean(data), data: () => data };
            },
            collection(sub: string) {
              if (sub !== 'orders') throw new Error('Unexpected sub-collection');
              return {
                async get() {
                  const docs = Object.entries(orders[uid] || {}).map(([id, data]) => ({ id, data: () => data }));
                  return { docs };
                },
                doc(orderId: string) {
                  return {
                    async get() {
                      const data = orders[uid]?.[orderId];
                      return { exists: Boolean(data), data: () => data };
                    },
                    async update(patch: Record<string, any>) {
                      const existing = orders[uid]?.[orderId];
                      if (!existing) throw new Error('Missing order');
                      Object.assign(existing, patch);
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  return { db, users, orders };
}

function response() {
  return {
    statusCode: 200,
    data: null as any,
    headers: {} as Record<string, string>,
    setHeader(key: string, value: string) { this.headers[key] = value; },
    status(code: number) { this.statusCode = code; return this; },
    json(payload: any) { this.data = payload; return this; },
  };
}

async function main() {
  const { db, orders } = createMockDb();
  const identity = async (token: string) => {
    if (token === 'seller-token') return { uid: 'vip_seller_123', email: 'seller@example.com' };
    if (token === 'other-token') return { uid: 'other_seller_123', email: 'other@example.com' };
    if (token === 'admin-token') return { uid: 'admin_uid', email: 'foosco80@gmail.com' };
    if (token === 'trial-token') return { uid: 'trial_seller_123', email: 'trial@example.com' };
    if (token === 'expired-token') return { uid: 'expired_vip_123', email: 'expired@example.com' };
    throw new Error('Invalid token');
  };

  let res = response();
  await handleListOrders({ method: 'GET', headers: { authorization: 'Bearer seller-token' }, query: { vendeur_id: 'vip_seller_123' } }, res, { adminDb: db, verifyIdentity: identity });
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.orders.length, 1);
  assert.equal(res.data.orders[0].id, 'order_123');
  assert.equal(res.data.orders[0].customerName, 'Client Test');

  res = response();
  await handleListOrders({ method: 'GET', headers: {}, query: { vendeur_id: 'vip_seller_123' } }, res, { adminDb: db, verifyIdentity: identity });
  assert.equal(res.statusCode, 401);
  assert.equal(res.data.code, 'AUTH_TOKEN_MISSING');

  res = response();
  await handleListOrders({ method: 'GET', headers: { authorization: 'Bearer other-token' }, query: { vendeur_id: 'vip_seller_123' } }, res, { adminDb: db, verifyIdentity: identity });
  assert.equal(res.statusCode, 403);
  assert.equal(res.data.code, 'VENDOR_SCOPE_FORBIDDEN');

  res = response();
  await handleListOrders({ method: 'GET', headers: { authorization: 'Bearer trial-token' }, query: { vendeur_id: 'trial_seller_123' } }, res, { adminDb: db, verifyIdentity: identity });
  assert.equal(res.statusCode, 403);
  assert.equal(res.data.code, 'VIP_REQUIRED');

  res = response();
  await handleListOrders({ method: 'GET', headers: { authorization: 'Bearer expired-token' }, query: { vendeur_id: 'expired_vip_123' } }, res, { adminDb: db, verifyIdentity: identity });
  assert.equal(res.statusCode, 403);
  assert.equal(res.data.code, 'VIP_EXPIRED');

  res = response();
  await handleListOrders({ method: 'GET', headers: { authorization: 'Bearer admin-token' }, query: { vendeur_id: 'vip_seller_123' } }, res, { adminDb: db, verifyIdentity: identity });
  assert.equal(res.statusCode, 200, 'Authorized admin can inspect a VIP seller');

  res = response();
  await handleUpdateOrderStatus({ method: 'POST', headers: { authorization: 'Bearer seller-token' }, body: { vendeur_id: 'vip_seller_123', orderId: 'order_123', status: 'Confirmée' } }, res, { adminDb: db, verifyIdentity: identity, nowMs: Date.parse('2026-10-21T12:00:00.000Z') });
  assert.equal(res.statusCode, 200);
  assert.equal(res.data.status, 'Confirmée');
  assert.equal(orders.vip_seller_123.order_123.status, 'Confirmée');
  assert.equal(orders.vip_seller_123.order_123.updatedAt, '2026-10-21T12:00:00.000Z');

  res = response();
  await handleUpdateOrderStatus({ method: 'POST', headers: { authorization: 'Bearer seller-token' }, body: { vendeur_id: 'vip_seller_123', orderId: 'order_123', status: 'Hacked' } }, res, { adminDb: db, verifyIdentity: identity });
  assert.equal(res.statusCode, 400);
  assert.equal(res.data.code, 'INVALID_ORDER_STATUS');

  res = response();
  await handleUpdateOrderStatus({ method: 'POST', headers: { authorization: 'Bearer seller-token' }, body: { vendeur_id: 'vip_seller_123', orderId: 'missing_order', status: 'Livrée' } }, res, { adminDb: db, verifyIdentity: identity });
  assert.equal(res.statusCode, 404);
  assert.equal(res.data.code, 'ORDER_NOT_FOUND');

  res = response();
  await handleUpdateOrderStatus({ method: 'POST', headers: { authorization: 'Bearer expired-token' }, body: { vendeur_id: 'expired_vip_123', orderId: 'order_123', status: 'Livrée' } }, res, { adminDb: db, verifyIdentity: identity });
  assert.equal(res.statusCode, 403);
  assert.equal(res.data.code, 'VIP_EXPIRED');

  console.log('Orders management API tests: 10 passed, 0 failed.');
}

main().catch((error) => {
  console.error('Orders management API tests failed:', error);
  process.exit(1);
});
