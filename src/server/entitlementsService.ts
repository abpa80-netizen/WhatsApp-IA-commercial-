/**
 * Server-Side Entitlements & Subscription Expiration Engine
 * 
 * Provides an authoritative backend mechanism to recalculate and enforce
 * subscription entitlements (hasFullCatalog, is_active) from the private source
 * of truth (/users/{uid}) and synchronize them to public storefronts (/publicStores/{uid}).
 * 
 * Guarantees:
 * 1. An expired trial (trialEndsAt in past or created > trialDays ago without VIP) strictly drops hasFullCatalog to false.
 * 2. An expired VIP (vipEndsAt in past) strictly drops hasFullCatalog to false (falling back to 4 products limit).
 * 3. A suspended or inactive account strictly sets is_active to false and hasFullCatalog to false.
 * 4. An absent private vendor document strictly sets is_active to false and hasFullCatalog to false.
 * 5. Existing products and catalogs are ALWAYS preserved in Firestore; expiration only limits public display to 4 products.
 * 6. The public store document (/publicStores/{uid}) is NEVER the source of truth for subscription status.
 * 7. Server execution strictly relies on Firebase Admin SDK credentials, never client SDK bypassing or rule weakening.
 */

import { getAdminDb, isFirebaseAdminConfigured } from './firebaseAdmin.ts';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyFirebaseAdminToken } from './cloudinarySign.ts';

export interface EntitlementResult {
  hasFullCatalog: boolean;
  is_active: boolean;
  reason: 'vip_active' | 'vip_expired' | 'trial_active' | 'trial_expired' | 'free_tier' | 'suspended' | 'user_absent';
}

export interface RecalculationSummary {
  timestamp: string;
  configuredTrialDays: number;
  totalUsersScanned: number;
  totalPublicStoresScanned: number;
  updatedPublicStores: number;
  fullCatalogCount: number;
  restrictedCount: number;
  deactivatedCount: number;
  errors: number;
}

/**
 * Authoritative evaluation of vendor subscription entitlements based strictly
 * on private user document data (/users/{uid}).
 * 
 * Respects dynamic trialDays parameter configured in settings/global.
 * Never trusts client or publicStore flags.
 */
export function computeVendorEntitlements(
  userDoc: Record<string, any> | null | undefined,
  nowMs: number = Date.now(),
  configuredTrialDays: number = 7
): EntitlementResult {
  // Case 1: Private user document is absent or completely empty
  if (!userDoc || Object.keys(userDoc).length === 0 || (!userDoc.uid && !userDoc.id && !userDoc.name && !userDoc.status)) {
    return {
      hasFullCatalog: false,
      is_active: false,
      reason: 'user_absent',
    };
  }

  // Case 2: Suspended or deactivated account (administrative action)
  const isSuspended = userDoc.status === 'Inactif' || userDoc.status === 'Suspendu' || userDoc.is_active === false;
  if (isSuspended) {
    return {
      hasFullCatalog: false,
      is_active: false,
      reason: 'suspended',
    };
  }

  // Case 3: VIP subscription
  const isVip = userDoc.status === 'VIP' || userDoc.plan === 'VIP';
  if (isVip) {
    const vipEnd = userDoc.vipEndsAt;
    if (!vipEnd) {
      // Lifetime / indefinite VIP granted by administrator
      return {
        hasFullCatalog: true,
        is_active: true,
        reason: 'vip_active',
      };
    }
    const vipEndMs = new Date(vipEnd).getTime();
    if (!isNaN(vipEndMs) && vipEndMs > nowMs) {
      return {
        hasFullCatalog: true,
        is_active: true,
        reason: 'vip_active',
      };
    } else {
      // VIP has expired: falls back to 4-product free tier while keeping store open
      return {
        hasFullCatalog: false,
        is_active: true,
        reason: 'vip_expired',
      };
    }
  }

  // Case 4: Explicit Free Tier
  if (userDoc.plan === 'Gratuit' || userDoc.status === 'Gratuit') {
    return {
      hasFullCatalog: false,
      is_active: true,
      reason: 'free_tier',
    };
  }

  // Case 5: Trial period with explicit trial expiration timestamp
  const trialEnd = userDoc.trialEndsAt || userDoc.date_expiration_essai;
  if (trialEnd) {
    const trialEndMs = new Date(trialEnd).getTime();
    if (!isNaN(trialEndMs) && trialEndMs > nowMs) {
      return {
        hasFullCatalog: true,
        is_active: true,
        reason: 'trial_active',
      };
    } else {
      // Trial has expired: catalog display is limited to 4 products, store stays open
      return {
        hasFullCatalog: false,
        is_active: true,
        reason: 'trial_expired',
      };
    }
  }

  // Case 6: Active account without explicit Gratuit/VIP: evaluate against configured trialDays
  if (userDoc.status === 'Actif' && userDoc.plan !== 'Gratuit') {
    const created = userDoc.trialStartedAt || userDoc.created_at || userDoc.createdAt;
    if (created) {
      const ageDays = (nowMs - new Date(created).getTime()) / 86400000;
      if (ageDays <= configuredTrialDays) {
        return {
          hasFullCatalog: true,
          is_active: true,
          reason: 'trial_active',
        };
      }
    }
    // Expired default trial
    return {
      hasFullCatalog: false,
      is_active: true,
      reason: 'trial_expired',
    };
  }

  // Default fallback: restricted free mode
  return {
    hasFullCatalog: false,
    is_active: true,
    reason: 'free_tier',
  };
}

