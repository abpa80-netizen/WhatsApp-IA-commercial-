/**
 * Orders Engine - VIP Structured Order Processing Service
 * 
 * Secure backend API handler for creating structured customer orders.
 * 
 * Security & Business Rules:
 * 1. Exclusively available to vendors with an ACTIVE VIP subscription.
 * 2. 3-day free trial DOES NOT grant access to structured orders.
 * 3. Expired VIP subscriptions are strictly rejected (fails closed).
 * 4. Private /users/{uid} document evaluated via computeVendorEntitlements is the sole source of truth.
 * 5. Products are read directly from Firestore Admin (/users/{uid}/products/{productId}).
 *    Client-submitted names, prices and totals are NEVER trusted.
 * 6. Quantities are validated (positive integers) and subtotal/total are strictly calculated server-side.
 * 7. Initial order status is always 'Nouveau'.
 * 8. Orders are stored in the vendor sub-collection /users/{uid}/orders/{orderId}.
 * 9. Returns only non-sensitive order metadata (orderId, total, currency, status).
 */

import { getAdminDb, isFirebaseAdminConfigured } from './firebaseAdmin.ts';
import { computeVendorEntitlements } from './entitlementsService.ts';
import { StructuredOrder, OrderItem, CurrencyType } from '../types.ts';

export interface CreateOrderOptions {
  adminDb?: any;
  nowMs?: number;
}

export interface ValidatedOrderInput {
  vendeur_id: string;
  customerName: string;
  customerWhatsApp: string;
  deliveryAddress: string;
  items: Array<{ productId: string; quantity: number }>;
  deliveryFee: number;
  notes?: string;
}

/**
 * Universal JSON response sender compatible with Express, Vercel Serverless, and Node HTTP
 */
export function sendOrderJson(res: any, status: number, payload: any) {
  if (typeof res.setHeader === 'function') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(status).json(payload);
  }
  res.statusCode = status;
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json');
  }
  return res.end(JSON.stringify(payload));
}

/**
 * Strict input validation for public order creation
 */
export function validateOrderInput(body: any): { valid: true; data: ValidatedOrderInput } | { valid: false; error: string; code: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Le corps de la requête doit être un objet JSON valide.', code: 'INVALID_INPUT' };
  }

  // 1. Vendor UID
  const rawVendorId = body.vendeur_id || body.vendorId || body.vendeurId;
  if (!rawVendorId || typeof rawVendorId !== 'string' || rawVendorId.trim() === '') {
    return { valid: false, error: 'L’identifiant du vendeur (vendeur_id) est obligatoire.', code: 'INVALID_INPUT' };
  }
  const vendeur_id = rawVendorId.trim();
  if (vendeur_id.length > 128 || !/^[a-zA-Z0-9_\-]+$/.test(vendeur_id)) {
    return { valid: false, error: 'Identifiant du vendeur invalide.', code: 'INVALID_INPUT' };
  }

  // 2. Customer Name
  if (!body.customerName || typeof body.customerName !== 'string' || body.customerName.trim() === '') {
    return { valid: false, error: 'Le nom du client (customerName) est obligatoire.', code: 'INVALID_INPUT' };
  }
  const customerName = body.customerName.trim();
  if (customerName.length > 100) {
    return { valid: false, error: 'Le nom du client ne peut pas dépasser 100 caractères.', code: 'INVALID_INPUT' };
  }

  // 3. Customer WhatsApp
  if (!body.customerWhatsApp || typeof body.customerWhatsApp !== 'string' || body.customerWhatsApp.trim() === '') {
    return { valid: false, error: 'Le numéro WhatsApp du client (customerWhatsApp) est obligatoire.', code: 'INVALID_INPUT' };
  }
  const customerWhatsApp = body.customerWhatsApp.trim();
  if (customerWhatsApp.length < 6 || customerWhatsApp.length > 32) {
    return { valid: false, error: 'Le numéro WhatsApp du client doit contenir entre 6 et 32 caractères.', code: 'INVALID_INPUT' };
  }
  // Check for presence of at least 6 digits
  const digitCount = (customerWhatsApp.match(/\d/g) || []).length;
  if (digitCount < 6) {
    return { valid: false, error: 'Le numéro WhatsApp du client doit comporter un numéro valide.', code: 'INVALID_INPUT' };
  }

  // 4. Delivery Address
  if (!body.deliveryAddress || typeof body.deliveryAddress !== 'string' || body.deliveryAddress.trim() === '') {
    return { valid: false, error: 'L’adresse ou le lieu de livraison (deliveryAddress) est obligatoire.', code: 'INVALID_INPUT' };
  }
  const deliveryAddress = body.deliveryAddress.trim();
  if (deliveryAddress.length > 250) {
    return { valid: false, error: 'L’adresse de livraison ne peut pas dépasser 250 caractères.', code: 'INVALID_INPUT' };
  }

  // 5. Items list
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return { valid: false, error: 'La commande doit comporter au moins un article (items).', code: 'INVALID_INPUT' };
  }
  if (body.items.length > 50) {
    return { valid: false, error: 'Une commande ne peut pas contenir plus de 50 articles différents.', code: 'INVALID_INPUT' };
  }

  const validatedItems: Array<{ productId: string; quantity: number }> = [];
  for (let i = 0; i < body.items.length; i++) {
    const item = body.items[i];
    if (!item || typeof item !== 'object') {
      return { valid: false, error: `L’article à l’index ${i} est invalide.`, code: 'INVALID_INPUT' };
    }

    const productId = typeof item.productId === 'string' ? item.productId.trim() : '';
    if (!productId || productId.length > 128 || !/^[a-zA-Z0-9_\-]+$/.test(productId)) {
      return { valid: false, error: `Identifiant de produit invalide à l’index ${i}.`, code: 'INVALID_INPUT' };
    }

    const rawQty = item.quantity;
    const quantity = typeof rawQty === 'number' ? rawQty : parseInt(String(rawQty), 10);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
      return { valid: false, error: `La quantité pour le produit "${productId}" doit être un nombre entier positif compris entre 1 et 1000.`, code: 'INVALID_INPUT' };
    }

    validatedItems.push({ productId, quantity });
  }

  // 6. Delivery Fee
  let deliveryFee = 0;
  if (body.deliveryFee !== undefined && body.deliveryFee !== null) {
    const rawFee = Number(body.deliveryFee);
    if (isNaN(rawFee) || rawFee < 0 || rawFee > 1000000) {
      return { valid: false, error: 'Les frais de livraison sont invalides.', code: 'INVALID_INPUT' };
    }
    deliveryFee = Math.round(rawFee * 100) / 100;
  }

  // 7. Optional Notes
  let notes: string | undefined = undefined;
  if (body.notes && typeof body.notes === 'string') {
    const trimmedNotes = body.notes.trim();
    if (trimmedNotes.length > 1000) {
      return { valid: false, error: 'Les notes de commande ne peuvent pas dépasser 1000 caractères.', code: 'INVALID_INPUT' };
    }
    notes = trimmedNotes;
  }

  return {
    valid: true,
    data: {
      vendeur_id,
      customerName,
      customerWhatsApp,
      deliveryAddress,
      items: validatedItems,
      deliveryFee,
      notes,
    },
  };
}

