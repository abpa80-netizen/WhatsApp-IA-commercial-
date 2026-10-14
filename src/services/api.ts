import { 
  Vendeur, 
  VendeurStatus,
  Product, 
  Prospect, 
  SystemConfig, 
  AdminData, 
  CurrencyType,
  AuthResponse,
  PublicStoreProfile,
  DailyVisitStat
} from '../types';
import { FirestoreService, DEFAULT_GLOBAL_SETTINGS } from './firestoreService';
import { AuthService } from './authService';
import { SafeStorage } from './storage';
import { auth } from '../firebase';

// Default system config fallback
export const DEFAULT_CONFIG: SystemConfig = DEFAULT_GLOBAL_SETTINGS;

// Deprecated stub retained for backwards compatibility
export function initSeedData(): void {
  // Legacy mock database removed. Fully migrated to Firebase Firestore.
}

export function normalizeVendeur(raw: any): Vendeur {
  if (!raw) {
    return {
      id: 'VEND-000',
      phone: '+212600000000',
      name: 'Boutique',
      slogan: 'Vente directe sur WhatsApp',
      location: 'Maroc',
      logo: 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=400&q=80',
      currency: 'MAD',
      status: 'Actif',
      is_active: true,
      role: 'seller',
      date_expiration_essai: new Date(Date.now() + 7 * 86400000).toISOString(),
      created_at: new Date().toISOString(),
      views: 0,
      product_clicks: 0,
      conversions: 0,
    };
  }
  const rawId = String(raw.uid || raw.id || raw.ID || raw.phone || '').trim();
  const rawPhone = String(raw.whatsappNumber || raw.phone || raw.téléphone || raw.telephone || '').trim();
  const cleanPhoneDigits = rawPhone.replace(/\D/g, '') || rawId.replace(/\D/g, '');
  const id = rawId || (cleanPhoneDigits ? `VEND-${cleanPhoneDigits.slice(-4)}` : `VEND-${Date.now().toString().slice(-4)}`);
  const phone = rawPhone.startsWith('+') ? rawPhone : (rawPhone ? `+${rawPhone}` : `+${cleanPhoneDigits}`);

  return {
    id: id,
    uid: raw.uid || id,
    phone: phone,
    whatsappNumber: raw.whatsappNumber || phone,
    phoneNormalized: raw.phoneNormalized || cleanPhoneDigits,
    name: String(raw.name || raw.nom || raw.boutique || `Boutique ${cleanPhoneDigits || id}`),
    slogan: String(raw.slogan || 'Vente directe & service rapide sur WhatsApp'),
    location: String(raw.location || raw.localisation || (phone.startsWith('+212') ? 'Casablanca, Maroc' : 'Abidjan, Côte d’Ivoire')),
    logo: String(raw.logo || 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=400&q=80'),
    currency: ((raw.currency || (phone.startsWith('+212') ? 'MAD' : 'CFA')) as CurrencyType),
    status: (raw.status || (raw.is_active === false ? 'Inactif' : 'Actif')) as VendeurStatus,
    is_active: raw.is_active !== undefined ? Boolean(raw.is_active) : (raw.status !== 'Inactif'),
    role: (raw.role as any) || 'seller',
    plan: raw.plan || 'Essai',
    trialStartedAt: raw.trialStartedAt,
    trialEndsAt: raw.trialEndsAt,
    vipStartedAt: raw.vipStartedAt,
    vipEndsAt: raw.vipEndsAt,
    publicSlug: raw.publicSlug || id,
    date_expiration_essai: String(raw.trialEndsAt || raw.date_expiration_essai || new Date(Date.now() + 7 * 86400000).toISOString()),
    created_at: String(raw.createdAt || raw.created_at || new Date().toISOString()),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    views: Number(raw.views || 0),
    product_clicks: Number(raw.product_clicks || 0),
    conversions: Number(raw.conversions || 0),
  };
}

export function normalizeProduct(raw: any, fallbackVendorId = 'VEND-000'): Product {
  const images = Array.isArray(raw?.images) && raw.images.length > 0
    ? raw.images.filter(Boolean)
    : (raw?.image_url ? [raw.image_url] : ['https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=80']);

  return {
    id: String(raw?.id || `prod_${Date.now()}`),
    vendeur_id: String(raw?.vendeur_id || fallbackVendorId),
    name: String(raw?.name || 'Article'),
    price: Number(raw?.price || 0),
    original_price: raw?.original_price ? Number(raw.original_price) : undefined,
    description: String(raw?.description || ''),
    images: images.length > 0 ? images : ['https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=80'],
    category: String(raw?.category || 'Général'),
    created_at: String(raw?.createdAt || raw?.created_at || new Date().toISOString()),
    createdAt: raw?.createdAt,
    updatedAt: raw?.updatedAt,
    clicks: Number(raw?.clicks || 0),
  };
}

export const ApiService = {
  // 1. Get Global Settings
  async getConfig(): Promise<SystemConfig> {
    return await FirestoreService.getGlobalSettings();
  },

  // 2. Update Global Settings (Admin only)
  async updateConfig(config: Partial<SystemConfig>): Promise<SystemConfig> {
    this.ensureAdminUser();
    const updated = await FirestoreService.updateGlobalSettings(config);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('wca_config_updated', { detail: updated }));
    }
    return updated;
  },

  // 3. Vendor Access: Separate Login and Registration via Firebase Auth
  async login(phone: string, password: string): Promise<Vendeur> {
    return await AuthService.login(phone, password);
  },

  async register(phone: string, password: string, confirmPassword?: string, name?: string): Promise<Vendeur> {
    return await AuthService.register(phone, password, confirmPassword, name);
  },

  // Legacy compatibility: purely calls login, NEVER creates an account automatically
  async loginOrRegister(phone: string, password?: string): Promise<Vendeur> {
    const cleanPhone = phone.trim();
    const effectivePassword = password && password.trim().length > 0 ? password.trim() : '';
    return await AuthService.login(cleanPhone, effectivePassword);
  },

  // Internal Authorization Guard: Prevents user A from spoofing or accessing user B's private scope
  ensureAuthenticatedOwner(targetUid: string): string {
    const currentUid = auth.currentUser?.uid;
    if (!currentUid) {
      throw new Error('Action non autorisée : Vous devez être connecté pour accéder à ces données.');
    }
    // Allow if caller is the document owner OR has admin privilege
    const isAdmin = auth.currentUser?.email?.trim().toLowerCase() === 'foosco80@gmail.com';
    if (currentUid !== targetUid && !isAdmin) {
      throw new Error('Accès refusé : Vous ne pouvez pas accéder ni modifier les données d’un autre vendeur.');
    }
    return currentUid;
  },

  // Admin Authorization Guard: Strictly reserves admin actions to foosco80@gmail.com
  ensureAdminUser(): string {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('Action non autorisée : Vous devez être connecté avec le compte administrateur pour accéder à ces données.');
    }
    const email = user.email?.trim().toLowerCase();
    if (email !== 'foosco80@gmail.com') {
      throw new Error('Accès refusé : Seul le compte administrateur autorisé (foosco80@gmail.com) peut exécuter cette action.');
    }
    return user.uid;
  },

  // 4. Get Vendeur by UID (Full private profile for logged-in merchant or admin)
  async getVendeur(vendeurId: string): Promise<Vendeur | null> {
    const cleanId = vendeurId.trim();
    this.ensureAuthenticatedOwner(cleanId);
    return await FirestoreService.getUserProfile(cleanId);
  },

  // 4b. Get Public Store Profile (Sanitized public data for public storefront visitors)
  async getPublicStoreProfile(uidOrSlug: string): Promise<PublicStoreProfile | null> {
    const cleanId = uidOrSlug.trim();
    return await FirestoreService.getPublicStoreProfile(cleanId);
  },

  // 4c. Admin Migration: Synchronize all existing merchants to publicStores/
  async migratePublicStores(): Promise<{ total: number; migrated: number; errors: number }> {
    this.ensureAdminUser();
    return await FirestoreService.migrateAllVendorsToPublicStores();
  },

  // 4d. Admin: Recalculate Subscription & Trial Expirations
  async recalculateEntitlements(): Promise<{ total: number; updated: number; fullCatalog: number; restricted: number; suspended: number; errors: number }> {
    this.ensureAdminUser();
    return await FirestoreService.recalculateAllVendorsEntitlements();
  },

  // 5. Update Branding
  async updateBranding(vendeurId: string, data: Partial<Vendeur>): Promise<Vendeur> {
    const cleanId = vendeurId.trim();
    this.ensureAuthenticatedOwner(cleanId);
    const updated = await FirestoreService.saveUserProfile(cleanId, data);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('wca_vendor_updated', { detail: updated }));
    }
    return updated;
  },

  // 6. Strict Catalog: Get Products for a specific vendor
  // Used by both public store viewers (read-only) and the authenticated merchant
  async getCatalog(vendeurId: string): Promise<Product[]> {
    const cleanId = vendeurId.trim();
    return await FirestoreService.getUserProducts(cleanId);
  },

  // 7. Save Product (strictly scoped to authenticated vendor in users/{uid}/products/{productId})
  async saveProduct(vendeurId: string, product: Omit<Product, 'id' | 'vendeur_id' | 'created_at'> & { id?: string }): Promise<Product> {
    const cleanId = vendeurId.trim();
    this.ensureAuthenticatedOwner(cleanId);
    return await FirestoreService.saveUserProduct(cleanId, product);
  },

  // 8. Delete Product
  async deleteProduct(vendeurId: string, productId: string): Promise<boolean> {
    const cleanId = vendeurId.trim();
    this.ensureAuthenticatedOwner(cleanId);
    return await FirestoreService.deleteUserProduct(cleanId, productId);
  },

  // 9. CRM Prospects (users/{uid}/prospects/{prospectId} - Strictly private CRM)
  async getProspects(vendeurId: string): Promise<Prospect[]> {
    const cleanId = vendeurId.trim();
    this.ensureAuthenticatedOwner(cleanId);
    return await FirestoreService.getUserProspects(cleanId);
  },

  async saveProspect(vendeurId: string, prospect: Omit<Prospect, 'id' | 'vendeur_id' | 'created_at'> & { id?: string }): Promise<Prospect> {
    const cleanId = vendeurId.trim();
    this.ensureAuthenticatedOwner(cleanId);
    return await FirestoreService.saveUserProspect(cleanId, prospect);
  },

  async deleteProspect(vendeurId: string, prospectId: string): Promise<boolean> {
    const cleanId = vendeurId.trim();
    this.ensureAuthenticatedOwner(cleanId);
    return await FirestoreService.deleteUserProspect(cleanId, prospectId);
  },

  // 10. Metrics tracking
  async trackView(vendeurId: string, productId?: string): Promise<void> {
    await FirestoreService.logAnalyticsEvent({
      vendeur_id: vendeurId,
      type: 'view',
      productId,
    });
  },

  async trackConversion(vendeurId: string, productId?: string): Promise<void> {
    await FirestoreService.logAnalyticsEvent({
      vendeur_id: vendeurId,
      type: 'conversion',
      productId,
    });
  },

  // 10b. Daily visits telemetry for analytics chart
  async getDailyVisits(vendeur: Vendeur, days: number = 7): Promise<DailyVisitStat[]> {
    return await FirestoreService.getDailyAnalytics(vendeur, days);
  },

  // 11. Admin: Get Admin Data from Firestore
  async getAdminData(): Promise<AdminData> {
    this.ensureAdminUser();
    return await FirestoreService.getAdminData();
  },

  // 11b. Admin: Purge demo accounts
  async purgeDemoVendors(): Promise<AdminData> {
    this.ensureAdminUser();
    return await FirestoreService.purgeDemoVendors();
  },

  // 12. Admin: Toggle Vendor Active (ON / OFF Switch)
  async toggleVendorActive(vendeurId: string): Promise<Vendeur> {
    this.ensureAdminUser();
    const current = await FirestoreService.getUserProfile(vendeurId);
    if (!current) throw new Error('Vendeur introuvable');
    const newStatus = current.status === 'Inactif' ? 'Actif' : 'Inactif';
    return await FirestoreService.saveUserProfile(vendeurId, { status: newStatus });
  },

  // 13. Admin: Toggle VIP status
  async toggleVendorVip(vendeurId: string): Promise<Vendeur> {
    this.ensureAdminUser();
    const current = await FirestoreService.getUserProfile(vendeurId);
    if (!current) throw new Error('Vendeur introuvable');
    const newStatus = current.status === 'VIP' ? 'Actif' : 'VIP';
    const newPlan = newStatus === 'VIP' ? 'VIP' : 'Gratuit';
    return await FirestoreService.saveUserProfile(vendeurId, { 
      status: newStatus,
      plan: newPlan,
      vipStartedAt: newStatus === 'VIP' ? new Date().toISOString() : undefined,
    });
  },

  async updateVendeurStatus(vendeurId: string, status: Vendeur['status']): Promise<Vendeur | null> {
    this.ensureAdminUser();
    if (status === 'VIP' || status === 'Gratuit') {
      return this.toggleVendorVip(vendeurId);
    } else {
      return this.toggleVendorActive(vendeurId);
    }
  },

  // 14. Update Vendor Profile & Security
  async updateProfile(vendeurId: string, data: Partial<Vendeur> & { currentPassword?: string; newPassword?: string }): Promise<Vendeur> {
    const cleanId = vendeurId.trim();
    this.ensureAuthenticatedOwner(cleanId);
    const updated = await FirestoreService.saveUserProfile(cleanId, data);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('wca_vendor_updated', { detail: updated }));
    }
    return updated;
  },

  // 15. Admin: Delete vendor account
  async deleteVendor(vendeurId: string): Promise<boolean> {
    this.ensureAdminUser();
    const cleanId = vendeurId.trim();
    return await FirestoreService.deleteUserAccount(cleanId);
  },

  // 16. Admin: Update Security
  async updateAdminSecurity(data: { currentPin?: string; newPin?: string; whatsappSupport?: string }): Promise<SystemConfig> {
    this.ensureAdminUser();
    return await this.updateConfig({
      whatsapp_support: data.whatsappSupport,
      supportWhatsapp: data.whatsappSupport,
    });
  }
};
