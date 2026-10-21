import { 
  db, 
  auth,
  handleFirestoreError, 
  OperationType,
  doc, 
  collection, 
  setDoc, 
  getDoc, 
  getDocs, 
  updateDoc, 
  deleteDoc,
  query,
  where,
  limit
} from '../firebase';
import { 
  Vendeur, 
  Product, 
  Prospect, 
  SystemConfig, 
  CurrencyType,
  PublicStoreProfile,
  AdminData,
  DailyVisitStat,
  StructuredOrder,
  OrderStatus
} from '../types';

// Default system config fallback
export const DEFAULT_GLOBAL_SETTINGS: SystemConfig = {
  price_vip: 199,
  price_vip_cfa: 12000,
  trial_days: 3,
  whatsapp_support: '+212600000000',
  freeProductLimit: 4,
  trialDays: 3,
  vipPrice: 199,
  vipPriceCfa: 12000,
  supportWhatsapp: '+212600000000',
};

// Firestore may contain ISO strings, Date objects, or Timestamp objects.
function normalizeStoredDate(value: any): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  try {
    let date: Date;
    if (value instanceof Date) date = value;
    else if (typeof value === 'object' && typeof value.toDate === 'function') date = value.toDate();
    else if (typeof value === 'object' && typeof value.seconds === 'number') date = new Date(value.seconds * 1000);
    else if (typeof value === 'object' && typeof value._seconds === 'number') date = new Date(value._seconds * 1000);
    else date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  } catch {
    return undefined;
  }
}