/**
 * Universal Serverless / Express Handler for creating structured orders
 * Endpoint: POST /api/orders/create
 */
export async function handleCreateOrder(req: any, res: any, options?: CreateOrderOptions) {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    return sendOrderJson(res, 204, {});
  }

  // 1. HTTP Method constraint: POST only
  if (req.method !== 'POST') {
    return sendOrderJson(res, 405, {
      error: 'Méthode HTTP non autorisée. Seules les requêtes POST sont acceptées.',
      code: 'METHOD_NOT_ALLOWED',
    });
  }

  // 2. Strict Input Validation
  const validation = validateOrderInput(req.body);
  if (!validation.valid) {
    return sendOrderJson(res, 400, {
      error: validation.error,
      code: validation.code,
    });
  }

  const {
    vendeur_id,
    customerName,
    customerWhatsApp,
    deliveryAddress,
    items,
    deliveryFee,
    notes,
  } = validation.data;

  // 3. Resolve Firestore Admin instance
  let adminDb = options?.adminDb;
  if (!adminDb) {
    try {
      adminDb = getAdminDb();
    } catch (dbErr: any) {
      console.error('[OrdersService] Firebase Admin DB not available:', dbErr?.message);
      return sendOrderJson(res, 503, {
        error: 'Le service de gestion des commandes est temporairement indisponible. Veuillez réessayer plus tard.',
        code: 'SERVICE_UNAVAILABLE',
      });
    }
  }

  try {
    const nowMs = options?.nowMs || Date.now();
    const nowIso = new Date(nowMs).toISOString();

    // 4. Retrieve vendor document from private source of truth: /users/{uid}
    const userDocRef = adminDb.collection('users').doc(vendeur_id);
    const userSnap = await userDocRef.get();

    if (!userSnap.exists) {
      return sendOrderJson(res, 404, {
        error: 'Boutique ou vendeur introuvable. Impossible de créer la commande.',
        code: 'VENDOR_NOT_FOUND',
      });
    }

    const userDoc = userSnap.data() || {};

    // 5. Authoritative VIP Subscription Verification using computeVendorEntitlements
    const entitlements = computeVendorEntitlements(userDoc, nowMs);

    // Strict commercial rule: only active VIP accounts can accept structured orders
    if (entitlements.reason === 'suspended') {
      return sendOrderJson(res, 403, {
        error: 'Cette boutique est actuellement inactive ou suspendue par l’administrateur.',
        code: 'VENDOR_SUSPENDED',
      });
    }

    if (entitlements.reason === 'trial_active') {
      return sendOrderJson(res, 403, {
        error: 'La gestion structurée des commandes est une fonctionnalité réservée aux vendeurs VIP actifs. L’essai gratuit ne permet pas d’activer cette option.',
        code: 'VIP_REQUIRED',
      });
    }

    if (entitlements.reason === 'trial_expired') {
      return sendOrderJson(res, 403, {
        error: 'La période d’essai de cette boutique est expirée. Le vendeur doit activer le Pack VIP pour recevoir des commandes structurées.',
        code: 'VIP_REQUIRED',
      });
    }

    if (entitlements.reason === 'vip_expired') {
      return sendOrderJson(res, 403, {
        error: 'L’abonnement VIP de cette boutique est arrivé à expiration. La commande structurée est réservée aux abonnements VIP actifs.',
        code: 'VIP_EXPIRED',
      });
    }

    if (entitlements.reason !== 'vip_active') {
      return sendOrderJson(res, 403, {
        error: 'La gestion structurée des commandes est réservée aux boutiques disposant d’un abonnement VIP actif.',
        code: 'VIP_REQUIRED',
      });
    }

    // Determine vendor currency
    const currency: CurrencyType = userDoc.currency === 'MAD' ? 'MAD' : 'CFA';

    // 6. Fetch products strictly from /users/{uid}/products/{productId}
    // Never trust product names, prices or line totals submitted by client
    const orderItems: OrderItem[] = [];
    let calculatedSubtotal = 0;

    for (const item of items) {
      const productDocRef = adminDb
        .collection('users')
        .doc(vendeur_id)
        .collection('products')
        .doc(item.productId);

      const productSnap = await productDocRef.get();

      if (!productSnap.exists) {
        return sendOrderJson(res, 404, {
          error: `Le produit demandé (${item.productId}) n’existe pas ou n’est plus disponible dans cette boutique.`,
          code: 'PRODUCT_NOT_FOUND',
        });
      }

      const productData = productSnap.data() || {};

      // Verify vendor isolation on product
      if (productData.vendeur_id && productData.vendeur_id !== vendeur_id) {
        return sendOrderJson(res, 400, {
          error: `Le produit "${item.productId}" n’appartient pas à cette boutique.`,
          code: 'PRODUCT_INVALID',
        });
      }

      const unitPrice = typeof productData.price === 'number'
        ? productData.price
        : parseFloat(String(productData.price || '0'));

      if (isNaN(unitPrice) || unitPrice < 0) {
        return sendOrderJson(res, 400, {
          error: `Le prix du produit "${productData.name || item.productId}" est invalide.`,
          code: 'PRODUCT_PRICE_INVALID',
        });
      }

      const lineTotal = Math.round(unitPrice * item.quantity * 100) / 100;
      calculatedSubtotal += lineTotal;

      let productImage: string | undefined = undefined;
      if (Array.isArray(productData.images) && productData.images.length > 0) {
        productImage = String(productData.images[0]);
      }

      orderItems.push({
        productId: item.productId,
        name: String(productData.name || 'Produit'),
        price: unitPrice,
        quantity: item.quantity,
        total: lineTotal,
        image: productImage,
      });
    }

    // 7. Calculate server-side totals
    const subtotal = Math.round(calculatedSubtotal * 100) / 100;
    const finalDeliveryFee = Math.round(deliveryFee * 100) / 100;
    const total = Math.round((subtotal + finalDeliveryFee) * 100) / 100;

    // 8. Generate unique order ID and assemble StructuredOrder
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    const orderId = `ord_${nowMs}_${randomSuffix}`;

    const newOrder: StructuredOrder = {
      id: orderId,
      vendeur_id,
      customerName,
      customerWhatsApp,
      deliveryAddress,
      items: orderItems,
      subtotal,
      deliveryFee: finalDeliveryFee,
      total,
      currency,
      status: 'Nouveau',
      createdAt: nowIso,
      updatedAt: nowIso,
      notes: notes || undefined,
    };

    // 9. Persist into Firestore /users/{uid}/orders/{orderId}
    await adminDb
      .collection('users')
      .doc(vendeur_id)
      .collection('orders')
      .doc(orderId)
      .set(newOrder);

    // 10. Return strictly safe, useful order confirmation metadata
    return sendOrderJson(res, 201, {
      success: true,
      orderId,
      status: newOrder.status,
      subtotal: newOrder.subtotal,
      deliveryFee: newOrder.deliveryFee,
      total: newOrder.total,
      currency: newOrder.currency,
      itemCount: orderItems.reduce((acc, curr) => acc + curr.quantity, 0),
      message: 'Commande enregistrée avec succès.',
    });
  } catch (error: any) {
    console.error('[OrdersService Error]:', error?.message || error);
    return sendOrderJson(res, 500, {
      error: 'Une erreur interne est survenue lors de l’enregistrement de la commande.',
      code: 'INTERNAL_ERROR',
    });
  }
}
