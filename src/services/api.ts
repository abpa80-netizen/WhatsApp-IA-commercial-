import { 
  Vendeur, 
  VendeurStatus,
  Product, 
  Prospect, 
  SystemConfig, 
  AdminData, 
  CurrencyType,
  AuthResponse
} from '../types';
import { SafeStorage } from './storage';

export const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbwzUfsovzKN9PpO93JYgErRuV30Jhut9DrHq33yU-SkhAIN2enkSCtC4DFcu71tL25r/exec';

// Default initial config
export const DEFAULT_CONFIG: SystemConfig = {
  price_vip: 199, // in MAD
  price_vip_cfa: 12000, // in CFA
  trial_days: 7,
  whatsapp_support: '+212600000000',
};

// Safe LocalStorage Manager
class StorageManager {
  private static getKey(key: string): string {
    return `wca_${key}`;
  }

  static get<T>(key: string, defaultValue: T): T {
    try {
      const data = SafeStorage.getItem(this.getKey(key));
      return data ? JSON.parse(data) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  static set<T>(key: string, value: T): void {
    try {
      SafeStorage.setItem(this.getKey(key), JSON.stringify(value));
    } catch (e) {
      console.error('LocalStorage write error', e);
    }
  }
}

// Low-level fetch to Express Backend API (/api/*)
async function backendFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = SafeStorage.getItem('wca_auth_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(endpoint, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const errorMsg = data?.error || `Erreur serveur (${res.status})`;
    const error = new Error(errorMsg) as Error & { code?: string; status?: number };
    error.code = data?.code;
    error.status = res.status;
    throw error;
  }

  return data as T;
}

export function initSeedData() {
  const existingVendeurs = StorageManager.get<Record<string, Vendeur>>('vendeurs', {});
  delete existingVendeurs['VEND-101'];
  delete existingVendeurs['vendeur_demo_212'];
  delete existingVendeurs['+212612345678'];
  Object.keys(existingVendeurs).forEach(k => {
    if (k.toLowerCase().includes('demo') || k.toLowerCase() === 'vend-101' || existingVendeurs[k]?.name?.toLowerCase().includes('caftan') || existingVendeurs[k]?.phone === '+212612345678') {
      delete existingVendeurs[k];
    }
  });
  StorageManager.set('vendeurs', existingVendeurs);

  const existingProducts = StorageManager.get<Record<string, Product[]>>('products', {});
  delete existingProducts['VEND-101'];
  delete existingProducts['vendeur_demo_212'];
  Object.keys(existingProducts).forEach(k => {
    if (k.toLowerCase().includes('demo') || k.toLowerCase() === 'vend-101') {
      delete existingProducts[k];
    }
  });
  StorageManager.set('products', existingProducts);

  const existingProspects = StorageManager.get<Record<string, Prospect[]>>('prospects', {});
  delete existingProspects['VEND-101'];
  delete existingProspects['vendeur_demo_212'];
  Object.keys(existingProspects).forEach(k => {
    if (k.toLowerCase().includes('demo') || k.toLowerCase() === 'vend-101') {
      delete existingProspects[k];
    }
  });
  StorageManager.set('prospects', existingProspects);
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
      role: 'vendeur',
      date_expiration_essai: new Date(Date.now() + 7 * 86400000).toISOString(),
      created_at: new Date().toISOString(),
      views: 0,
      product_clicks: 0,
      conversions: 0,
    };
  }
  const rawId = String(raw.id || raw.ID || raw.phone || raw.vendeur_id || '').trim();
  const rawPhone = String(raw.phone || raw.téléphone || raw.telephone || raw.whatsapp || raw.numéro || raw.id || '').trim();
  const cleanPhoneDigits = rawPhone.replace(/\D/g, '') || rawId.replace(/\D/g, '');
  const id = rawId || (cleanPhoneDigits ? `VEND-${cleanPhoneDigits.slice(-4)}` : `VEND-${Date.now().toString().slice(-4)}`);
  const phone = rawPhone.startsWith('+') ? rawPhone : (rawPhone ? `+${rawPhone}` : `+${cleanPhoneDigits}`);

  return {
    id: id,
    phone: phone,
    name: String(raw.name || raw.nom || raw.boutique || `Boutique ${cleanPhoneDigits || id}`),
    slogan: String(raw.slogan || 'Vente directe & service rapide sur WhatsApp'),
    location: String(raw.location || raw.localisation || (phone.startsWith('+212') ? 'Casablanca, Maroc' : 'Abidjan, Côte d’Ivoire')),
    logo: String(raw.logo || 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=400&q=80'),
    currency: ((raw.currency || (phone.startsWith('+212') ? 'MAD' : 'CFA')) as CurrencyType),
    status: (raw.status || (raw.is_active === false ? 'Inactif' : 'Actif')) as VendeurStatus,
    is_active: raw.is_active !== undefined ? Boolean(raw.is_active) : (raw.status !== 'Inactif'),
    role: (raw.role as any) || 'vendeur',
    date_expiration_essai: String(raw.date_expiration_essai || new Date(Date.now() + 7 * 86400000).toISOString()),
    created_at: String(raw.created_at || new Date().toISOString()),
    views: Number(raw.views || 0),
    product_clicks: Number(raw.product_clicks || 0),
    conversions: Number(raw.conversions || 0),
  };
}

