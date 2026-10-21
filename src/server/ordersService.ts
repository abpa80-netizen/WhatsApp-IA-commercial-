/**
 * Orders Engine - VIP Structured Order Processing Service
 * 
 * Secure backend API handler for creating structured customer orders.
 * 
 * Security & Business Rules (Prompt 1 & 2A Hardening):
 * 1. Exclusively available to vendors with an ACTIVE VIP subscription.
 * 2. 3-day free trial DOES NOT grant access to structured orders.
 * 3. Expired VIP subscriptions are strictly rejected (fails closed).
 * 4. Private /users/{uid} document evaluated via computeVendorEntitlements is the sole source of truth.
 * 5. Products are read directly from Firestore Admin (/users/{uid}/products/{productId}).
 *    Client-submitted names, prices and totals are NEVER trusted.
 * 6. Quantities are validated (positive integers) and subtotal/total are strictly calculated server-side.
 * 7. Duplicate products in cart are safely merged, with cumulative quantity caps (max 1000).
 * 8. Idempotency keys (/users/{uid}/idempotency/{key}) prevent duplicate orders in concurrent scenarios;
 *    replays safely return the original confirmation without re-creation. Retention TTL: 7 days.
 * 9. Distributed rate limiting (/rateLimits/{key}) protects public endpoint across Vercel serverless instances.
 * 10. Initial order status is always 'Nouveau'.
 * 11. Orders are stored in the vendor sub-collection /users/{uid}/orders/{orderId}.
 * 12. Returns only non-sensitive order metadata (orderId, total, currency, status).
 */

import crypto from 'crypto';
import { getAdminDb } from './firebaseAdmin.ts';
import { computeVendorEntitlements } from './entitlementsService.ts';
import { StructuredOrder, OrderItem, CurrencyType } from '../types.ts';

export interface CreateOrderOptions {
  adminDb?: any;
  nowMs?: number;
  skipRateLimit?: boolean;
  maxRequests?: number;
  windowMs?: number;
}

export interface ValidatedOrderItem {
  productId: string;
  quantity: number;
}

export interface ValidatedOrderInput {
  vendeur_id: string;
  customerName: string;
  customerWhatsApp: string;
  deliveryAddress: string;
  items: ValidatedOrderItem[];
  deliveryFee: number;
  notes?: string;
  idempotencyKey?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  clientIp: string;
}

// ---------------------------------------------------------------------------
// Custom Process Error for structured transactional aborts
// ---------------------------------------------------------------------------
export class OrderProcessError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'OrderProcessError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Rate Limiting & Network Helpers
// ---------------------------------------------------------------------------

/**
 * Universal JSON response sender compatible with Express, Vercel Serverless, and Node HTTP
 */