export const FirestoreService = {
  // ----------------------------------------------------
  // 1. SETTINGS / GLOBAL
  // ----------------------------------------------------
  async getGlobalSettings(): Promise<SystemConfig> {
    const docPath = 'settings/global';
    try {
      const snap = await getDoc(doc(db, 'settings', 'global'));
      if (snap && snap.exists()) {
        const data = snap.data();
        const trialDays = 3;
        const vipPrice = Number(data.vipPrice ?? data.price_vip ?? 199);
        const vipPriceCfa = Number(data.vipPriceCfa ?? data.price_vip_cfa ?? 12000);
        const supportWhatsapp = String(data.supportWhatsapp ?? data.whatsapp_support ?? '+212600000000');
        const freeProductLimit = Number(data.freeProductLimit ?? 4);

        return {
          trial_days: trialDays,
          trialDays: trialDays,
          price_vip: vipPrice,
          vipPrice: vipPrice,
          price_vip_cfa: vipPriceCfa,
          vipPriceCfa: vipPriceCfa,
          whatsapp_support: supportWhatsapp,
          supportWhatsapp: supportWhatsapp,
          freeProductLimit: freeProductLimit,
          updatedAt: data.updatedAt,
        };
      }
      return DEFAULT_GLOBAL_SETTINGS;
    } catch (err) {
      console.warn('[FirestoreService] Could not fetch global settings from Firestore, using defaults:', err);
      return DEFAULT_GLOBAL_SETTINGS;
    }
  },

  async updateGlobalSettings(settings: Partial<SystemConfig>): Promise<SystemConfig> {
    const docPath = 'settings/global';
    try {
      const adminEmail = auth.currentUser?.email?.trim().toLowerCase();
      if (adminEmail !== 'foosco80@gmail.com') {
        throw new Error('Action non autorisée : Seul le compte administrateur foosco80@gmail.com peut modifier les paramètres globaux.');
      }

      const payload: Record<string, any> = {
        updatedAt: new Date().toISOString(),
      };
      
      // Enforce bidirectional compatibility for all field aliases
      if (settings.trialDays !== undefined || settings.trial_days !== undefined) {
        const val = Number(settings.trialDays ?? settings.trial_days);
        payload.trialDays = val;
        payload.trial_days = val;
      }
      if (settings.vipPrice !== undefined || settings.price_vip !== undefined) {
        const val = Number(settings.vipPrice ?? settings.price_vip);
        payload.vipPrice = val;
        payload.price_vip = val;
      }
      if (settings.vipPriceCfa !== undefined || settings.price_vip_cfa !== undefined) {
        const val = Number(settings.vipPriceCfa ?? settings.price_vip_cfa);
        payload.vipPriceCfa = val;
        payload.price_vip_cfa = val;
      }
      if (settings.supportWhatsapp !== undefined || settings.whatsapp_support !== undefined) {
        const val = String(settings.supportWhatsapp ?? settings.whatsapp_support ?? '').trim();
        payload.supportWhatsapp = val;
        payload.whatsapp_support = val;
      }
      if (settings.freeProductLimit !== undefined) {
        payload.freeProductLimit = Number(settings.freeProductLimit);
      }

      await setDoc(doc(db, 'settings', 'global'), payload, { merge: true });
      return await this.getGlobalSettings();
    } catch (err) {
      console.error('[FirestoreService] Erreur lors de la mise à jour de settings/global:', err);
      handleFirestoreError(err, OperationType.WRITE, docPath);
    }
  },

  // ----------------------------------------------------
  // 2. USERS / {uid}
  // ----------------------------------------------------
  async getUserProfile(uid: string): Promise<Vendeur | null> {
    const docPath = `users/${uid}`;
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      if (!snap.exists()) {
        return null;
      }
      const d = snap.data();
      const phone = d.whatsappNumber || d.phone || '';
      // Never manufacture a fresh registration/expiry date while reading an old profile:
      // that would silently restart the free trial on every login.
      const createdAt = normalizeStoredDate(d.createdAt) || normalizeStoredDate(d.created_at);
      const trialStartedAt = normalizeStoredDate(d.trialStartedAt) || createdAt;
      const trialEndsAt = normalizeStoredDate(d.trialEndsAt) || normalizeStoredDate(d.date_expiration_essai);
      const vipStartedAt = normalizeStoredDate(d.vipStartedAt);
      const vipEndsAt = normalizeStoredDate(d.vipEndsAt);
      return {
        id: uid,
        uid: uid,
        phone: phone,
        whatsappNumber: phone,
        phoneNormalized: d.phoneNormalized || phone.replace(/\D/g, ''),
        name: d.name || `Boutique ${phone.slice(-4)}`,
        slogan: d.slogan || 'Vente directe sur WhatsApp',
        location: d.location || 'Maroc',
        logo: d.logo || 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=400&q=80',
        currency: (d.currency as CurrencyType) || (phone.startsWith('+212') ? 'MAD' : 'CFA'),
        status: d.status || 'Actif',
        role: d.role || 'seller',
        is_active: d.status !== 'Inactif' && d.status !== 'Suspendu',
        plan: d.plan || 'Essai',
        trialStartedAt,
        trialEndsAt,
        vipStartedAt,
        vipEndsAt,
        publicSlug: d.publicSlug || uid,
        date_expiration_essai: trialEndsAt || '',
        useLoginNumberAsPublic: Boolean(d.useLoginNumberAsPublic),
        commercialWhatsApp: d.commercialWhatsApp || '',
        allowCommercialContact: Boolean(d.allowCommercialContact || d.useLoginNumberAsPublic),
        created_at: createdAt || '',
        createdAt: createdAt,
        updatedAt: d.updatedAt,
        defaultDeliveryFee: Number.isFinite(Number(d.defaultDeliveryFee)) && Number(d.defaultDeliveryFee) >= 0 ? Number(d.defaultDeliveryFee) : 0,
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, docPath);
    }
  },

  async saveUserProfile(uid: string, data: Partial<Vendeur>): Promise<Vendeur> {
    const docPath = `users/${uid}`;
    try {
      const now = new Date().toISOString();
      const phone = data.whatsappNumber || data.phone;
      const phoneNormalized = phone ? phone.replace(/\D/g, '') : undefined;

      const payload: Record<string, any> = {
        uid: uid,
        updatedAt: now,
      };

      if (phone !== undefined) payload.whatsappNumber = phone;
      if (phoneNormalized !== undefined) payload.phoneNormalized = phoneNormalized;
      if (data.name !== undefined) payload.name = data.name;
      if (data.slogan !== undefined) payload.slogan = data.slogan;
      if (data.location !== undefined) payload.location = data.location;
      if (data.logo !== undefined) payload.logo = data.logo;
      if (data.currency !== undefined) payload.currency = data.currency;
      if (data.defaultDeliveryFee !== undefined) {
        const fee = Number(data.defaultDeliveryFee);
        if (!Number.isFinite(fee) || fee < 0 || fee > 1000000) throw new Error('Les frais de livraison doivent être compris entre 0 et 1 000 000.');
        payload.defaultDeliveryFee = Math.round(fee * 100) / 100;
      }
      if (data.publicSlug !== undefined) payload.publicSlug = data.publicSlug;

      // Sensitive subscription & privilege fields:
      // Only the authorized admin (foosco80@gmail.com) can update subscriptions or roles.
      // During initial registration (when data.createdAt is supplied), safe baseline trial values are set.
      const isSuperAdmin = auth.currentUser?.email?.trim().toLowerCase() === 'foosco80@gmail.com';
      const isInitialRegistration = Boolean(data.createdAt);

      if (isSuperAdmin) {
        if (data.role !== undefined) payload.role = data.role;
        if (data.status !== undefined) payload.status = data.status;
        if (data.plan !== undefined) payload.plan = data.plan;
        if (data.trialStartedAt !== undefined) payload.trialStartedAt = data.trialStartedAt;
        if (data.trialEndsAt !== undefined) payload.trialEndsAt = data.trialEndsAt;
        if (data.date_expiration_essai !== undefined) payload.date_expiration_essai = data.date_expiration_essai;
        if (data.vipStartedAt !== undefined) payload.vipStartedAt = data.vipStartedAt;
        if (data.vipEndsAt !== undefined) payload.vipEndsAt = data.vipEndsAt;
        if (data.createdAt !== undefined) payload.createdAt = data.createdAt;
      } else if (isInitialRegistration) {
        // Enforce safe initial trial defaults only; no admin or VIP self-assignment
        payload.role = 'seller';
        payload.status = 'Actif';
        payload.plan = 'Essai';
        if (data.trialStartedAt !== undefined) payload.trialStartedAt = data.trialStartedAt;
        if (data.trialEndsAt !== undefined) payload.trialEndsAt = data.trialEndsAt;
        if (data.date_expiration_essai !== undefined) payload.date_expiration_essai = data.date_expiration_essai;
        if (data.createdAt !== undefined) payload.createdAt = data.createdAt;
      }

      if (data.useLoginNumberAsPublic !== undefined) payload.useLoginNumberAsPublic = Boolean(data.useLoginNumberAsPublic);
      if (data.commercialWhatsApp !== undefined) payload.commercialWhatsApp = data.commercialWhatsApp;
      if (data.allowCommercialContact !== undefined) payload.allowCommercialContact = Boolean(data.allowCommercialContact);

      await setDoc(doc(db, 'users', uid), payload, { merge: true });
      const updated = await this.getUserProfile(uid);
      if (updated) {
        // Automatically synchronize the isolated public profile at publicStores/{uid}
        try {
          await this.syncPublicStore(uid, updated);
        } catch (syncErr) {
          console.warn(`[FirestoreService] Background sync to publicStores/${uid} failed:`, syncErr);
        }
      }
      return updated!;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, docPath);
    }
  },

  // ----------------------------------------------------
  // 2b. PUBLIC STORE PROFILE (/publicStores/{uid})
  // Strictly Sanitized: No private login phone, no CRM, no auth data, no internal subscription timestamps
  // ----------------------------------------------------
  sanitizePublicStore(uid: string, d: Record<string, any>, configuredTrialDays: number = 3): PublicStoreProfile {
    // 0. Handle absent or empty private vendor document
    const isDocAbsent = !d || Object.keys(d).length === 0;
    if (isDocAbsent) {
      return {
        id: uid,
        name: `Boutique`,
        slogan: '',
        location: '',
        logo: '',
        currency: (d?.currency as CurrencyType) || 'MAD',
        is_active: false,
        hasFullCatalog: false,
        isVipActive: false,
        publicSlug: uid,
        orderWhatsApp: undefined,
        allowCommercialContact: false,
        defaultDeliveryFee: 0,
      };
    }

    // 1. Calculate minimal catalog activation info:
    // Determine if full catalog is allowed or restricted to 4 products without exposing internal dates or plans.
    // Suspended or inactive accounts are strictly deactivated (is_active: false, hasFullCatalog: false).
    const isSuspended = d.status === 'Inactif' || d.status === 'Suspendu' || d.is_active === false;
    const vipEnd = normalizeStoredDate(d.vipEndsAt);
    const hasPrivateSubscriptionFields = ('status' in d) || ('plan' in d);
    const isVipActive = !isSuspended && (
      hasPrivateSubscriptionFields
        ? (d.status === 'VIP' || d.plan === 'VIP') && (!vipEnd || new Date(vipEnd).getTime() > Date.now())
        : d.isVipActive === true
    );
    const isVip = (d.status === 'VIP' || d.plan === 'VIP') && !isSuspended;
    let fullCatalog = false;

    if (isSuspended) {
      fullCatalog = false;
    } else if (isVip) {
      // Reuse the normalized active-VIP decision so Firestore Timestamp and ISO dates behave consistently.
      fullCatalog = isVipActive;
    } else if (d.plan === 'Gratuit' || d.status === 'Gratuit') {
      fullCatalog = false;
    } else if (d.trialStartedAt || d.createdAt || d.created_at || d.trialEndsAt || d.date_expiration_essai) {
      // The trial start plus the fixed duration takes precedence over stale legacy expiration fields.
      const trialStart = d.trialStartedAt || d.createdAt || d.created_at;
      const storedTrialEnd = d.trialEndsAt || d.date_expiration_essai;
      const startMs = trialStart ? new Date(trialStart).getTime() : Number.NaN;
      const storedEndMs = storedTrialEnd ? new Date(storedTrialEnd).getTime() : Number.NaN;
      const trialEndMs = Number.isFinite(startMs)
        ? startMs + configuredTrialDays * 86400000
        : storedEndMs;
      fullCatalog = Number.isFinite(trialEndMs) && trialEndMs > Date.now();
    } else if (typeof d.hasFullCatalog === 'boolean' && !('status' in d) && !('plan' in d)) {
      // Reading from an already verified /publicStores document
      fullCatalog = d.hasFullCatalog;
    } else {
      fullCatalog = false;
    }

    // COMMERCIAL CONTACT IS ONLY EXPOSED IF EXPLICITLY PROVIDED AND ALLOWED:
    // 1. Merchant explicitly opted-in: "Utiliser mon numéro WhatsApp de connexion comme contact commercial public"
    let orderContact: string | undefined = undefined;
    if (d.useLoginNumberAsPublic === true) {
      const regPhone = d.whatsappNumber || d.phone || '';
      const digits = String(regPhone).replace(/\D/g, '');
      if (digits.length >= 6) {
        orderContact = regPhone;
      }
    }
    // 2. Or merchant explicitly provided and authorized a distinct commercial WhatsApp number
    else if (d.allowCommercialContact && d.commercialWhatsApp) {
      const digits = String(d.commercialWhatsApp).replace(/\D/g, '');
      if (digits.length >= 6) {
        orderContact = d.commercialWhatsApp;
      }
    } else if (d.orderWhatsApp) {
      const digits = String(d.orderWhatsApp).replace(/\D/g, '');
      if (digits.length >= 6) {
        orderContact = d.orderWhatsApp;
      }
    }

    return {
      id: uid,
      name: d.name || `Boutique ${uid.slice(-4)}`,
      slogan: d.slogan || 'Vente directe & service rapide',
      location: d.location || 'Maroc',
      logo: d.logo || 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=400&q=80',
      currency: (d.currency as CurrencyType) || 'MAD',
      is_active: !isSuspended && d.is_active !== false,
      hasFullCatalog: fullCatalog,
      isVipActive,
      publicSlug: d.publicSlug || uid,
      orderWhatsApp: orderContact,
      allowCommercialContact: Boolean(orderContact),
      defaultDeliveryFee: Number.isFinite(Number(d.defaultDeliveryFee)) && Number(d.defaultDeliveryFee) >= 0 && Number(d.defaultDeliveryFee) <= 1000000 ? Math.round(Number(d.defaultDeliveryFee) * 100) / 100 : 0,
    };
  },

  /**
   * Merchant-side storefront synchronization:
   * Updates ONLY commercial public presentation fields: name, slogan, location, logo, currency, publicSlug, orderWhatsApp, allowCommercialContact.
   * NEVER alters hasFullCatalog or is_active (guaranteed by omitting them from payload).
   */
  async syncMerchantPublicProfile(uid: string, userDoc: Record<string, any>): Promise<PublicStoreProfile> {
    try {
      const sanitized = this.sanitizePublicStore(uid, userDoc);
      const payload: Record<string, any> = {
        id: uid,
        name: sanitized.name,
        slogan: sanitized.slogan,
        location: sanitized.location,
        logo: sanitized.logo,
        currency: sanitized.currency,
        publicSlug: sanitized.publicSlug,
        orderWhatsApp: sanitized.orderWhatsApp || null,
        allowCommercialContact: Boolean(sanitized.allowCommercialContact),
        defaultDeliveryFee: sanitized.defaultDeliveryFee ?? 0,
        updatedAt: new Date().toISOString(),
      };

      await setDoc(doc(db, 'publicStores', uid), payload, { merge: true });
      return sanitized;
    } catch (err) {
      console.warn(`[FirestoreService] Erreur lors de la mise à jour marchande de publicStores/${uid}:`, err);
      return this.sanitizePublicStore(uid, userDoc);
    }
  },

  /**
   * Administrator-side public store synchronization:
   * Strictly computes entitlements (hasFullCatalog, is_active) from reliable private user records
   * and replaces the document entirely (without merge: true) to purge any obsolete sensitive fields
   * (plan, trialStartedAt, trialEndsAt, date_expiration_essai, vipEndsAt, phone, role)
   * while preserving legitimate public store presentation data.
   */
  async syncAdminPublicStore(uid: string, userDoc: Record<string, any>): Promise<PublicStoreProfile> {
    try {
      const sanitized = this.sanitizePublicStore(uid, userDoc);
      const payload: Record<string, any> = {
        id: uid,
        name: sanitized.name,
        slogan: sanitized.slogan,
        location: sanitized.location,
        logo: sanitized.logo,
        currency: sanitized.currency,
        is_active: sanitized.is_active ?? true,
        hasFullCatalog: sanitized.hasFullCatalog ?? false,
        isVipActive: sanitized.isVipActive ?? false,
        publicSlug: sanitized.publicSlug,
        orderWhatsApp: sanitized.orderWhatsApp || null,
        allowCommercialContact: Boolean(sanitized.allowCommercialContact),
        defaultDeliveryFee: sanitized.defaultDeliveryFee ?? 0,
        updatedAt: new Date().toISOString(),
      };

      // Set document without merge: true to purge obsolete sensitive keys
      await setDoc(doc(db, 'publicStores', uid), payload);
      return sanitized;
    } catch (err) {
      console.warn(`[FirestoreService] Erreur lors de la synchronisation administrative de publicStores/${uid}:`, err);
      return this.sanitizePublicStore(uid, userDoc);
    }
  },

  /**
   * Synchronizes public store info:
   * Delegates to admin entitlement sync if caller is platform admin,
   * otherwise delegates to safe merchant commercial profile sync (preserving entitlements).
   */
  async syncPublicStore(uid: string, userDoc: Record<string, any>): Promise<PublicStoreProfile> {
    const isAdmin = auth.currentUser?.email?.trim().toLowerCase() === 'foosco80@gmail.com';
    if (isAdmin) {
      return this.syncAdminPublicStore(uid, userDoc);
    } else {
      return this.syncMerchantPublicProfile(uid, userDoc);
    }
  },

  /**
   * Reads public store profile strictly from dedicated /publicStores/{uid} or by publicSlug.
   * Anonymous catalog visitors ONLY query publicStores and NEVER access private users/ collection.
   */
  async getPublicStoreProfile(uidOrSlug: string): Promise<PublicStoreProfile | null> {
    const cleanId = uidOrSlug.trim();
    if (!cleanId) return null;

    // 1. Direct lookup in publicStores/{cleanId} (Public Collection)
    try {
      const snap = await getDoc(doc(db, 'publicStores', cleanId));
      if (snap.exists()) {
        const d = snap.data();
        return this.sanitizePublicStore(cleanId, d);
      }
    } catch {
      // Continue to query by publicSlug
    }

    // 2. Lookup in publicStores by publicSlug query
    try {
      const q = query(
        collection(db, 'publicStores'),
        where('publicSlug', '==', cleanId),
        limit(1)
      );
      const querySnap = await getDocs(q);
      if (!querySnap.empty) {
        const docSnap = querySnap.docs[0];
        return this.sanitizePublicStore(docSnap.id, docSnap.data());
      }
    } catch {
      // Query failed or not found
    }

    // 3. Fallback for authenticated owner or authorized platform admin ONLY:
    // If an authenticated merchant is previewing their own un-migrated store (or platform admin is checking it),
    // heal/sync it from users/{cleanId} into publicStores/{cleanId}.
    // Anonymous public visitors NEVER attempt prohibited reads to users/ to prevent permission-denied errors.
    const currentUser = auth.currentUser;
    const isOwner = currentUser && currentUser.uid === cleanId;
    const isAdmin = currentUser && currentUser.email?.trim().toLowerCase() === 'foosco80@gmail.com';

    if (isOwner || isAdmin) {
      try {
        const snapUser = await getDoc(doc(db, 'users', cleanId));
        if (snapUser.exists()) {
          const d = snapUser.data();
          const sanitized = this.sanitizePublicStore(cleanId, d);
          this.syncPublicStore(cleanId, d).catch(() => {});
          return sanitized;
        }
      } catch {
        // Ignored
      }

      try {
        const qUser = query(
          collection(db, 'users'),
          where('publicSlug', '==', cleanId),
          limit(1)
        );
        const querySnapUser = await getDocs(qUser);
        if (!querySnapUser.empty) {
          const docSnap = querySnapUser.docs[0];
          const sanitized = this.sanitizePublicStore(docSnap.id, docSnap.data());
          this.syncPublicStore(docSnap.id, docSnap.data()).catch(() => {});
          return sanitized;
        }
      } catch {
        // Ignored
      }
    }

    return null;
  },

  /**
   * Non-destructive migration of all existing merchants from users/ to publicStores/.
   * Strictly preserves existing data while creating the sanitized public store docs.
   */
  async migrateAllVendorsToPublicStores(): Promise<{ total: number; migrated: number; errors: number }> {
    try {
      const snap = await getDocs(collection(db, 'users'));
      let migrated = 0;
      let errors = 0;

      for (const d of snap.docs) {
        try {
          await this.syncAdminPublicStore(d.id, d.data());
          migrated++;
        } catch (e) {
          console.error(`[FirestoreService] Migration error for user ${d.id}:`, e);
          errors++;
        }
      }

      return { total: snap.size, migrated, errors };
    } catch (err) {
      console.error('[FirestoreService] Migration batch failed:', err);
      return { total: 0, migrated: 0, errors: 1 };
    }
  },

  /**
   * Recalculates subscription entitlements for all merchants from the private users/ collection
   * and synchronizes hasFullCatalog and is_active to publicStores/.
   * Strictly enforces trial and VIP expiration: drops hasFullCatalog to false once trialEndsAt or vipEndsAt is passed.
   */
  async recalculateAllVendorsEntitlements(): Promise<{
    total: number;
    updated: number;
    fullCatalog: number;
    restricted: number;
    suspended: number;
    errors: number;
  }> {
    try {
      const snap = await getDocs(collection(db, 'users'));
      const dynamicTrialDays = 3;

      let updated = 0;
      let fullCatalog = 0;
      let restricted = 0;
      let suspended = 0;
      let errors = 0;

      for (const d of snap.docs) {
        try {
          const userData = d.data();
          const sanitized = this.sanitizePublicStore(d.id, userData, dynamicTrialDays);

          if (sanitized.is_active && sanitized.hasFullCatalog) {
            fullCatalog++;
          } else if (sanitized.is_active) {
            restricted++;
          } else {
            suspended++;
          }

          // Fetch current publicStore doc to check if update is needed
          const storeRef = doc(db, 'publicStores', d.id);
          const storeSnap = await getDoc(storeRef);

          if (!storeSnap.exists() ||
              storeSnap.data().hasFullCatalog !== sanitized.hasFullCatalog ||
              storeSnap.data().is_active !== sanitized.is_active ||
              storeSnap.data().isVipActive !== sanitized.isVipActive) {
            await setDoc(storeRef, {
              id: d.id,
              name: sanitized.name,
              slogan: sanitized.slogan,
              location: sanitized.location,
              logo: sanitized.logo,
              currency: sanitized.currency,
              is_active: sanitized.is_active,
              hasFullCatalog: sanitized.hasFullCatalog,
              isVipActive: sanitized.isVipActive ?? false,
              publicSlug: sanitized.publicSlug,
              orderWhatsApp: sanitized.orderWhatsApp || null,
              allowCommercialContact: Boolean(sanitized.allowCommercialContact),
              updatedAt: new Date().toISOString(),
            }, { merge: true });
            updated++;
          }
        } catch (e) {
          console.error(`[FirestoreService] Recalculation error for user ${d.id}:`, e);
          errors++;
        }
      }

      return { total: snap.size, updated, fullCatalog, restricted, suspended, errors };
    } catch (err) {
      console.error('[FirestoreService] Recalculate batch failed:', err);
      return { total: 0, updated: 0, fullCatalog: 0, restricted: 0, suspended: 0, errors: 1 };
    }
  },

  // ----------------------------------------------------
  // 3. USERS / {uid} / PRODUCTS / {productId}
  // ----------------------------------------------------
  async getUserProducts(uid: string): Promise<Product[]> {
    const colPath = `users/${uid}/products`;
    try {
      const snap = await getDocs(collection(db, 'users', uid, 'products'));
      const prods: Product[] = [];
      snap.forEach(d => {
        const data = d.data();
        prods.push({
          id: d.id,
          vendeur_id: uid,
          name: data.name || 'Produit',
          price: Number(data.price || 0),
          original_price: data.original_price ? Number(data.original_price) : undefined,
          description: data.description || '',
          images: Array.isArray(data.images) && data.images.length > 0 ? data.images : ['https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=80'],
          category: data.category || 'Général',
          clicks: Number(data.clicks || 0),
          created_at: data.createdAt || data.created_at || new Date().toISOString(),
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        });
      });
      return prods;
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, colPath);
    }
  },

  async saveUserProduct(uid: string, product: Omit<Product, 'id' | 'vendeur_id' | 'created_at'> & { id?: string; created_at?: string; createdAt?: string }): Promise<Product> {
    const prodId = product.id || `prod_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const docPath = `users/${uid}/products/${prodId}`;
    try {
      // 1. Verify vendor status from reliable private profile
      const userDoc = await this.getUserProfile(uid);
      if (userDoc) {
        if (userDoc.status === 'Inactif' || userDoc.status === 'Suspendu') {
          throw new Error("Opération impossible : Votre boutique est suspendue ou inactive.");
        }

        const isNewProduct = !product.id;
        if (isNewProduct) {
          const isVip = userDoc.status === 'VIP' || userDoc.plan === 'VIP';
          const isTrialValid = (userDoc.trialEndsAt || userDoc.date_expiration_essai)
            ? new Date(userDoc.trialEndsAt || userDoc.date_expiration_essai).getTime() > Date.now()
            : (userDoc.status === 'Actif' && userDoc.plan !== 'Gratuit');
          const hasUnlimited = isVip || isTrialValid;

          if (!hasUnlimited) {
            const currentProducts = await this.getUserProducts(uid);
            if (currentProducts.length >= 4) {
              throw new Error("Plafond atteint : Le mode Gratuit est limité à 4 produits maximum. Passez au pack VIP pour débloquer l'ajout illimité.");
            }
          }
        }
      }

      const now = new Date().toISOString();
      const payload = {
        id: prodId,
        vendeur_id: uid,
        name: product.name,
        price: Number(product.price || 0),
        original_price: product.original_price ? Number(product.original_price) : null,
        description: product.description || '',
        images: product.images && product.images.length > 0 ? product.images : [],
        category: product.category || 'Général',
        clicks: product.clicks || 0,
        createdAt: product.createdAt || product.created_at || now,
        updatedAt: now,
      };

      await setDoc(doc(db, 'users', uid, 'products', prodId), payload, { merge: true });
      return {
        ...payload,
        created_at: payload.createdAt,
        original_price: payload.original_price || undefined,
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, docPath);
    }
  },

  async deleteUserProduct(uid: string, productId: string): Promise<boolean> {
    const docPath = `users/${uid}/products/${productId}`;
    try {
      await deleteDoc(doc(db, 'users', uid, 'products', productId));
      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, docPath);
    }
  },

  // ----------------------------------------------------
  // 4. USERS / {uid} / PROSPECTS / {prospectId}
  // ----------------------------------------------------
  async getUserProspects(uid: string): Promise<Prospect[]> {
    const colPath = `users/${uid}/prospects`;
    try {
      const snap = await getDocs(collection(db, 'users', uid, 'prospects'));
      const prospects: Prospect[] = [];
      snap.forEach(d => {
        const data = d.data();
        prospects.push({
          id: d.id,
          vendeur_id: uid,
          name: data.name || 'Prospect',
          phone: data.phone || '',
          notes: data.notes || '',
          status: data.status || 'Nouveau',
          created_at: data.createdAt || data.created_at || new Date().toISOString(),
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          last_contact: data.last_contact,
        });
      });
      return prospects;
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, colPath);
    }
  },

  async saveUserProspect(uid: string, prospect: Omit<Prospect, 'id' | 'vendeur_id' | 'created_at'> & { id?: string; created_at?: string; createdAt?: string }): Promise<Prospect> {
    const prospId = prospect.id || `prosp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const docPath = `users/${uid}/prospects/${prospId}`;
    try {
      const now = new Date().toISOString();
      const payload = {
        id: prospId,
        vendeur_id: uid,
        name: prospect.name,
        phone: prospect.phone,
        notes: prospect.notes || '',
        status: prospect.status || 'Nouveau',
        createdAt: prospect.createdAt || prospect.created_at || now,
        updatedAt: now,
        last_contact: prospect.last_contact || null,
      };

      await setDoc(doc(db, 'users', uid, 'prospects', prospId), payload, { merge: true });
      return {
        ...payload,
        created_at: payload.createdAt,
        last_contact: payload.last_contact || undefined,
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, docPath);
    }
  },

  async deleteUserProspect(uid: string, prospectId: string): Promise<boolean> {
    const docPath = `users/${uid}/prospects/${prospectId}`;
    try {
      await deleteDoc(doc(db, 'users', uid, 'prospects', prospectId));
      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, docPath);
    }
  },

  // ----------------------------------------------------
  // 5. USERS / {uid} / ORDERS / {orderId}
  // ----------------------------------------------------
  async getUserOrders(uid: string): Promise<StructuredOrder[]> {
    const colPath = `users/${uid}/orders`;
    try {
      const snap = await getDocs(collection(db, 'users', uid, 'orders'));
      const orders: StructuredOrder[] = [];
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        orders.push({
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
          status: (data.status || 'Nouveau') as OrderStatus,
          createdAt: normalizeStoredDate(data.createdAt) || '',
          updatedAt: normalizeStoredDate(data.updatedAt) || normalizeStoredDate(data.createdAt) || '',
          notes: typeof data.notes === 'string' ? data.notes : undefined,
        });
      });
      return orders.sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime() || 0;
        const dateB = new Date(b.createdAt).getTime() || 0;
        return dateB - dateA;
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, colPath);
    }
  },

  async updateUserOrderStatus(uid: string, orderId: string, status: OrderStatus): Promise<void> {
    const docPath = `users/${uid}/orders/${orderId}`;
    const allowedStatuses: OrderStatus[] = ['Nouveau', 'Confirmée', 'En préparation', 'Expédiée', 'Livrée', 'Annulée'];
    if (!allowedStatuses.includes(status)) {
      throw new Error('Statut de commande invalide.');
    }
    try {
      await updateDoc(doc(db, 'users', uid, 'orders', orderId), {
        status,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, docPath);
    }
  },

  // ----------------------------------------------------
  // 5. ANALYTICS / {eventId}
  // ----------------------------------------------------
  async logAnalyticsEvent(event: {
    vendeur_id: string;
    type: 'view' | 'product_click' | 'conversion';
    productId?: string;
  }): Promise<void> {
    const eventId = `ev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const docPath = `analytics/${eventId}`;
    try {
      await setDoc(doc(db, 'analytics', eventId), {
        id: eventId,
        vendeur_id: event.vendeur_id,
        type: event.type,
        productId: event.productId || null,
        source: 'public_store_v1',
        // Only events emitted after the verified-tracking rollout count as real analytics.
        verifiedTracking: true,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      // Do not silently convert a failed write into a "successful" no-op.
      console.error('[Analytics] Échec de l’enregistrement Firestore:', err);
      throw err;
    }
  },

  async getDailyAnalytics(vendeur: Vendeur, days: number = 7): Promise<DailyVisitStat[]> {
    const cleanId = (vendeur.id || vendeur.uid || '').trim();
    const now = new Date();
    const dateKeys: string[] = [];
    const dailyMap: Record<string, { views: number; clicks: number; conversions: number }> = {};

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      dateKeys.push(key);
      dailyMap[key] = { views: 0, clicks: 0, conversions: 0 };
    }

    try {
      if (cleanId) {
        const q = query(
          collection(db, 'analytics'),
          where('vendeur_id', '==', cleanId)
        );
        const snap = await getDocs(q);
        snap.forEach(docSnap => {
          const ev = docSnap.data();
          // Ignore legacy/demo telemetry created before source-tagged real tracking.
          if (ev.source !== 'public_store_v1' || ev.verifiedTracking !== true) return;
          const evDate = (ev.timestamp || '').slice(0, 10);
          if (dailyMap[evDate]) {
            if (ev.type === 'view') dailyMap[evDate].views++;
            else if (ev.type === 'product_click' || ev.type === 'click') dailyMap[evDate].clicks++;
            else if (ev.type === 'conversion') dailyMap[evDate].conversions++;
          }
        });
      }
    } catch (err) {
      console.error('[FirestoreService] Lecture des statistiques impossible:', err);
      throw err;
    }

    // Only show recorded events. Never invent historical daily distributions.

    return dateKeys.map(key => {
      const parts = key.split('-');
      const dObj = new Date(key + 'T12:00:00Z');
      const dayName = dObj.toLocaleDateString('fr-FR', { weekday: 'short' });
      const dayNum = parts[2];
      const monthName = dObj.toLocaleDateString('fr-FR', { month: 'short' });

      return {
        fullDate: key,
        date: `${dayName} ${dayNum}`,
        displayDate: `${dayNum} ${monthName}`,
        views: dailyMap[key].views,
        clicks: dailyMap[key].clicks,
        conversions: dailyMap[key].conversions,
      };
    });
  },

  // ----------------------------------------------------
  // 6. ADMIN PORTAL DATA & ACTIONS (users list, KPI metrics, account cleanup)
  // ----------------------------------------------------
  async getAdminData(): Promise<AdminData> {
    const colPath = 'users';
    try {
      const adminEmail = auth.currentUser?.email?.trim().toLowerCase();
      if (adminEmail !== 'foosco80@gmail.com') {
        throw new Error('Action non autorisée : Seul le compte administrateur foosco80@gmail.com peut accéder à la liste des vendeurs.');
      }

      // 1. Fetch real vendor documents from 'users' collection (protected by isAdmin() rule)
      const usersSnap = await getDocs(collection(db, 'users'));
      const rawVendors: Vendeur[] = [];

      usersSnap.forEach((docSnap) => {
        const d = docSnap.data();
        const rawId = docSnap.id;
        const phone = String(d.whatsappNumber || d.phone || '');
        const phoneNormalized = d.phoneNormalized || phone.replace(/\D/g, '');

        rawVendors.push({
          id: rawId,
          uid: d.uid || rawId,
          phone: phone,
          whatsappNumber: phone,
          phoneNormalized: phoneNormalized,
          name: d.name || `Boutique ${phoneNormalized.slice(-4) || rawId.slice(0, 6)}`,
          slogan: d.slogan || 'Vente directe sur WhatsApp',
          location: d.location || 'Maroc',
          logo: d.logo || 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=400&q=80',
          currency: (d.currency as CurrencyType) || (phone.startsWith('+212') ? 'MAD' : 'CFA'),
          status: d.status || (d.is_active === false ? 'Inactif' : 'Actif'),
          role: d.role || 'seller',
          is_active: d.is_active !== undefined ? Boolean(d.is_active) : (d.status !== 'Inactif'),
          plan: d.plan || (d.status === 'VIP' ? 'VIP' : 'Essai'),
          trialStartedAt: d.trialStartedAt || d.createdAt,
          trialEndsAt: d.trialEndsAt || d.date_expiration_essai,
          vipStartedAt: d.vipStartedAt,
          vipEndsAt: d.vipEndsAt,
          publicSlug: d.publicSlug || rawId,
          date_expiration_essai: d.trialEndsAt || d.date_expiration_essai || '',
          useLoginNumberAsPublic: Boolean(d.useLoginNumberAsPublic),
          commercialWhatsApp: d.commercialWhatsApp || '',
          allowCommercialContact: Boolean(d.allowCommercialContact || d.useLoginNumberAsPublic),
          created_at: d.createdAt || d.created_at || new Date().toISOString(),
          createdAt: d.createdAt || d.created_at || new Date().toISOString(),
          updatedAt: d.updatedAt,
          views: Number(d.views || 0),
          product_clicks: Number(d.product_clicks || 0),
          conversions: Number(d.conversions || 0),
        });
      });

      // 2. Fetch product count across registered vendors
      let totalProducts = 0;
      const productPromises = rawVendors.map(async (v) => {
        try {
          const snap = await getDocs(collection(db, 'users', v.id, 'products'));
          return snap.size;
        } catch {
          return 0;
        }
      });
      const prodResults = await Promise.allSettled(productPromises);
      prodResults.forEach((res) => {
        if (res.status === 'fulfilled') {
          totalProducts += res.value;
        }
      });

      // 3. Compute KPI metrics (views, conversions)
      let totalViews = 0;
      let totalConversions = 0;
      for (const v of rawVendors) {
        totalViews += Number(v.views || 0);
        totalConversions += Number(v.conversions || 0);
      }

      // Check analytics telemetry if accessible
      try {
        const analyticsSnap = await getDocs(collection(db, 'analytics'));
        if (!analyticsSnap.empty) {
          let aViews = 0;
          let aConversions = 0;
          analyticsSnap.forEach((d) => {
            const ev = d.data();
            if (ev?.type === 'view') aViews++;
            if (ev?.type === 'conversion') aConversions++;
          });
          totalViews = Math.max(totalViews, aViews);
          totalConversions = Math.max(totalConversions, aConversions);
        }
      } catch {
        // Analytics telemetry is optional
      }

      return {
        total_vendeurs: rawVendors.length,
        total_products: totalProducts,
        total_views: totalViews,
        total_conversions: totalConversions,
        vendeurs: rawVendors,
      };
    } catch (err) {
      console.error('[FirestoreService] Erreur lors de la récupération des vendeurs / admin data:', err);
      handleFirestoreError(err, OperationType.LIST, colPath);
    }
  },

  async deleteUserAccount(uid: string): Promise<boolean> {
    const docPath = `users/${uid}`;
    try {
      const adminEmail = auth.currentUser?.email?.trim().toLowerCase();
      if (adminEmail !== 'foosco80@gmail.com') {
        throw new Error('Action non autorisée : Seul le compte administrateur foosco80@gmail.com peut supprimer un compte.');
      }

      // 1. Delete products subcollection
      try {
        const prods = await getDocs(collection(db, 'users', uid, 'products'));
        await Promise.all(prods.docs.map((d) => deleteDoc(d.ref)));
      } catch (e) {
        console.warn(`[FirestoreService] Could not clean products for ${uid}:`, e);
      }
      // 2. Delete prospects subcollection
      try {
        const prosps = await getDocs(collection(db, 'users', uid, 'prospects'));
        await Promise.all(prosps.docs.map((d) => deleteDoc(d.ref)));
      } catch (e) {
        console.warn(`[FirestoreService] Could not clean prospects for ${uid}:`, e);
      }
      // 3. Delete publicStores document
      try {
        await deleteDoc(doc(db, 'publicStores', uid));
      } catch (e) {
        console.warn(`[FirestoreService] Could not clean publicStore for ${uid}:`, e);
      }
      // 4. Delete user document
      await deleteDoc(doc(db, 'users', uid));
      return true;
    } catch (err) {
      console.error(`[FirestoreService] Erreur lors de la suppression du compte ${uid}:`, err);
      handleFirestoreError(err, OperationType.DELETE, docPath);
    }
  },

  async purgeDemoVendors(): Promise<AdminData> {
    try {
      const snap = await getDocs(collection(db, 'users'));
      for (const d of snap.docs) {
        const id = d.id;
        if (id.startsWith('DEMO-') || id === 'VEND-000' || id.includes('demo') || id.includes('test-example')) {
          await this.deleteUserAccount(id);
        }
      }
      // Clean up publicStores demo documents
      try {
        const publicSnap = await getDocs(collection(db, 'publicStores'));
        for (const pd of publicSnap.docs) {
          const pid = pd.id;
          if (pid.startsWith('DEMO-') || pid === 'VEND-000' || pid.includes('demo') || pid.includes('test-example')) {
            await deleteDoc(pd.ref);
          }
        }
      } catch (pe) {
        console.warn('[FirestoreService] Could not clean demo publicStores:', pe);
      }
      return await this.getAdminData();
    } catch (err) {
      console.error('[FirestoreService] Erreur purge demo accounts:', err);
      handleFirestoreError(err, OperationType.DELETE, 'users/demo');
    }
  }
};
