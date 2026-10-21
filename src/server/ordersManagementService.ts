import { getAdminDb } from './firebaseAdmin.ts';
import { computeVendorEntitlements } from './entitlementsService.ts';
import { verifyFirebaseUserDetails } from './cloudinarySign.ts';
import { OrderStatus } from '../types.ts';

const ADMIN_EMAIL = 'foosco80@gmail.com';
const ALLOWED_STATUSES: OrderStatus[] = ['Nouveau', 'Confirmée', 'En préparation', 'Expédiée', 'Livrée', 'Annulée'];

export interface OrdersManagementOptions {
  adminDb?: any;
  verifyIdentity?: (token: string) => Promise<{ uid: string; email: string }>;
  nowMs?: number;
}

function sendJson(res: any, status: number, payload: any) {
  if (typeof res.setHeader === 'function') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (typeof res.status === 'function' && typeof res.json === 'function') return res.status(status).json(payload);
  res.statusCode = status;
  if (typeof res.setHeader === 'function') res.setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(payload));
}

function getBearerToken(req: any): string {
  const value = String(req?.headers?.authorization || '');
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function getRequestedVendorId(req: any, body?: any): string {
  const fromQuery = req?.query?.vendeur_id || req?.query?.vendorId;
  const fromUrl = typeof req?.url === 'string' ? new URL(req.url, 'http://localhost').searchParams.get('vendeur_id') : '';
  const raw = body?.vendeur_id || body?.vendorId || fromQuery || fromUrl || '';
  return typeof raw === 'string' ? raw.trim() : '';
}

async function authorizeVendor(
  req: any,
  vendorId: string,
  options?: OrdersManagementOptions
): Promise<{ uid: string; email: string; vendor: Record<string, any>; adminDb: any } | { error: { status: number; code: string; message: string } }> {
  const token = getBearerToken(req);
  if (!token) return { error: { status: 401, code: 'AUTH_TOKEN_MISSING', message: 'Connexion requise pour gérer les commandes.' } };
  if (!vendorId || vendorId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(vendorId)) {
    return { error: { status: 400, code: 'INVALID_VENDOR_ID', message: 'Identifiant de boutique invalide.' } };
  }

  let identity: { uid: string; email: string };
  try {
    identity = await (options?.verifyIdentity || verifyFirebaseUserDetails)(token);
  } catch {
    return { error: { status: 401, code: 'AUTH_TOKEN_INVALID', message: 'Session invalide ou expirée. Reconnectez-vous.' } };
  }

  const isAdmin = identity.email.trim().toLowerCase() === ADMIN_EMAIL;
  if (!isAdmin && identity.uid !== vendorId) {
    return { error: { status: 403, code: 'VENDOR_SCOPE_FORBIDDEN', message: 'Vous ne pouvez consulter ou modifier que les commandes de votre propre boutique.' } };
  }

  let adminDb = options?.adminDb;
  if (!adminDb) {
    try {
      adminDb = getAdminDb();
    } catch {
      return { error: { status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Le service de commandes est temporairement indisponible.' } };
    }
  }

  try {
    const userSnap = await adminDb.collection('users').doc(vendorId).get();
    if (!userSnap?.exists) {
      return { error: { status: 404, code: 'VENDOR_NOT_FOUND', message: 'Boutique introuvable.' } };
    }
    const vendor = userSnap.data() || {};
    const nowMs = options?.nowMs ?? Date.now();
    const entitlements = computeVendorEntitlements(vendor, nowMs);
    if (entitlements.reason === 'suspended') {
      return { error: { status: 403, code: 'VENDOR_SUSPENDED', message: 'Cette boutique est suspendue ou inactive.' } };
    }
    if (entitlements.reason !== 'vip_active') {
      return { error: { status: 403, code: entitlements.reason === 'vip_expired' ? 'VIP_EXPIRED' : 'VIP_REQUIRED', message: 'La gestion des commandes structurées nécessite un abonnement VIP actif.' } };
    }
    return { uid: identity.uid, email: identity.email, vendor, adminDb };
  } catch (error) {
    console.error('[OrdersManagement] Vendor authorization lookup failed:', error);
    return { error: { status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Impossible de vérifier les droits de cette boutique pour le moment.' } };
  }
}

function toIso(value: any): string {
  if (!value) return '';
  try {
    const date = value instanceof Date ? value : typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : '';
  } catch {
    return '';
  }
}

export async function handleListOrders(req: any, res: any, options?: OrdersManagementOptions) {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Seule la méthode GET est acceptée.', code: 'METHOD_NOT_ALLOWED' });

  const vendorId = getRequestedVendorId(req);
  const authorization = await authorizeVendor(req, vendorId, options);
  if ('error' in authorization) return sendJson(res, authorization.error.status, { error: authorization.error.message, code: authorization.error.code });

  try {
    const snapshot = await authorization.adminDb.collection('users').doc(vendorId).collection('orders').get();
    const orders = snapshot.docs.map((orderDoc: any) => {
      const data = orderDoc.data() || {};
      return {
        id: orderDoc.id,
        vendeur_id: vendorId,
        customerName: String(data.customerName || ''),
        customerWhatsApp: String(data.customerWhatsApp || ''),
        deliveryAddress: String(data.deliveryAddress || ''),
        items: Array.isArray(data.items) ? data.items : [],
        subtotal: Number(data.subtotal) || 0,
        deliveryFee: Number(data.deliveryFee) || 0,
        total: Number(data.total) || 0,
        currency: data.currency === 'MAD' ? 'MAD' : 'CFA',
        status: ALLOWED_STATUSES.includes(data.status) ? data.status : 'Nouveau',
        createdAt: toIso(data.createdAt),
        updatedAt: toIso(data.updatedAt),
        notes: typeof data.notes === 'string' ? data.notes : '',
      };
    });
    orders.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return sendJson(res, 200, { success: true, orders: orders.slice(0, 250), hasMore: orders.length > 250 });
  } catch (error) {
    console.error('[OrdersManagement] Failed to list orders:', error);
    return sendJson(res, 500, { error: 'Impossible de charger les commandes pour le moment.', code: 'ORDERS_LIST_FAILED' });
  }
}

export async function handleUpdateOrderStatus(req: any, res: any, options?: OrdersManagementOptions) {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {});
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Seule la méthode POST est acceptée.', code: 'METHOD_NOT_ALLOWED' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const vendorId = getRequestedVendorId(req, body);
  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
  const status = body.status as OrderStatus;

  if (!orderId || orderId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(orderId)) {
    return sendJson(res, 400, { error: 'Identifiant de commande invalide.', code: 'INVALID_ORDER_ID' });
  }
  if (!ALLOWED_STATUSES.includes(status)) {
    return sendJson(res, 400, { error: 'Statut de commande invalide.', code: 'INVALID_ORDER_STATUS' });
  }

  const authorization = await authorizeVendor(req, vendorId, options);
  if ('error' in authorization) return sendJson(res, authorization.error.status, { error: authorization.error.message, code: authorization.error.code });

  try {
    const orderRef = authorization.adminDb.collection('users').doc(vendorId).collection('orders').doc(orderId);
    const nowIso = new Date(options?.nowMs ?? Date.now()).toISOString();
    if (typeof authorization.adminDb.runTransaction === 'function') {
      await authorization.adminDb.runTransaction(async (transaction: any) => {
        const orderSnap = await transaction.get(orderRef);
        if (!orderSnap?.exists) {
          const error: any = new Error('ORDER_NOT_FOUND');
          error.code = 'ORDER_NOT_FOUND';
          throw error;
        }
        transaction.update(orderRef, { status, updatedAt: nowIso });
      });
    } else {
      const orderSnap = await orderRef.get();
      if (!orderSnap?.exists) return sendJson(res, 404, { error: 'Commande introuvable.', code: 'ORDER_NOT_FOUND' });
      await orderRef.update({ status, updatedAt: nowIso });
    }
    return sendJson(res, 200, { success: true, orderId, status, updatedAt: nowIso });
  } catch (error: any) {
    if (error?.code === 'ORDER_NOT_FOUND' || error?.message === 'ORDER_NOT_FOUND') {
      return sendJson(res, 404, { error: 'Commande introuvable.', code: 'ORDER_NOT_FOUND' });
    }
    console.error('[OrdersManagement] Failed to update order status:', error);
    return sendJson(res, 500, { error: 'Impossible de mettre à jour cette commande pour le moment.', code: 'ORDER_STATUS_UPDATE_FAILED' });
  }
}