export function sendOrderJson(res: any, status: number, payload: any) {
  if (typeof res.setHeader === 'function') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key, X-Idempotency-Key');
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
 * IP extraction adhering to standard proxy and Vercel edge reverse-proxy topology
 */
export function getClientIp(req: any): string {
  if (!req) return '127.0.0.1';

  // 1. Vercel-specific verified header
  const vercelForwarded = req.headers?.['x-vercel-forwarded-for'];
  if (typeof vercelForwarded === 'string' && vercelForwarded.trim()) {
    return vercelForwarded.split(',')[0].trim();
  }

  // 2. Standard X-Forwarded-For (first entry is the original client IP)
  const xForwardedFor = req.headers?.['x-forwarded-for'];
  if (typeof xForwardedFor === 'string' && xForwardedFor.trim()) {
    return xForwardedFor.split(',')[0].trim();
  }

  // 3. X-Real-IP
  const xRealIp = req.headers?.['x-real-ip'];
  if (typeof xRealIp === 'string' && xRealIp.trim()) {
    return xRealIp.trim();
  }

  // 4. Cloudflare Connecting IP
  const cfIp = req.headers?.['cf-connecting-ip'];
  if (typeof cfIp === 'string' && cfIp.trim()) {
    return cfIp.trim();
  }

  // 5. Direct socket connection
  const socketIp = req.socket?.remoteAddress || req.connection?.remoteAddress;
  if (typeof socketIp === 'string' && socketIp.trim()) {
    return socketIp.trim();
  }

  return '127.0.0.1';
}

/**
 * In-memory fast cache for high-frequency requests on the same server instance
 */
const localMemoryRateLimits = new Map<string, { count: number; resetAt: number }>();

/**
 * Prunes expired memory entries when cache grows
 */
function pruneLocalMemoryCache(nowMs: number) {
  if (localMemoryRateLimits.size > 2000) {
    for (const [key, entry] of localMemoryRateLimits.entries()) {
      if (entry.resetAt <= nowMs) {
        localMemoryRateLimits.delete(key);
      }
    }
  }
}

/**
 * Resets local memory rate limit cache (useful in tests)
 */
export function resetMemoryRateLimits() {
  localMemoryRateLimits.clear();
}

/**
 * Distributed Rate Limiting for Public Order Creation
 * 
 * Protects POST /api/orders/create against automated abuse and spam.
 * Persistent across Vercel serverless lambda containers using Firestore /rateLimits/{limitId}.
 * 
 * Note on mobile networks (CGNAT):
 * In North & West Africa, telecom operators (Maroc Telecom, Orange, MTN, Moov) often share public IPs
 * across thousands of mobile subscribers. A balanced threshold (10 orders per 10 minutes) ensures
 * protection against bots while avoiding false positives for legitimate buyers.
 */
export async function checkOrdersRateLimit(
  req: any,
  adminDb: any,
  options?: { nowMs?: number; maxRequests?: number; windowMs?: number }
): Promise<RateLimitResult> {
  const nowMs = options?.nowMs || Date.now();
  const maxRequests = options?.maxRequests ?? parseInt(process.env.ORDERS_RATE_LIMIT_MAX || '10', 10);
  const windowMs = options?.windowMs ?? parseInt(process.env.ORDERS_RATE_LIMIT_WINDOW_MS || '600000', 10); // 10 minutes

  const clientIp = getClientIp(req);
  const ipHash = crypto.createHash('sha256').update(clientIp).digest('hex').substring(0, 32);

  const windowIndex = Math.floor(nowMs / windowMs);
  const windowStartMs = windowIndex * windowMs;
  const resetAtMs = windowStartMs + windowMs;
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000));
  const memoryKey = `${ipHash}_${windowIndex}`;

  pruneLocalMemoryCache(nowMs);

  // 1. Fast in-memory check (short-circuits obvious floods without Firestore cost)
  const memEntry = localMemoryRateLimits.get(memoryKey);
  if (memEntry && memEntry.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
      clientIp,
    };
  }

  // 2. Distributed check in Firestore Admin (/rateLimits collection)
  const limitDocId = `ord_rl_${ipHash}_${windowIndex}`;
  if (adminDb && typeof adminDb.collection === 'function') {
    try {
      const limitRef = adminDb.collection('rateLimits').doc(limitDocId);

      if (typeof adminDb.runTransaction === 'function') {
        const txResult = await adminDb.runTransaction(async (transaction: any) => {
          const docSnap = await transaction.get(limitRef);
          if (!docSnap.exists) {
            transaction.set(limitRef, {
              ipHash,
              count: 1,
              windowStart: new Date(windowStartMs).toISOString(),
              expiresAt: new Date(resetAtMs + windowMs).toISOString(), // 20 min retention
              updatedAt: new Date(nowMs).toISOString(),
            });
            return { count: 1, allowed: true };
          }

          const data = docSnap.data() || {};
          const currentCount = typeof data.count === 'number' ? data.count : 0;
          if (currentCount >= maxRequests) {
            return { count: currentCount, allowed: false };
          }

          const nextCount = currentCount + 1;
          transaction.set(
            limitRef,
            {
              count: nextCount,
              updatedAt: new Date(nowMs).toISOString(),
            },
            { merge: true }
          );
          return { count: nextCount, allowed: true };
        });

        // Sync local memory cache with distributed counter
        localMemoryRateLimits.set(memoryKey, { count: txResult.count, resetAt: resetAtMs });

        if (!txResult.allowed) {
          return {
            allowed: false,
            remaining: 0,
            retryAfterSeconds,
            clientIp,
          };
        }

        return {
          allowed: true,
          remaining: Math.max(0, maxRequests - txResult.count),
          retryAfterSeconds,
          clientIp,
        };
      } else {
        // Fallback for simple mock/test without runTransaction
        const docSnap = await limitRef.get();
        let currentCount = 0;
        if (docSnap && docSnap.exists) {
          currentCount = (docSnap.data() || {}).count || 0;
        }
        if (currentCount >= maxRequests) {
          return { allowed: false, remaining: 0, retryAfterSeconds, clientIp };
        }
        await limitRef.set(
          {
            ipHash,
            count: currentCount + 1,
            windowStart: new Date(windowStartMs).toISOString(),
            expiresAt: new Date(resetAtMs + windowMs).toISOString(),
          },
          { merge: true }
        );

        localMemoryRateLimits.set(memoryKey, { count: currentCount + 1, resetAt: resetAtMs });
        return {
          allowed: true,
          remaining: Math.max(0, maxRequests - (currentCount + 1)),
          retryAfterSeconds,
          clientIp,
        };
      }
    } catch (err: any) {
      console.warn('[OrdersService] Distributed rate limiter fallback due to Firestore error:', err?.message);
      // Fallback: local memory counting only so network glitches don't break genuine orders
      const currentCount = (memEntry ? memEntry.count : 0) + 1;
      localMemoryRateLimits.set(memoryKey, { count: currentCount, resetAt: resetAtMs });
      if (currentCount > maxRequests) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds,
          clientIp,
        };
      }
      return {
        allowed: true,
        remaining: Math.max(0, maxRequests - currentCount),
        retryAfterSeconds,
        clientIp,
      };
    }
  }

  // Fallback if no adminDb provided: memory only
  const currentCount = (memEntry ? memEntry.count : 0) + 1;
  localMemoryRateLimits.set(memoryKey, { count: currentCount, resetAt: resetAtMs });
  if (currentCount > maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
      clientIp,
    };
  }
  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - currentCount),
    retryAfterSeconds,
    clientIp,
  };
}