/**
 * Server-side batch synchronization utilizing Firebase Admin SDK:
 * Reads all private /users records, recalculates entitlements,
 * and updates /publicStores/{uid} with authoritative hasFullCatalog and is_active.
 * Also deactivates orphaned public stores whose private user document was deleted.
 */
export async function recalculateAllEntitlementsServer(): Promise<RecalculationSummary> {
  const adminDb = getAdminDb();
  const now = Date.now();

  // Read dynamic settings/global for configured trialDays
  let dynamicTrialDays = 7;
  try {
    const settingsDoc = await adminDb.collection('settings').doc('global').get();
    if (settingsDoc.exists) {
      const s = settingsDoc.data();
      dynamicTrialDays = Number(s?.trialDays ?? s?.trial_days ?? 7);
    }
  } catch (err) {
    console.warn('[Entitlements Engine] Could not read settings/global, using default trialDays of 7:', err);
  }

  const summary: RecalculationSummary = {
    timestamp: new Date().toISOString(),
    configuredTrialDays: dynamicTrialDays,
    totalUsersScanned: 0,
    totalPublicStoresScanned: 0,
    updatedPublicStores: 0,
    fullCatalogCount: 0,
    restrictedCount: 0,
    deactivatedCount: 0,
    errors: 0,
  };

  try {
    const usersSnap = await adminDb.collection('users').get();
    summary.totalUsersScanned = usersSnap.size;

    const validUserIds = new Set<string>();

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      validUserIds.add(uid);
      const userData = userDoc.data();

      try {
        const entitlement = computeVendorEntitlements(userData, now, dynamicTrialDays);

        if (entitlement.is_active && entitlement.hasFullCatalog) {
          summary.fullCatalogCount++;
        } else if (entitlement.is_active) {
          summary.restrictedCount++;
        } else {
          summary.deactivatedCount++;
        }

        // Fetch current publicStore doc to check if update is needed
        const storeRef = adminDb.collection('publicStores').doc(uid);
        const storeSnap = await storeRef.get();

        const currentData = storeSnap.exists ? storeSnap.data() : null;
        const currentHasFull = currentData?.hasFullCatalog;
        const currentIsActive = currentData?.is_active;

        const sensitivePublicFields = ['role', 'status', 'plan', 'trialStartedAt', 'trialEndsAt', 'date_expiration_essai', 'vipStartedAt', 'vipEndsAt', 'whatsappNumber', 'phone', 'phoneNormalized'];
        const hasSensitivePublicFields = Boolean(currentData && sensitivePublicFields.some((key) => key in currentData));

        if (!storeSnap.exists || currentHasFull !== entitlement.hasFullCatalog || currentIsActive !== entitlement.is_active || hasSensitivePublicFields) {
          const purgePrivateFields: Record<string, any> = {};
          for (const key of ['role', 'status', 'plan', 'trialStartedAt', 'trialEndsAt', 'date_expiration_essai', 'vipStartedAt', 'vipEndsAt', 'whatsappNumber', 'phone', 'phoneNormalized']) {
            purgePrivateFields[key] = FieldValue.delete();
          }
          await storeRef.set(
            {
              id: uid,
              hasFullCatalog: entitlement.hasFullCatalog,
              is_active: entitlement.is_active,
              updatedAt: new Date().toISOString(),
              ...purgePrivateFields,
            },
            { merge: true }
          );
          summary.updatedPublicStores++;
        }
      } catch (docErr) {
        console.error(`[Entitlements Engine] Failed to process user ${uid}:`, docErr);
        summary.errors++;
      }
    }

    // Check for orphaned publicStores (where /users/{uid} does not exist)
    try {
      const publicStoresSnap = await adminDb.collection('publicStores').get();
      summary.totalPublicStoresScanned = publicStoresSnap.size;

      for (const storeDoc of publicStoresSnap.docs) {
        const storeUid = storeDoc.id;
        if (!validUserIds.has(storeUid)) {
          const storeData = storeDoc.data();
          if (storeData.is_active !== false || storeData.hasFullCatalog !== false) {
            const purgePrivateFields: Record<string, any> = {};
            for (const key of ['role', 'status', 'plan', 'trialStartedAt', 'trialEndsAt', 'date_expiration_essai', 'vipStartedAt', 'vipEndsAt', 'whatsappNumber', 'phone', 'phoneNormalized']) {
              purgePrivateFields[key] = FieldValue.delete();
            }
            await adminDb.collection('publicStores').doc(storeUid).set(
              {
                hasFullCatalog: false,
                is_active: false,
                updatedAt: new Date().toISOString(),
                ...purgePrivateFields,
              },
              { merge: true }
            );
            summary.updatedPublicStores++;
            summary.deactivatedCount++;
          }
        }
      }
    } catch (orphanErr) {
      console.warn('[Entitlements Engine] Orphan scan error:', orphanErr);
    }

    return summary;
  } catch (err: any) {
    console.error('[Entitlements Engine] Batch recalculation failed:', err);
    summary.errors++;
    return summary;
  }
}

