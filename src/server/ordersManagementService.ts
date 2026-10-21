import { getAdminDb } from './firebaseAdmin.ts';
import { verifyFirebaseUserDetails } from './cloudinarySign.ts';
import { computeVendorEntitlements } from './entitlementsService.ts';
import { OrderStatus, StructuredOrder } from '../types.ts';

const ALLOWED_STATUSES: OrderStatus[] = ['Nouveau', 'Confirmée', 'En préparation', 'Expédiée', 'Livrée', 'Annulée'];
const ADMIN_EMAIL = 'foosco80@gmail.com';

function sendJson(res: any, status: number, payload: any) {
  if (typeof res.setHeader === 'function') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Type', 'application/json');
  }
  if (typeof res.status === 'function' && typeof res.json === 'function') return res.status(status).json(payload);
  res.statusCode = status;
  return res.end(JSON.stringify(payload));
}

async function authenticate(req: any): Promise<{ uid: string; email: string } | null> {
  const authorization = String(req.headers?.authorization || '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try {
    return await verifyFirebaseUserDetails(match[1]);
  } catch {
    return null;
  }
}

async function authorizeVipVendor(uid: string): Promise<{ allowed: true } | { allowed: false; status: number; error: string; code: string }> {
  const adminDb = getAdminDb();
  const userSnap = await adminDb.collection('users').doc(uid).get();
  if (!userSnap.exists) return { allowed: false, status: 404, error: 'Boutique introuvable.', code: 'VENDOR_NOT_FOUND' };
  const entitlements = computeVendorEntitlements(userSnap.data() || {}, Date.now());
  if (entitlements.reason === 'suspended') return { allowed: false, status: 403, error: 'Cette boutique est inactive ou suspendue.', code: 'VENDOR_SUSPENDED' };
  if (entitlements.reason === 'vip_expired') return { allowed: false, status: 403, error: 'L’abonnement VIP est expiré.', code: 'VIP_EXPIRED' };
  if (entitlements.reason !== 'vip_active') return { allowed: false, status: 403, error: 'La gestion des commandes est réservée aux abonnements VIP actifs.', code: 'VIP_REQUIRED' };
  return { allowed: true };
}

async function resolveTargetVendor(req: any, identity: { uid: string; email: string }): Promise<string | null> {
  const requested = String(req.query?.vendeurId || req.body?.vendeur_id || identity.uid).trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(requested)) return null;
  const isAdmin = identity.email.trim().toLowerCase() === ADMIN_EMAIL;
  if (!isAdmin && requested !== identity.uid) return null;
  return requested;
}

function normalizeOrder(docSnap: any, uid: string): StructuredOrder {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    vendeur_id: uid,
    customerName: String(data.customerName || ''),
    customerWhatsApp: String(data.customerWhatsApp || ''),
    deliveryAddress: String(data.deliveryAddress || ''),
    items: Array.isArray(data.items) ? data.items : [],
    subtotal: Number(data.subtotal || 0),
    deliveryFee: Number(data.deliveryFee || 0),
    total: Number(data.total || 0),
    currency: data.currency === 'MAD' ? 'MAD' : 'CFA',
    status: ALLOWED_STATUSES.includes(data.status) ? data.status : 'Nouveau',
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
    notes: typeof data.notes === 'string' ? data.notes : undefined,
  };
}

export async function handleListOrders(req: any, res: any) {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Méthode non autorisée.', code: 'METHOD_NOT_ALLOWED' });

  const identity = await authenticate(req);
  if (!identity) return sendJson(res, 401, { error: 'Connexion requise.', code: 'UNAUTHENTICATED' });
  const uid = await resolveTargetVendor(req, identity);
  if (!uid) return sendJson(res, 403, { error: 'Accès refusé à cette boutique.', code: 'FORBIDDEN' });

  try {
    const access = await authorizeVipVendor(uid);
    if (!access.allowed) return sendJson(res, access.status, { error: access.error, code: access.code });
    const snap = await getAdminDb().collection('users').doc(uid).collection('orders').get();
    const orders = snap.docs.map((docSnap: any) => normalizeOrder(docSnap, uid))
      .sort((a: StructuredOrder, b: StructuredOrder) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
    return sendJson(res, 200, { success: true, orders });
  } catch (error: any) {
    console.error('[OrdersManagement] List failed:', error?.message || error);
    return sendJson(res, 503, { error: 'Impossible de charger les commandes pour le moment.', code: 'SERVICE_UNAVAILABLE' });
  }
}

export async function handleUpdateOrderStatus(req: any, res: any) {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  if (req.method !== 'POST' && req.method !== 'PATCH') return sendJson(res, 405, { error: 'Méthode non autorisée.', code: 'METHOD_NOT_ALLOWED' });

  const identity = await authenticate(req);
  if (!identity) return sendJson(res, 401, { error: 'Connexion requise.', code: 'UNAUTHENTICATED' });
  const uid = await resolveTargetVendor(req, identity);
  if (!uid) return sendJson(res, 403, { error: 'Accès refusé à cette boutique.', code: 'FORBIDDEN' });

  const orderId = typeof req.body?.orderId === 'string' ? req.body.orderId.trim() : '';
  const status = req.body?.status as OrderStatus;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(orderId) || !ALLOWED_STATUSES.includes(status)) {
    return sendJson(res, 400, { error: 'Référence ou statut de commande invalide.', code: 'INVALID_INPUT' });
  }

  try {
    const access = await authorizeVipVendor(uid);
    if (!access.allowed) return sendJson(res, access.status, { error: access.error, code: access.code });
    const orderRef = getAdminDb().collection('users').doc(uid).collection('orders').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return sendJson(res, 404, { error: 'Commande introuvable.', code: 'ORDER_NOT_FOUND' });
    await orderRef.update({ status, updatedAt: new Date().toISOString() });
    return sendJson(res, 200, { success: true, orderId, status });
  } catch (error: any) {
    console.error('[OrdersManagement] Status update failed:', error?.message || error);
    return sendJson(res, 503, { error: 'Impossible de mettre à jour la commande pour le moment.', code: 'SERVICE_UNAVAILABLE' });
  }
}