/**
 * Computes a deterministic SHA-256 fingerprint of the canonical order content.
 * 
 * Rules:
 * - Normalized customer name (trimmed, normalized whitespace)
 * - Normalized customer WhatsApp (digits & leading plus only)
 * - Normalized delivery address (trimmed, normalized whitespace)
 * - Deduplicated items with merged quantities, sorted canonically by productId
 * - Validated delivery fee rounded to 2 decimals
 * - Resolved vendor currency
 * - Strictly excludes non-deterministic runtime fields (createdAt, orderId, nowMs)
 */
export function computeOrderRequestHash(params: {
  customerName: string;
  customerWhatsApp: string;
  deliveryAddress: string;
  items: Array<{ productId: string; quantity: number }>;
  deliveryFee: number;
  currency?: string;
}): string {
  const normalizedItems = [...params.items]
    .map((item) => ({
      productId: String(item.productId || '').trim(),
      quantity: Number(item.quantity) || 1,
    }))
    .sort((a, b) => a.productId.localeCompare(b.productId));

  const canonicalPayload = {
    currency: String(params.currency || '').trim().toUpperCase(),
    customerName: String(params.customerName || '').trim().replace(/\s+/g, ' '),
    customerWhatsApp: String(params.customerWhatsApp || '').trim().replace(/[^\d+]/g, ''),
    deliveryAddress: String(params.deliveryAddress || '').trim().replace(/\s+/g, ' '),
    deliveryFee: Math.round(Number(params.deliveryFee || 0) * 100) / 100,
    items: normalizedItems,
  };

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalPayload))
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Strict Input Validation & Duplicate Product Merging
// ---------------------------------------------------------------------------