export function normalizeProduct(raw: any, fallbackVendorId = 'VEND-101'): Product {
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
    created_at: String(raw?.created_at || new Date().toISOString()),
    clicks: Number(raw?.clicks || 0),
  };
}

export const ApiService = {
  // 1. Get System Config
  async getConfig(): Promise<SystemConfig> {
    try {
      const data = await backendFetch<{ config: SystemConfig }>('/api/system/config');
      if (data?.config) {
        StorageManager.set('config', data.config);
        return data.config;
      }
    } catch (e) {
      console.warn('Using cached config:', e);
    }
    return StorageManager.get<SystemConfig>('config', DEFAULT_CONFIG);
  },

  // 2. Update System Config (Admin)
  async updateConfig(config: Partial<SystemConfig>): Promise<SystemConfig> {
    let result: SystemConfig;
    try {
      const data = await backendFetch<{ config: SystemConfig }>('/api/system/config', {
        method: 'POST',
        body: JSON.stringify({ config }),
      });
      result = data.config;
      StorageManager.set('config', result);
    } catch {
      const current = StorageManager.get<SystemConfig>('config', DEFAULT_CONFIG);
      result = { ...current, ...config };
      StorageManager.set('config', result);
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('wca_config_updated', { detail: result }));
      localStorage.setItem('wca_last_config_update', Date.now().toString());
    }

    return result;
  },

  // 3. SINGLE FORM ACCESS: LOGIN OR AUTO-REGISTER
  // Inputs: phone + password
  // Automatically creates account with unique ID if not exists, or verifies password if exists.
  async loginOrRegister(phone: string, password?: string): Promise<Vendeur> {
    const cleanPhone = phone.trim();
    const effectivePassword = password && password.trim().length > 0 ? password.trim() : 'demo1234';

    try {
      const data = await backendFetch<AuthResponse>('/api/auth/access', {
        method: 'POST',
        body: JSON.stringify({
          phone: cleanPhone,
          password: effectivePassword,
        }),
      });

      if (data.token) {
        localStorage.setItem('wca_auth_token', data.token);
      }

      const vendor = normalizeVendeur(data.user);
      
      // Update local storage cache
      const allVendeurs = StorageManager.get<Record<string, Vendeur>>('vendeurs', {});
      allVendeurs[vendor.id] = vendor;
      allVendeurs[cleanPhone] = vendor;
      StorageManager.set('vendeurs', allVendeurs);

      return vendor;
    } catch (err: any) {
      // If error is an explicit authentication error from backend, bubble it up to user UI!
      if (err.status === 401 || err.status === 403 || err.code === 'ACCOUNT_DISABLED' || err.code === 'WRONG_PASSWORD') {
        throw err;
      }

      // Offline fallback for demo
      console.warn('Backend access offline fallback:', err);
      const allVendeurs = StorageManager.get<Record<string, Vendeur>>('vendeurs', {});
      const existing = Object.values(allVendeurs).find(v => v.phone.replace(/\D/g, '') === cleanPhone.replace(/\D/g, ''));
      if (existing) {
        if (existing.is_active === false || existing.status === 'Inactif') {
          throw new Error('Votre compte a été désactivé par l’administrateur.');
        }
        return existing;
      }

      const generatedId = `VEND-${100 + Object.keys(allVendeurs).length + 1}`;
      const newV: Vendeur = {
        id: generatedId,
        phone: cleanPhone.startsWith('+') ? cleanPhone : `+${cleanPhone}`,
        name: `Boutique ${cleanPhone}`,
        slogan: 'Vente directe & service rapide sur WhatsApp',
        location: cleanPhone.startsWith('212') ? 'Casablanca, Maroc' : 'Abidjan, Côte d’Ivoire',
        logo: 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=400&q=80',
        currency: cleanPhone.startsWith('212') ? 'MAD' : 'CFA',
        status: 'Actif',
        is_active: true,
        role: 'vendeur',
        date_expiration_essai: new Date(Date.now() + 7 * 86400000).toISOString(),
        created_at: new Date().toISOString(),
        views: 0,
        product_clicks: 0,
        conversions: 0,
      };
      allVendeurs[newV.id] = newV;
      StorageManager.set('vendeurs', allVendeurs);
      return newV;
    }
  },

  // 4. Get Vendeur by ID or Phone
  async getVendeur(vendeurId: string): Promise<Vendeur | null> {
    const cleanId = vendeurId.trim();

    try {
      const data = await backendFetch<{ vendor: Vendeur }>(`/api/vendors/${encodeURIComponent(cleanId)}`);
      if (data?.vendor) {
        const normalized = normalizeVendeur(data.vendor);
        const allVendeurs = StorageManager.get<Record<string, Vendeur>>('vendeurs', {});
        allVendeurs[normalized.id] = normalized;
        StorageManager.set('vendeurs', allVendeurs);
        return normalized;
      }
    } catch {
      // Local fallback
    }

    const allVendeurs = StorageManager.get<Record<string, Vendeur>>('vendeurs', {});
    const cleanDigits = cleanId.replace(/\D/g, '');
    const cached = allVendeurs[cleanId] || Object.values(allVendeurs).find(v => 
      v.id.toLowerCase() === cleanId.toLowerCase() || 
      (cleanDigits.length > 5 && v.phone.replace(/\D/g, '') === cleanDigits)
    ) || null;

    return cached;
  },

  // 5. Update Branding
  async updateBranding(vendeurId: string, data: Partial<Vendeur>): Promise<Vendeur> {
    try {
      const res = await backendFetch<{ vendor: Vendeur }>(`/api/vendors/${encodeURIComponent(vendeurId)}/branding`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
      if (res?.vendor) {
        const normalized = normalizeVendeur(res.vendor);
        const allVendeurs = StorageManager.get<Record<string, Vendeur>>('vendeurs', {});
        allVendeurs[vendeurId] = normalized;
        StorageManager.set('vendeurs', allVendeurs);
        return normalized;
      }
    } catch {
      // Local fallback
    }

    const allVendeurs = StorageManager.get<Record<string, Vendeur>>('vendeurs', {});
    const current = allVendeurs[vendeurId] || (await this.getVendeur(vendeurId))!;
    const updated: Vendeur = { ...current, ...data, id: vendeurId };
    allVendeurs[vendeurId] = updated;
    StorageManager.set('vendeurs', allVendeurs);
    return updated;
  },

  // 6. Strict Catalog Isolation: Get Products for a specific vendor
  async getCatalog(vendeurId: string): Promise<Product[]> {
    const cleanId = vendeurId.trim();

    try {
      const data = await backendFetch<{ products: Product[] }>(`/api/vendors/${encodeURIComponent(cleanId)}/products`);
      if (Array.isArray(data?.products)) {
        const normalized = data.products.map(p => normalizeProduct(p, cleanId));
        const allProducts = StorageManager.get<Record<string, Product[]>>('products', {});
        allProducts[cleanId] = normalized;
        StorageManager.set('products', allProducts);
        return normalized;
      }
    } catch {
      // Local fallback
    }

    const allProducts = StorageManager.get<Record<string, Product[]>>('products', {});
    const list = allProducts[cleanId] || [];
    return list.map(p => normalizeProduct(p, cleanId));
  },

  // 7. Save Product (strictly scoped to this vendor)
  async saveProduct(vendeurId: string, product: Omit<Product, 'id' | 'vendeur_id' | 'created_at'> & { id?: string }): Promise<Product> {
    try {
      const data = await backendFetch<{ product: Product }>(`/api/vendors/${encodeURIComponent(vendeurId)}/products`, {
        method: 'POST',
        body: JSON.stringify(product),
      });
      if (data?.product) {
        const normalized = normalizeProduct(data.product, vendeurId);
        const allProducts = StorageManager.get<Record<string, Product[]>>('products', {});
        const list = allProducts[vendeurId] || [];
        const idx = list.findIndex(p => p.id === normalized.id);
        if (idx >= 0) list[idx] = normalized;
        else list.unshift(normalized);
        allProducts[vendeurId] = list;
        StorageManager.set('products', allProducts);
        return normalized;
      }
    } catch {
      // Local fallback
    }

    const allProducts = StorageManager.get<Record<string, Product[]>>('products', {});
    const list = allProducts[vendeurId] || [];
    let saved: Product;
    if (product.id) {
      const idx = list.findIndex(p => p.id === product.id);
      saved = normalizeProduct({
        ...list[idx],
        ...product,
        id: product.id,
        vendeur_id: vendeurId,
        created_at: list[idx]?.created_at || new Date().toISOString(),
      }, vendeurId);
      if (idx >= 0) list[idx] = saved;
      else list.unshift(saved);
    } else {
      saved = normalizeProduct({
        ...product,
        id: `prod_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        vendeur_id: vendeurId,
        created_at: new Date().toISOString(),
        clicks: 0,
      }, vendeurId);
      list.unshift(saved);
    }
    allProducts[vendeurId] = list;
    StorageManager.set('products', allProducts);
    return saved;
  },

  // 8. Delete Product
  async deleteProduct(vendeurId: string, productId: string): Promise<boolean> {
    try {
      await backendFetch(`/api/vendors/${encodeURIComponent(vendeurId)}/products/${encodeURIComponent(productId)}`, {
        method: 'DELETE',
      });
    } catch {
      // Local fallback
    }

    const allProducts = StorageManager.get<Record<string, Product[]>>('products', {});
    const list = (allProducts[vendeurId] || []).filter(p => p.id !== productId);
    allProducts[vendeurId] = list;
    StorageManager.set('products', allProducts);
    return true;
  },

  // 9. CRM Prospects
  async getProspects(vendeurId: string): Promise<Prospect[]> {
    try {
      const data = await backendFetch<{ prospects: Prospect[] }>(`/api/vendors/${encodeURIComponent(vendeurId)}/prospects`);
      if (Array.isArray(data?.prospects)) {
        const allProspects = StorageManager.get<Record<string, Prospect[]>>('prospects', {});
        allProspects[vendeurId] = data.prospects;
        StorageManager.set('prospects', allProspects);
        return data.prospects;
      }
    } catch {
      // Local fallback
    }

    const allProspects = StorageManager.get<Record<string, Prospect[]>>('prospects', {});
    return allProspects[vendeurId] || [];
  },

  async saveProspect(vendeurId: string, prospect: Omit<Prospect, 'id' | 'vendeur_id' | 'created_at'> & { id?: string }): Promise<Prospect> {
    try {
      const data = await backendFetch<{ prospect: Prospect }>(`/api/vendors/${encodeURIComponent(vendeurId)}/prospects`, {
        method: 'POST',
        body: JSON.stringify(prospect),
      });
      if (data?.prospect) {
        const allProspects = StorageManager.get<Record<string, Prospect[]>>('prospects', {});
        const list = allProspects[vendeurId] || [];
        const idx = list.findIndex(p => p.id === data.prospect.id);
        if (idx >= 0) list[idx] = data.prospect;
        else list.unshift(data.prospect);
        allProspects[vendeurId] = list;
        StorageManager.set('prospects', allProspects);
        return data.prospect;
      }
    } catch {
      // Local fallback
    }

    const allProspects = StorageManager.get<Record<string, Prospect[]>>('prospects', {});
    const list = allProspects[vendeurId] || [];
    let saved: Prospect;
    if (prospect.id) {
      const idx = list.findIndex(p => p.id === prospect.id);
      saved = {
        ...list[idx],
        ...prospect,
        id: prospect.id,
        vendeur_id: vendeurId,
        created_at: list[idx]?.created_at || new Date().toISOString(),
      };
      if (idx >= 0) list[idx] = saved;
      else list.unshift(saved);
    } else {
      saved = {
        ...prospect,
        id: `prosp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        vendeur_id: vendeurId,
        created_at: new Date().toISOString(),
      };
      list.unshift(saved);
    }
    allProspects[vendeurId] = list;
    StorageManager.set('prospects', allProspects);
    return saved;
  },

  async deleteProspect(vendeurId: string, prospectId: string): Promise<boolean> {
    try {
      await backendFetch(`/api/vendors/${encodeURIComponent(vendeurId)}/prospects/${encodeURIComponent(prospectId)}`, {
        method: 'DELETE',
      });
    } catch {
      // Local fallback
    }

    const allProspects = StorageManager.get<Record<string, Prospect[]>>('prospects', {});
    const list = (allProspects[vendeurId] || []).filter(p => p.id !== prospectId);
    allProspects[vendeurId] = list;
    StorageManager.set('prospects', allProspects);
    return true;
  },

  // 10. Metrics tracking
  async trackView(vendeurId: string, productId?: string): Promise<void> {
    try {
      await backendFetch(`/api/vendors/${encodeURIComponent(vendeurId)}/track-view`, {
        method: 'POST',
        body: JSON.stringify({ productId }),
      });
    } catch {
      // Local fallback
    }

    const allVendeurs = StorageManager.get<Record<string, Vendeur>>('vendeurs', {});
    if (allVendeurs[vendeurId]) {
      allVendeurs[vendeurId].views = (allVendeurs[vendeurId].views || 0) + 1;
      StorageManager.set('vendeurs', allVendeurs);
    }
  },

  async trackConversion(vendeurId: string, productId?: string): Promise<void> {
    try {
      await backendFetch(`/api/vendors/${encodeURIComponent(vendeurId)}/track-conversion`, {
        method: 'POST',
        body: JSON.stringify({ productId }),
      });
    } catch {
      // Local fallback
    }

    const allVendeurs = StorageManager.get<Record<string, Vendeur>>('vendeurs', {});
    if (allVendeurs[vendeurId]) {
      allVendeurs[vendeurId].conversions = (allVendeurs[vendeurId].conversions || 0) + 1;
      StorageManager.set('vendeurs', allVendeurs);
    }
  },

  // 11. Admin: Get Admin Data (lists all registered vendors with their WhatsApp numbers)
  async getAdminData(): Promise<AdminData> {
    try {
      const data = await backendFetch<AdminData>('/api/admin/data');
      if (data && Array.isArray(data.vendeurs)) {
        const isDemo = (v: any) => {
          const id = (v.id || '').toLowerCase();
          const name = (v.name || '').toLowerCase();
          const phone = v.phone || '';
          return id === 'vend-101' || id === 'vendeur_demo_212' || id.includes('demo') || phone === '+212612345678' || name.includes('caftan');
        };
        const cleanVendors = data.vendeurs.filter(v => !isDemo(v));
        const normalizedList = cleanVendors.map(v => normalizeVendeur(v as any));
        const allVendeurs = StorageManager.get<Record<string, Vendeur>>('vendeurs', {});
        normalizedList.forEach(v => {
          allVendeurs[v.id] = v;
        });
        StorageManager.set('vendeurs', allVendeurs);
        return {
          total_vendeurs: normalizedList.length,
          total_products: data.total_products,
          total_views: data.total_views,
          total_conversions: data.total_conversions,
          vendeurs: normalizedList,
        };
      }
    } catch {
      // Local fallback
    }

    const allVendeurs = StorageManager.get<Record<string, Vendeur>>('vendeurs', {});
    const allProducts = StorageManager.get<Record<string, Product[]>>('products', {});
    const list = Object.values(allVendeurs).filter(v => 
      v.id !== 'VEND-101' && 
      !v.id.toLowerCase().includes('demo') && 
      v.phone !== '+212612345678' &&
      !v.name?.toLowerCase().includes('caftan')
    );
    const totalProds = Object.values(allProducts).reduce((acc, l) => acc + l.length, 0);

    return {
      total_vendeurs: list.length,
      total_products: totalProds,
      total_views: list.reduce((acc, v) => acc + (v.views || 0), 0),
      total_conversions: list.reduce((acc, v) => acc + (v.conversions || 0), 0),
      vendeurs: list,
    };
  },

  // 11b. Admin: Purge all demo vendors
  async purgeDemoVendors(): Promise<AdminData> {
    try {
      const res = await backendFetch<{ success: boolean; purgedCount: number; data: AdminData }>('/api/admin/purge-demo', {
        method: 'POST',
      });
      initSeedData();
      if (res?.data) {
        return res.data;
      }
    } catch {
      // Local fallback
    }
    initSeedData();
    return this.getAdminData();
  },

  // 12. Admin: Toggle Vendor Active (ON / OFF Switch)
  async toggleVendorActive(vendeurId: string): Promise<Vendeur> {
    let result: Vendeur | null = null;
    try {
      const data = await backendFetch<{ success: boolean; vendor: Vendeur }>(
        `/api/admin/vendors/${encodeURIComponent(vendeurId)}/toggle-active`,
        { method: 'PATCH' }
      );
      if (data?.vendor) {
        result = normalizeVendeur(data.vendor);
      }
    } catch (e) {
      console.warn('Backend toggle failed, using local:', e);
    }

    if (!result) {
      const allVendeurs = StorageManager.get<Record<string, Vendeur>>('vendeurs', {});
      const current = allVendeurs[vendeurId];
      if (current) {
        current.is_active = !(current.is_active !== false && current.status !== 'Inactif');
        current.status = current.is_active ? 'Actif' : 'Inactif';
        result = current;
      }
    }

    if (result) {
      const allVendeurs = StorageManager.get<Record<string, Vendeur>>('vendeurs', {});
      allVendeurs[vendeurId] = result;
      if (result.phone) allVendeurs[result.phone] = result;
      StorageManager.set('vendeurs', allVendeurs);

      // Instant synchronization across tabs & active vendor sessions!
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('wca_vendor_updated', { detail: result }));
        localStorage.setItem('wca_last_vendor_update', Date.now().toString());
      }
      return result;
    }

    throw new Error('Vendeur introuvable');
  },

  // 13. Admin: Toggle VIP status
  async toggleVendorVip(vendeurId: string): Promise<Vendeur> {
    let result: Vendeur | null = null;
    try {
      const data = await backendFetch<{ success: boolean; vendor: Vendeur }>(
        `/api/admin/vendors/${encodeURIComponent(vendeurId)}/toggle-vip`,
        { method: 'PATCH' }
      );
      if (data?.vendor) {
        result = normalizeVendeur(data.vendor);
      }
    } catch {
      // Local fallback
    }

    if (!result) {
      const allVendeurs = StorageManager.get<Record<string, Vendeur>>('vendeurs', {});
      const current = allVendeurs[vendeurId];
      if (current) {
        current.status = current.status === 'VIP' ? 'Actif' : 'VIP';
        result = current;
      }
    }

    if (result) {
      const allVendeurs = StorageManager.get<Record<string, Vendeur>>('vendeurs', {});
      allVendeurs[vendeurId] = result;
      if (result.phone) allVendeurs[result.phone] = result;
      StorageManager.set('vendeurs', allVendeurs);

      // Instant synchronization across tabs & active vendor sessions!
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('wca_vendor_updated', { detail: result }));
        localStorage.setItem('wca_last_vendor_update', Date.now().toString());
      }
      return result;
    }

    throw new Error('Vendeur introuvable');
  },

  async updateVendeurStatus(vendeurId: string, status: Vendeur['status']): Promise<Vendeur | null> {
    if (status === 'VIP' || status === 'Gratuit') {
      return this.toggleVendorVip(vendeurId);
    } else {
      return this.toggleVendorActive(vendeurId);
    }
  },

  // 14. Update Vendor Profile & Security (WhatsApp number & Password)
  async updateProfile(vendeurId: string, data: {
    phone?: string;
    currentPassword?: string;
    newPassword?: string;
    name?: string;
    slogan?: string;
    location?: string;
    logo?: string;
    currency?: CurrencyType;
  }): Promise<Vendeur> {
    const res = await backendFetch<{ success: boolean; vendor: Vendeur }>(
      `/api/vendors/${encodeURIComponent(vendeurId)}/profile`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      }
    );

    if (res?.vendor) {
      const normalized = normalizeVendeur(res.vendor);
      const allVendeurs = StorageManager.get<Record<string, Vendeur>>('vendeurs', {});
      allVendeurs[vendeurId] = normalized;
      if (normalized.phone) allVendeurs[normalized.phone] = normalized;
      StorageManager.set('vendeurs', allVendeurs);

      // Instant synchronization across tabs & Admin components
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('wca_vendor_updated', { detail: normalized }));
        localStorage.setItem('wca_last_vendor_update', Date.now().toString());
      }

      return normalized;
    }
    throw new Error('Impossible de mettre à jour le profil');
  },

  // 15. Admin: Delete vendor account
  async deleteVendor(vendeurId: string): Promise<boolean> {
    await backendFetch(`/api/admin/vendors/${encodeURIComponent(vendeurId)}`, {
      method: 'DELETE',
    });
    const allVendeurs = StorageManager.get<Record<string, Vendeur>>('vendeurs', {});
    delete allVendeurs[vendeurId];
    StorageManager.set('vendeurs', allVendeurs);

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('wca_vendor_updated', { detail: { id: vendeurId, deleted: true } }));
      localStorage.setItem('wca_last_vendor_update', Date.now().toString());
    }

    return true;
  },

  // 16. Admin: Update Security (PIN & Support number)
  async updateAdminSecurity(data: { currentPin?: string; newPin?: string; whatsappSupport?: string }): Promise<SystemConfig> {
    const res = await backendFetch<{ success: boolean; config: SystemConfig }>('/api/admin/security', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (res?.config) {
      StorageManager.set('config', res.config);

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('wca_config_updated', { detail: res.config }));
        localStorage.setItem('wca_last_config_update', Date.now().toString());
      }

      return res.config;
    }
    throw new Error('Erreur lors de la mise à jour de la sécurité');
  }
};
