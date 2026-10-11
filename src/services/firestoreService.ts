import { 
  db, 
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
  PublicStoreProfile
} from '../types';

// Default system config fallback
export const DEFAULT_GLOBAL_SETTINGS: SystemConfig = {
  price_vip: 199,
  price_vip_cfa: 12000,
  trial_days: 7,
  whatsapp_support: '+212600000000',
  freeProductLimit: 4,
  trialDays: 7,
  vipPrice: 199,
  vipPriceCfa: 12000,
  supportWhatsapp: '+212600000000',
};

export const FirestoreService = {
  // ----------------------------------------------------
  // 1. SETTINGS / GLOBAL
  // ----------------------------------------------------
  async getGlobalSettings(): Promise<SystemConfig> {
    const docPath = 'settings/global';
    try {
      const fetchPromise = getDoc(doc(db, 'settings', 'global'));
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000));
      const snap = await Promise.race([fetchPromise, timeoutPromise]);
      if (snap && snap.exists()) {
        const data = snap.data();
        return {
          price_vip: data.vipPrice ?? data.price_vip ?? 199,
          price_vip_cfa: data.vipPriceCfa ?? data.price_vip_cfa ?? 12000,
          trial_days: data.trialDays ?? data.trial_days ?? 7,
          whatsapp_support: data.supportWhatsapp ?? data.whatsapp_support ?? '+212600000000',
          freeProductLimit: data.freeProductLimit ?? 4,
          trialDays: data.trialDays ?? 7,
          vipPrice: data.vipPrice ?? 199,
          vipPriceCfa: data.vipPriceCfa ?? 12000,
          supportWhatsapp: data.supportWhatsapp ?? '+212600000000',
          updatedAt: data.updatedAt,
        };
      }
      return DEFAULT_GLOBAL_SETTINGS;
    } catch (err) {
      console.warn('Could not fetch global settings from Firestore, using defaults:', err);
      return DEFAULT_GLOBAL_SETTINGS;
    }
  },

  async updateGlobalSettings(settings: Partial<SystemConfig>): Promise<SystemConfig> {
    const docPath = 'settings/global';
    try {
      const payload: Record<string, any> = {
        updatedAt: new Date().toISOString(),
      };
      if (settings.trialDays !== undefined) payload.trialDays = settings.trialDays;
      if (settings.trial_days !== undefined) payload.trialDays = settings.trial_days;
      if (settings.vipPrice !== undefined) payload.vipPrice = settings.vipPrice;
      if (settings.price_vip !== undefined) payload.vipPrice = settings.price_vip;
      if (settings.vipPriceCfa !== undefined) payload.vipPriceCfa = settings.vipPriceCfa;
      if (settings.price_vip_cfa !== undefined) payload.vipPriceCfa = settings.price_vip_cfa;
      if (settings.supportWhatsapp !== undefined) payload.supportWhatsapp = settings.supportWhatsapp;
      if (settings.whatsapp_support !== undefined) payload.supportWhatsapp = settings.whatsapp_support;
      if (settings.freeProductLimit !== undefined) payload.freeProductLimit = settings.freeProductLimit;

      await setDoc(doc(db, 'settings', 'global'), payload, { merge: true });
      return await this.getGlobalSettings();
    } catch (err) {
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
        trialStartedAt: d.trialStartedAt || d.createdAt,
        trialEndsAt: d.trialEndsAt || d.date_expiration_essai,
        vipStartedAt: d.vipStartedAt,
        vipEndsAt: d.vipEndsAt,
        publicSlug: d.publicSlug || uid,
        date_expiration_essai: d.trialEndsAt || d.date_expiration_essai || new Date(Date.now() + 7 * 86400000).toISOString(),
        useLoginNumberAsPublic: Boolean(d.useLoginNumberAsPublic),
        commercialWhatsApp: d.commercialWhatsApp || '',
        allowCommercialContact: Boolean(d.allowCommercialContact || d.useLoginNumberAsPublic),
        created_at: d.createdAt || d.created_at || new Date().toISOString(),
        createdAt: d.createdAt || new Date().toISOString(),
        updatedAt: d.updatedAt,
      };
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, docPath);
    }
  },

  async saveUserProfile(uid: string, data: Partial<Vendeur>): Promise<Vendeur> {
    const docPath = `users/${uid}`;
    try {
      const now = new Date().toISOString();
      const phone = data.whatsappNumber || data.phone || '';
      const phoneNormalized = phone.replace(/\D/g, '');

      const payload: Record<string, any> = {
        uid: uid,
        whatsappNumber: phone,
        phoneNormalized: phoneNormalized,
        role: data.role || 'seller',
        status: data.status || 'Actif',
        plan: data.plan || (data.status === 'VIP' ? 'VIP' : 'Essai'),
        publicSlug: data.publicSlug || uid,
        name: data.name || `Boutique ${phoneNormalized.slice(-4)}`,
        slogan: data.slogan || 'Vente directe sur WhatsApp',
        location: data.location || 'Casablanca, Maroc',
        logo: data.logo || 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=400&q=80',
        currency: data.currency || (phone.startsWith('+212') ? 'MAD' : 'CFA'),
        updatedAt: now,
      };

      if (data.useLoginNumberAsPublic !== undefined) payload.useLoginNumberAsPublic = Boolean(data.useLoginNumberAsPublic);
      if (data.commercialWhatsApp !== undefined) payload.commercialWhatsApp = data.commercialWhatsApp;
      if (data.allowCommercialContact !== undefined) payload.allowCommercialContact = Boolean(data.allowCommercialContact);
      if (data.trialStartedAt) payload.trialStartedAt = data.trialStartedAt;
      if (data.trialEndsAt) payload.trialEndsAt = data.trialEndsAt;
      if (data.vipStartedAt) payload.vipStartedAt = data.vipStartedAt;
      if (data.vipEndsAt) payload.vipEndsAt = data.vipEndsAt;
      if (data.createdAt) payload.createdAt = data.createdAt;

      await setDoc(doc(db, 'users', uid), payload, { merge: true });
      const updated = await this.getUserProfile(uid);
      return updated!;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, docPath);
    }
  },

  // ----------------------------------------------------
  // 2b. PUBLIC STORE PROFILE (Strictly Sanitized: No private login phone, no CRM, no auth data)
  // ----------------------------------------------------
  sanitizePublicStore(uid: string, d: Record<string, any>): PublicStoreProfile {
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
    }

    return {
      id: uid,
      name: d.name || `Boutique ${uid.slice(-4)}`,
      slogan: d.slogan || 'Vente directe & service rapide',
      location: d.location || 'Maroc',
      logo: d.logo || 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=400&q=80',
      currency: (d.currency as CurrencyType) || 'MAD',
      status: d.status || 'Actif',
      plan: d.plan || (d.status === 'VIP' ? 'VIP' : (d.status === 'Gratuit' ? 'Gratuit' : 'Essai')),
      trialEndsAt: d.trialEndsAt || d.date_expiration_essai,
      vipEndsAt: d.vipEndsAt,
      is_active: d.status !== 'Inactif' && d.status !== 'Suspendu',
      publicSlug: d.publicSlug || uid,
      orderWhatsApp: orderContact,
      allowCommercialContact: Boolean(orderContact),
    };
  },

  async getPublicStoreProfile(uidOrSlug: string): Promise<PublicStoreProfile | null> {
    const cleanId = uidOrSlug.trim();
    if (!cleanId) return null;

    // 1. Try direct lookup by UID
    try {
      const snap = await getDoc(doc(db, 'users', cleanId));
      if (snap.exists()) {
        const d = snap.data();
        return this.sanitizePublicStore(cleanId, d);
      }
    } catch {
      // Continue to query by publicSlug
    }

    // 2. Lookup by publicSlug query
    try {
      const q = query(
        collection(db, 'users'),
        where('publicSlug', '==', cleanId),
        limit(1)
      );
      const querySnap = await getDocs(q);
      if (!querySnap.empty) {
        const docSnap = querySnap.docs[0];
        return this.sanitizePublicStore(docSnap.id, docSnap.data());
      }
    } catch (err) {
      console.warn('Error querying public store by slug:', err);
    }

    return null;
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
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('Analytics logging failed:', err);
    }
  }
};