/**
 * Standard HTTP Request Handler for both Vercel Serverless Function & Express server
 * Supports GET (Vercel Cron) and POST (Admin Portal trigger)
 */
export async function handleRecalculateEntitlements(req: any, res: any): Promise<void> {
  // CORS & Allowed Methods
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-cron-secret');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée. Utilisez GET ou POST.' });
  }

  try {
    let isAuthorized = false;
    let authType = '';

    // 1. Verification of CRON_SECRET (Vercel Cron / Cloud Scheduler)
    const configuredCronSecret = process.env.CRON_SECRET;
    const providedSecret = req.headers['x-cron-secret'] || 
      (typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ') && !req.headers.authorization.includes('ey')
        ? req.headers.authorization.slice(7)
        : null);

    if (configuredCronSecret && configuredCronSecret.trim().length > 0 && providedSecret === configuredCronSecret) {
      isAuthorized = true;
      authType = 'cron_secret';
    }

    // 2. Verification of Firebase Administrator ID Token (Admin Dashboard foosco80@gmail.com)
    if (!isAuthorized && typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')) {
      const token = req.headers.authorization.slice(7);
      try {
        const adminUser = await verifyFirebaseAdminToken(token);
        if (adminUser.email === 'foosco80@gmail.com') {
          isAuthorized = true;
          authType = 'admin_token';
        }
      } catch (authErr: any) {
        // Return explicit 403 if token is a valid seller but not admin
        if (authErr?.message?.includes('privilèges administrateur')) {
          return res.status(403).json({ error: 'Accès interdit : ce compte utilisateur n’a pas les privilèges administrateur.' });
        }
      }
    }

    if (!isAuthorized) {
      return res.status(401).json({ error: 'Accès non autorisé. Authentification administrateur ou secret CRON requis.' });
    }

    // 3. Check Firebase Admin SDK setup
    if (!isFirebaseAdminConfigured()) {
      return res.status(503).json({
        error: 'Firebase Admin SDK non configuré',
        message: 'La variable d’environnement privée FIREBASE_SERVICE_ACCOUNT_KEY (ou FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY) doit être configurée dans les paramètres Vercel pour permettre le traitement serveur autonome.',
        requiresConfig: true,
      });
    }

    // 4. Execute authoritative recalculation
    const summary = await recalculateAllEntitlementsServer();
    return res.status(200).json({
      success: true,
      authType,
      summary,
    });
  } catch (err: any) {
    console.error('Erreur lors du traitement /api/admin/recalculate-entitlements:', err);
    return res.status(500).json({ error: err?.message || 'Erreur interne lors du recalcul des droits' });
  }
}
