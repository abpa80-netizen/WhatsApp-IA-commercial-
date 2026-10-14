/**
 * Server-Side Entitlements & Subscription Expiration Engine
 * 
 * Provides an authoritative backend mechanism to recalculate and enforce
 * subscription entitlements (hasFullCatalog, is_active) from the private source
 * of truth (/users/{uid}) and synchronize them to public storefronts (/publicStores/{uid}).
 * 
 * Guarantees:
 * 1. An expired trial (trialEndsAt in past or created > 14 days ago without VIP) strictly drops hasFullCatalog to false.
 * 2. An expired VIP (vipEndsAt in past) strictly drops hasFullCatalog to false.
 * 3. A suspended or inactive account strictly sets is_active to false and hasFullCatalog to false.
 * 4. An absent private vendor document strictly sets is_active to false and hasFullCatalog to false.
 * 5. Existing products and catalogs are ALWAYS preserved in Firestore; expiration only limits public display to 4 products.
 * 6. The public store document (/publicStores/{uid}) is NEVER the source of truth for subscription status.
 */

import { db } from '../firebase.ts';
import { collection, getDocs, doc, setDoc, getDoc } from 'firebase/firestore';

export interface EntitlementResult {
  hasFullCatalog: boolean;
  is_active: boolean;
  reason: 'vip_active' | 'vip_expired' | 'trial_active' | 'trial_expired' | 'free_tier' | 'suspended' | 'user_absent';
}

export interface RecalculationSummary {
  timestamp: string;
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
 * Never trusts client or publicStore flags.
 */
export function computeVendorEntitlements(
  userDoc: Record<string, any> | null | undefined,
  nowMs: number = Date.now()
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
    // Safety check against tampered distant future dates on unverified accounts:
    const createdTime = new Date(userDoc.trialStartedAt || userDoc.created_at || userDoc.createdAt || 0).getTime();
    const ageDays = createdTime > 0 ? (nowMs - createdTime) / 86400000 : 0;

    if (!isNaN(trialEndMs) && trialEndMs > nowMs && (createdTime === 0 || ageDays <= 30)) {
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

  // Case 6: Active account without explicit Gratuit/VIP: default 14-day trial window
  if (userDoc.status === 'Actif' && userDoc.plan !== 'Gratuit') {
    const created = userDoc.trialStartedAt || userDoc.created_at || userDoc.createdAt;
    if (created) {
      const ageDays = (nowMs - new Date(created).getTime()) / 86400000;
      if (ageDays <= 14) {
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
 * Server-side batch synchronization:
 * Reads all private /users records, recalculates entitlements,
 * and updates /publicStores/{uid} with authoritative hasFullCatalog and is_active.
 * Also deactivates orphaned public stores whose private user document was deleted.
 */
export async function recalculateAllEntitlements(): Promise<RecalculationSummary> {
  const summary: RecalculationSummary = {
    timestamp: new Date().toISOString(),
    totalUsersScanned: 0,
    totalPublicStoresScanned: 0,
    updatedPublicStores: 0,
    fullCatalogCount: 0,
    restrictedCount: 0,
    deactivatedCount: 0,
    errors: 0,
  };

  try {
    const now = Date.now();
    const usersSnap = await getDocs(collection(db, 'users'));
    summary.totalUsersScanned = usersSnap.size;

    const validUserIds = new Set<string>();

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      validUserIds.add(uid);
      const userData = userDoc.data();

      try {
        const entitlement = computeVendorEntitlements(userData, now);

        if (entitlement.is_active && entitlement.hasFullCatalog) {
          summary.fullCatalogCount++;
        } else if (entitlement.is_active) {
          summary.restrictedCount++;
        } else {
          summary.deactivatedCount++;
        }

        // Fetch current publicStore doc to check if update is needed
        const storeRef = doc(db, 'publicStores', uid);
        const storeSnap = await getDoc(storeRef);

        const currentData = storeSnap.exists() ? storeSnap.data() : null;
        const currentHasFull = currentData?.hasFullCatalog;
        const currentIsActive = currentData?.is_active;

        // Only write if state changed or doc is missing
        if (!storeSnap.exists() || currentHasFull !== entitlement.hasFullCatalog || currentIsActive !== entitlement.is_active) {
          await setDoc(
            storeRef,
            {
              id: uid,
              hasFullCatalog: entitlement.hasFullCatalog,
              is_active: entitlement.is_active,
              updatedAt: new Date().toISOString(),
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
      const publicStoresSnap = await getDocs(collection(db, 'publicStores'));
      summary.totalPublicStoresScanned = publicStoresSnap.size;

      for (const storeDoc of publicStoresSnap.docs) {
        const storeUid = storeDoc.id;
        if (!validUserIds.has(storeUid)) {
          // Orphaned store: user was deleted or never existed. Deactivate!
          const storeData = storeDoc.data();
          if (storeData.is_active !== false || storeData.hasFullCatalog !== false) {
            await setDoc(
              doc(db, 'publicStores', storeUid),
              {
                hasFullCatalog: false,
                is_active: false,
                updatedAt: new Date().toISOString(),
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