/**
 * Strict input validation for public order creation
 * - Validates formats, limits and types
 * - Merges duplicate productId entries and caps cumulative quantity
 * - Validates optional idempotency key
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

  // 5. Items list & Duplicate Product Merging
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return { valid: false, error: 'La commande doit comporter au moins un article (items).', code: 'INVALID_INPUT' };
  }

  const mergedItemsMap = new Map<string, ValidatedOrderItem>();

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
      return {
        valid: false,
        error: `La quantité pour le produit "${productId}" doit être un nombre entier positif compris entre 1 et 1000.`,
        code: 'INVALID_INPUT',
      };
    }

    const existing = mergedItemsMap.get(productId);
    if (existing) {
      // Safe deduplication: merge quantities
      const mergedQty = existing.quantity + quantity;
      if (mergedQty > 1000) {
        return {
          valid: false,
          error: `La quantité cumulée pour le produit "${productId}" ne peut pas dépasser 1000 unités.`,
          code: 'INVALID_INPUT',
        };
      }
      existing.quantity = mergedQty;
    } else {
      if (mergedItemsMap.size >= 50) {
        return { valid: false, error: 'Une commande ne peut pas contenir plus de 50 articles différents.', code: 'INVALID_INPUT' };
      }
      mergedItemsMap.set(productId, { productId, quantity });
    }
  }

  const validatedItems = Array.from(mergedItemsMap.values());
  if (validatedItems.length === 0) {
    return { valid: false, error: 'La commande doit comporter au moins un article valide.', code: 'INVALID_INPUT' };
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

  // 8. Optional Idempotency Key
  let idempotencyKey: string | undefined = undefined;
  const rawIdemp = body.idempotencyKey ?? body.idempotency_key;
  if (rawIdemp !== undefined && rawIdemp !== null) {
    if (typeof rawIdemp !== 'string') {
      return { valid: false, error: 'La clé d’idempotence doit être une chaîne de caractères.', code: 'INVALID_INPUT' };
    }
    const trimmedIdemp = rawIdemp.trim();
    if (trimmedIdemp.length < 8 || trimmedIdemp.length > 128 || !/^[a-zA-Z0-9_\-]+$/.test(trimmedIdemp)) {
      return {
        valid: false,
        error: 'La clé d’idempotence doit comporter entre 8 et 128 caractères alphanumériques (_ et - autorisés).',
        code: 'INVALID_INPUT',
      };
    }
    idempotencyKey = trimmedIdemp;
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
      idempotencyKey,
    },
  };
}

// ---------------------------------------------------------------------------
// Main Public Order Creation Handler
// ---------------------------------------------------------------------------

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

  // 2. Capture idempotency key from header if not in body
  const requestBody = req.body && typeof req.body === 'object' ? { ...req.body } : req.body;
  if (requestBody && !requestBody.idempotencyKey) {
    const headerKey = req.headers?.['idempotency-key'] || req.headers?.['x-idempotency-key'];
    if (typeof headerKey === 'string' && headerKey.trim()) {
      requestBody.idempotencyKey = headerKey.trim();
    }
  }

  // 3. Strict Input Validation (including merged duplicate products)
  const validation = validateOrderInput(requestBody);
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
    idempotencyKey,
  } = validation.data;

  // 4. Resolve Firestore Admin instance
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

  const nowMs = options?.nowMs || Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // 5. Distributed Rate Limiting (anti-flood / anti-abuse on public endpoint)
  if (!options?.skipRateLimit) {
    const rateCheck = await checkOrdersRateLimit(req, adminDb, {
      nowMs,
      maxRequests: options?.maxRequests,
      windowMs: options?.windowMs,
    });

    if (!rateCheck.allowed) {
      if (typeof res.setHeader === 'function') {
        res.setHeader('Retry-After', String(rateCheck.retryAfterSeconds));
      }
      return sendOrderJson(res, 429, {
        error: 'Trop de commandes créées récemment depuis cette connexion. Veuillez patienter avant de renouveler votre commande.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: rateCheck.retryAfterSeconds,
      });
    }
  }

  try {
    // -------------------------------------------------------------------------
    // 6. Atomic Execution with Transaction (or resilient fallback)
    // -------------------------------------------------------------------------
    const userDocRef = adminDb.collection('users').doc(vendeur_id);
    const idempDocRef = idempotencyKey
      ? adminDb.collection('users').doc(vendeur_id).collection('idempotency').doc(idempotencyKey)
      : null;

    // Helper to process business logic and save order
    const executeOrderProcessing = async (transaction?: any) => {
      // 6a. Vendor validation from private source of truth: /users/{uid}
      const userSnap = transaction ? await transaction.get(userDocRef) : await userDocRef.get();
      if (!userSnap.exists) {
        throw new OrderProcessError(404, 'VENDOR_NOT_FOUND', 'Boutique ou vendeur introuvable. Impossible de créer la commande.');
      }

      const userDoc = userSnap.data() || {};
      const currency: CurrencyType = userDoc.currency === 'MAD' ? 'MAD' : 'CFA';

      // 6b. Deterministic Order Request Hash
      const requestHash = computeOrderRequestHash({
        customerName,
        customerWhatsApp,
        deliveryAddress,
        items,
        deliveryFee,
        currency,
      });

      // 6c. Idempotency Check: if key already used for this vendor, verify requestHash
      if (idempDocRef) {
        const idempSnap = transaction ? await transaction.get(idempDocRef) : await idempDocRef.get();
        if (idempSnap && idempSnap.exists) {
          const cached = idempSnap.data() || {};

          // Safe, explicit handling of legacy keys without requestHash: fail-safe closed
          if (!cached.requestHash) {
            throw new OrderProcessError(
              409,
              'IDEMPOTENCY_CONFLICT',
              'Cette clé d’idempotence a été enregistrée avec un format antérieur sans empreinte de validation. Veuillez utiliser une nouvelle clé d’idempotence.'
            );
          }

          // Payload mismatch detection: HTTP 409 Conflict without leaking previous order
          if (cached.requestHash !== requestHash) {
            throw new OrderProcessError(
              409,
              'IDEMPOTENCY_CONFLICT',
              'Conflit d’idempotence : cette clé a déjà été utilisée pour une commande avec un contenu différent.'
            );
          }

          // Valid replay with matching hash: return original confirmation
          return {
            isReplay: true,
            orderId: cached.orderId,
            status: cached.status || 'Nouveau',
            subtotal: cached.subtotal,
            deliveryFee: cached.deliveryFee,
            total: cached.total,
            currency: cached.currency,
            itemCount: cached.itemCount,
          };
        }
      }

      // 6d. Authoritative VIP Subscription Verification using computeVendorEntitlements
      const entitlements = computeVendorEntitlements(userDoc, nowMs);

      if (entitlements.reason === 'suspended') {
        throw new OrderProcessError(403, 'VENDOR_SUSPENDED', 'Cette boutique est actuellement inactive ou suspendue par l’administrateur.');
      }
      if (entitlements.reason === 'trial_active') {
        throw new OrderProcessError(403, 'VIP_REQUIRED', 'La gestion structurée des commandes est une fonctionnalité réservée aux vendeurs VIP actifs. L’essai gratuit ne permet pas d’activer cette option.');
      }
      if (entitlements.reason === 'trial_expired') {
        throw new OrderProcessError(403, 'VIP_REQUIRED', 'La période d’essai de cette boutique est expirée. Le vendeur doit activer le Pack VIP pour recevoir des commandes structurées.');
      }
      if (entitlements.reason === 'vip_expired') {
        throw new OrderProcessError(403, 'VIP_EXPIRED', 'L’abonnement VIP de cette boutique est arrivé à expiration. La commande structurée est réservée aux abonnements VIP actifs.');
      }
      if (entitlements.reason !== 'vip_active') {
        throw new OrderProcessError(403, 'VIP_REQUIRED', 'La gestion structurée des commandes est réservée aux boutiques disposant d’un abonnement VIP actif.');
      }

      // 6e. Fetch products strictly from /users/{uid}/products/{productId}
      const orderItems: OrderItem[] = [];
      let calculatedSubtotal = 0;

      for (const item of items) {
        const productDocRef = adminDb
          .collection('users')
          .doc(vendeur_id)
          .collection('products')
          .doc(item.productId);

        const productSnap = transaction ? await transaction.get(productDocRef) : await productDocRef.get();

        if (!productSnap.exists) {
          throw new OrderProcessError(404, 'PRODUCT_NOT_FOUND', `Le produit demandé (${item.productId}) n’existe pas ou n’est plus disponible dans cette boutique.`);
        }

        const productData = productSnap.data() || {};

        if (productData.vendeur_id && productData.vendeur_id !== vendeur_id) {
          throw new OrderProcessError(400, 'PRODUCT_INVALID', `Le produit "${item.productId}" n’appartient pas à cette boutique.`);
        }

        const unitPrice = typeof productData.price === 'number'
          ? productData.price
          : parseFloat(String(productData.price || '0'));

        if (isNaN(unitPrice) || unitPrice < 0) {
          throw new OrderProcessError(400, 'PRODUCT_PRICE_INVALID', `Le prix du produit "${productData.name || item.productId}" est invalide.`);
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

      // 6e. Calculate server-side totals
      const subtotal = Math.round(calculatedSubtotal * 100) / 100;
      const finalDeliveryFee = Math.round(deliveryFee * 100) / 100;
      const total = Math.round((subtotal + finalDeliveryFee) * 100) / 100;
      const itemCount = orderItems.reduce((acc, curr) => acc + curr.quantity, 0);

      // 6f. Generate unique order ID
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
        idempotencyKey: idempotencyKey || undefined,
      };

      const orderDocRef = adminDb
        .collection('users')
        .doc(vendeur_id)
        .collection('orders')
        .doc(orderId);

      // 6g. Save order
      if (transaction) {
        transaction.set(orderDocRef, newOrder);
      } else {
        await orderDocRef.set(newOrder);
      }

      // 6h. Save idempotency record (TTL: 7 days)
      if (idempDocRef) {
        const idempPayload = {
          orderId,
          vendeur_id,
          requestHash,
          status: newOrder.status,
          subtotal: newOrder.subtotal,
          deliveryFee: newOrder.deliveryFee,
          total: newOrder.total,
          currency: newOrder.currency,
          itemCount,
          createdAt: nowIso,
          expiresAt: new Date(nowMs + 7 * 24 * 3600 * 1000).toISOString(),
        };

        if (transaction) {
          transaction.set(idempDocRef, idempPayload);
        } else {
          await idempDocRef.set(idempPayload);
        }
      }

      return {
        isReplay: false,
        orderId,
        status: newOrder.status,
        subtotal: newOrder.subtotal,
        deliveryFee: newOrder.deliveryFee,
        total: newOrder.total,
        currency: newOrder.currency,
        itemCount,
      };
    };

    let result: any;
    if (typeof adminDb.runTransaction === 'function') {
      result = await adminDb.runTransaction(async (transaction: any) => {
        return executeOrderProcessing(transaction);
      });
    } else {
      result = await executeOrderProcessing();
    }

    if (result.isReplay) {
      return sendOrderJson(res, 200, {
        success: true,
        orderId: result.orderId,
        status: result.status,
        subtotal: result.subtotal,
        deliveryFee: result.deliveryFee,
        total: result.total,
        currency: result.currency,
        itemCount: result.itemCount,
        replayed: true,
        message: 'Commande déjà enregistrée (rejeu idempotent).',
      });
    }

    return sendOrderJson(res, 201, {
      success: true,
      orderId: result.orderId,
      status: result.status,
      subtotal: result.subtotal,
      deliveryFee: result.deliveryFee,
      total: result.total,
      currency: result.currency,
      itemCount: result.itemCount,
      message: 'Commande enregistrée avec succès.',
    });
  } catch (error: any) {
    if (error instanceof OrderProcessError) {
      return sendOrderJson(res, error.statusCode, {
        error: error.message,
        code: error.code,
      });
    }

    console.error('[OrdersService Error]:', error?.message || error);
    return sendOrderJson(res, 500, {
      error: 'Une erreur interne est survenue lors de l’enregistrement de la commande.',
      code: 'INTERNAL_ERROR',
    });
  }
}
