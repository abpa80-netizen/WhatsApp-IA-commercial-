import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Vendeur, Product, Prospect, SystemConfig, CurrencyType } from '../src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../data');
const DB_FILE = path.resolve(DATA_DIR, 'app_database.json');

export interface VendeurRecord extends Vendeur {
  password_hash: string;
}

export interface AppDatabase {
  vendeurs: VendeurRecord[];
  products: Product[];
  prospects: Prospect[];
  config: SystemConfig & { admin_pin?: string };
}

const DEFAULT_SYSTEM_CONFIG: SystemConfig & { admin_pin?: string } = {
  price_vip: 199,
  price_vip_cfa: 12000,
  trial_days: 7,
  whatsapp_support: '+212600000000',
  admin_pin: '1234',
};

// In-memory cache + file sync
let memoryDb: AppDatabase | null = null;

export function sanitizeVendor(v: VendeurRecord): Vendeur {
  const { password_hash: _discard, ...safe } = v;
  return safe;
}

export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) {
    return `+${digits}`;
  }
  // If starts with 00
  if (trimmed.startsWith('00')) {
    return `+${digits.slice(2)}`;
  }
  return `+${digits}`;
}

function ensureDataDirectory() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Purge all demo vendors from database
function purgeDemoVendors(db: AppDatabase): number {
  const isDemoVendor = (v: VendeurRecord) => {
    const idLower = (v.id || '').toLowerCase();
    const nameLower = (v.name || '').toLowerCase();
    const phone = v.phone || '';
    return idLower === 'vend-101' || 
           idLower === 'vendeur_demo_212' || 
           idLower.includes('demo') ||
           phone === '+212612345678' ||
           phone === '212612345678' ||
           nameLower.includes('caftan') ||
           nameLower.includes('élégance') ||
           nameLower.includes('elegance');
  };

  const demoVendorIds = new Set(db.vendeurs.filter(isDemoVendor).map(v => v.id.toLowerCase()));
  demoVendorIds.add('vend-101');
  demoVendorIds.add('vendeur_demo_212');

  const beforeVCount = db.vendeurs.length;
  db.vendeurs = db.vendeurs.filter(v => !isDemoVendor(v));
  db.products = db.products.filter(p => !demoVendorIds.has((p.vendeur_id || '').toLowerCase()));
  db.prospects = db.prospects.filter(pr => !demoVendorIds.has((pr.vendeur_id || '').toLowerCase()));

  const purgedCount = beforeVCount - db.vendeurs.length;
  if (purgedCount > 0) {
    console.log(`Purged ${purgedCount} demo vendors from database.`);
    saveDatabase();
  }
  return purgedCount;
}

function loadDatabase(): AppDatabase {
  if (memoryDb) return memoryDb;
  ensureDataDirectory();

  if (fs.existsSync(DB_FILE)) {
    try {
      const data = fs.readFileSync(DB_FILE, 'utf-8');
      memoryDb = JSON.parse(data);
      if (memoryDb) {
        // Enforce demo vendor removal
        purgeDemoVendors(memoryDb);
        saveDatabase();
        return memoryDb;
      }
    } catch (e) {
      console.error('Failed reading DB file, seeding clean database:', e);
    }
  }

  // Clean initial database with NO demo vendors
  memoryDb = {
    vendeurs: [],
    products: [],
    prospects: [],
    config: DEFAULT_SYSTEM_CONFIG,
  };

  saveDatabase();
  return memoryDb;
}

function saveDatabase() {
  if (!memoryDb) return;
  ensureDataDirectory();
  try {
    const tmpFile = `${DB_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpFile, JSON.stringify(memoryDb, null, 2), 'utf-8');
    fs.renameSync(tmpFile, DB_FILE);
  } catch (err) {
    console.error('Failed writing DB file:', err);
  }
}

// Generate sequential readable unique vendor ID, e.g. VEND-101, VEND-102...
function generateUniqueVendorId(db: AppDatabase): string {
  let highestNum = 100;
  for (const v of db.vendeurs) {
    const match = v.id.match(/^VEND-(\d+)$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > highestNum) highestNum = num;
    }
  }
  return `VEND-${highestNum + 1}`;
}

// AUTH TOKEN HELPER
const AUTH_SECRET = process.env.AUTH_SECRET || 'wca_secret_key_2026_super_secure';

export function createAuthToken(vendorId: string, role: string): string {
  const payload = Buffer.from(JSON.stringify({ vendorId, role, iat: Date.now() })).toString('base64url');
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyAuthToken(token: string): { vendorId: string; role: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, signature] = parts;
    const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
    if (signature !== expectedSig) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
}

export const DatabaseService = {
  init(): AppDatabase {
    const db = loadDatabase();
    purgeDemoVendors(db);
    saveDatabase();
    return db;
  },

  // 1. UNIQUE ACCESS FORM: LOGIN OR AUTO-REGISTER
  accessByPhoneAndPassword(phone: string, plainPassword: string): {
    success: boolean;
    isNew: boolean;
    user?: Vendeur;
    token?: string;
    error?: string;
    code?: string;
    statusCode: number;
  } {
    const db = loadDatabase();
    const cleanPhone = normalizePhone(phone);
    const digitsOnly = cleanPhone.replace(/\D/g, '');

    if (!digitsOnly || digitsOnly.length < 6) {
      return {
        success: false,
        isNew: false,
        error: 'Numéro WhatsApp invalide. Veuillez entrer au moins 6 chiffres.',
        code: 'INVALID_PHONE',
        statusCode: 400,
      };
    }

    if (!plainPassword || plainPassword.length < 4) {
      return {
        success: false,
        isNew: false,
        error: 'Le mot de passe doit contenir au moins 4 caractères.',
        code: 'INVALID_PASSWORD_LENGTH',
        statusCode: 400,
      };
    }

    // Look for existing vendor by normalized phone or digits match
    const existing = db.vendeurs.find(v => {
      const vDigits = v.phone.replace(/\D/g, '');
      return v.phone === cleanPhone || vDigits === digitsOnly;
    });

    if (existing) {
      // 1. Check account active status
      if (existing.is_active === false || existing.status === 'Inactif') {
        return {
          success: false,
          isNew: false,
          error: 'Votre compte a été désactivé par l’administrateur. Veuillez contacter le support WhatsApp.',
          code: 'ACCOUNT_DISABLED',
          statusCode: 403,
        };
      }

      // 2. Validate password
      const isMatch = bcrypt.compareSync(plainPassword, existing.password_hash);
      if (!isMatch) {
        return {
          success: false,
          isNew: false,
          error: 'Mot de passe incorrect pour ce numéro WhatsApp.',
          code: 'WRONG_PASSWORD',
          statusCode: 401,
        };
      }

      // Login success
      const token = createAuthToken(existing.id, existing.role || 'vendeur');
      return {
        success: true,
        isNew: false,
        user: sanitizeVendor(existing),
        token,
        statusCode: 200,
      };
    }

    // NEW USER -> AUTO REGISTER
    const newId = generateUniqueVendorId(db);
    const passwordHash = bcrypt.hashSync(plainPassword, 10);
    const defaultCurrency: CurrencyType = cleanPhone.startsWith('+212') ? 'MAD' : 'CFA';
    const location = cleanPhone.startsWith('+212') ? 'Casablanca, Maroc' : 'Abidjan, Côte d’Ivoire';
    const trialDays = Number(db.config?.trial_days) || 7;

    const newVendor: VendeurRecord = {
      id: newId,
      phone: cleanPhone,
      password_hash: passwordHash,
      name: `Boutique ${cleanPhone}`,
      slogan: 'Vente directe & service rapide sur WhatsApp',
      location,
      logo: 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?auto=format&fit=crop&w=400&q=80',
      currency: defaultCurrency,
      status: 'Actif',
      is_active: true,
      role: 'vendeur',
      date_expiration_essai: new Date(Date.now() + trialDays * 86400000).toISOString(),
      created_at: new Date().toISOString(),
      views: 0,
      product_clicks: 0,
      conversions: 0,
    };

    db.vendeurs.unshift(newVendor);

    // Seed 1 default starter product for the new vendor's catalog
    const starterProducts: Product[] = [
      {
        id: `prod_${newId}_1`,
        vendeur_id: newId,
        name: 'Mon Premier Article Exclusif',
        price: defaultCurrency === 'MAD' ? 249 : 12500,
        original_price: defaultCurrency === 'MAD' ? 320 : 16000,
        description: 'Bienvenue sur votre catalogue en ligne ! Modifiez ce produit ou ajoutez vos propres articles en quelques secondes.',
        images: [
          'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=80',
        ],
        category: 'Nouveautés',
        created_at: new Date().toISOString(),
        clicks: 0,
      },
    ];

    db.products.push(...starterProducts);
    saveDatabase();

    const token = createAuthToken(newVendor.id, newVendor.role || 'vendeur');

    return {
      success: true,
      isNew: true,
      user: sanitizeVendor(newVendor),
      token,
      statusCode: 201,
    };
  },

  // 2. ADMIN: GET ALL VENDORS & STATS (NO DEMO VENDORS)
  getAdminData(): {
    total_vendeurs: number;
    total_products: number;
    total_views: number;
    total_conversions: number;
    vendeurs: Vendeur[];
  } {
    const db = loadDatabase();
    purgeDemoVendors(db);

    const sortedVendors = [...db.vendeurs]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map(sanitizeVendor);

    const totalViews = sortedVendors.reduce((acc, v) => acc + (v.views || 0), 0);
    const totalConversions = sortedVendors.reduce((acc, v) => acc + (v.conversions || 0), 0);

    return {
      total_vendeurs: sortedVendors.length,
      total_products: db.products.length,
      total_views: totalViews,
      total_conversions: totalConversions,
      vendeurs: sortedVendors,
    };
  },

  // 2b. ADMIN: EXPLICIT PURGE DEMO VENDORS
  purgeAllDemoVendors(): {
    purgedCount: number;
    data: {
      total_vendeurs: number;
      total_products: number;
      total_views: number;
      total_conversions: number;
      vendeurs: Vendeur[];
    };
  } {
    const db = loadDatabase();
    const purgedCount = purgeDemoVendors(db);
    saveDatabase();
    const data = this.getAdminData();
    return { purgedCount, data };
  },

  // 3. ADMIN: TOGGLE VENDOR ACTIVE STATUS (ON / OFF SWITCH)
  toggleVendorActive(vendorId: string): Vendeur | null {
    const db = loadDatabase();
    const vendor = db.vendeurs.find(v => v.id.toLowerCase() === vendorId.trim().toLowerCase());
    if (!vendor) return null;

    const currentActive = vendor.is_active !== false && vendor.status !== 'Inactif';
    vendor.is_active = !currentActive;
    vendor.status = vendor.is_active ? 'Actif' : 'Inactif';

    saveDatabase();
    return sanitizeVendor(vendor);
  },

  // 4. ADMIN: TOGGLE VIP STATUS
  toggleVendorVip(vendorId: string): Vendeur | null {
    const db = loadDatabase();
    const vendor = db.vendeurs.find(v => v.id.toLowerCase() === vendorId.trim().toLowerCase());
    if (!vendor) return null;

    vendor.status = vendor.status === 'VIP' ? 'Actif' : 'VIP';
    saveDatabase();
    return sanitizeVendor(vendor);
  },

  // 5. ADMIN: DELETE VENDOR
  deleteVendor(vendorId: string): boolean {
    const db = loadDatabase();
    const cleanId = vendorId.trim().toLowerCase();
    const beforeCount = db.vendeurs.length;
    db.vendeurs = db.vendeurs.filter(v => v.id.toLowerCase() !== cleanId);
    db.products = db.products.filter(p => p.vendeur_id.toLowerCase() !== cleanId);
    db.prospects = db.prospects.filter(pr => pr.vendeur_id.toLowerCase() !== cleanId);
    if (db.vendeurs.length !== beforeCount) {
      saveDatabase();
      return true;
    }
    return false;
  },

  // 6. GET VENDOR BY ID
  getVendorById(vendorId: string): Vendeur | null {
    const db = loadDatabase();
    const clean = vendorId.trim();
    const cleanDigits = clean.replace(/\D/g, '');
    const found = db.vendeurs.find(v => 
      v.id.toLowerCase() === clean.toLowerCase() || 
      (cleanDigits.length > 5 && v.phone.replace(/\D/g, '') === cleanDigits)
    );
    return found ? sanitizeVendor(found) : null;
  },

  // 7. VENDOR PROFILE & SECURITY UPDATE (PHONE, PASSWORD, BRANDING)
  updateVendorProfile(vendorId: string, data: {
    phone?: string;
    currentPassword?: string;
    newPassword?: string;
    name?: string;
    slogan?: string;
    location?: string;
    logo?: string;
    currency?: CurrencyType;
  }): { success: boolean; vendor?: Vendeur; error?: string; statusCode: number } {
    const db = loadDatabase();
    const cleanId = vendorId.trim().toLowerCase();
    const vendor = db.vendeurs.find(v => v.id.toLowerCase() === cleanId);
    if (!vendor) {
      return { success: false, error: 'Vendeur introuvable', statusCode: 404 };
    }

    // A. Password change verification
    if (data.newPassword && data.newPassword.trim().length > 0) {
      if (!data.currentPassword) {
        return { 
          success: false, 
          error: 'Veuillez saisir votre mot de passe actuel pour définir un nouveau mot de passe.', 
          statusCode: 400 
        };
      }
      const isMatch = bcrypt.compareSync(data.currentPassword, vendor.password_hash);
      if (!isMatch) {
        return { 
          success: false, 
          error: 'Le mot de passe actuel est incorrect.', 
          statusCode: 401 
        };
      }
      if (data.newPassword.trim().length < 4) {
        return { 
          success: false, 
          error: 'Le nouveau mot de passe doit comporter au moins 4 caractères.', 
          statusCode: 400 
        };
      }
      vendor.password_hash = bcrypt.hashSync(data.newPassword.trim(), 10);
    }

    // B. Phone change with duplicate check
    if (data.phone && data.phone.trim().length > 0) {
      const cleanPhone = normalizePhone(data.phone);
      const digitsOnly = cleanPhone.replace(/\D/g, '');
      if (digitsOnly.length < 6) {
        return { 
          success: false, 
          error: 'Numéro WhatsApp invalide (minimum 6 chiffres).', 
          statusCode: 400 
        };
      }

      // Check uniqueness against other vendors
      const duplicate = db.vendeurs.find(v => 
        v.id.toLowerCase() !== cleanId && 
        v.phone.replace(/\D/g, '') === digitsOnly
      );
      if (duplicate) {
        return { 
          success: false, 
          error: 'Ce numéro WhatsApp est déjà utilisé par un autre compte.', 
          statusCode: 400 
        };
      }
      vendor.phone = cleanPhone;
    }

    // C. Branding details
    if (data.name !== undefined && data.name.trim().length > 0) vendor.name = data.name.trim();
    if (data.slogan !== undefined) vendor.slogan = data.slogan.trim();
    if (data.location !== undefined) vendor.location = data.location.trim();
    if (data.logo !== undefined) vendor.logo = data.logo.trim();
    if (data.currency !== undefined) vendor.currency = data.currency;

    saveDatabase();
    return { success: true, vendor: sanitizeVendor(vendor), statusCode: 200 };
  },

  // 7b. UPDATE BRANDING WRAPPER
  updateBranding(vendorId: string, data: Partial<Vendeur>): Vendeur | null {
    const res = this.updateVendorProfile(vendorId, data);
    return res.vendor || null;
  },

  // 8. STRICT CATALOG ISOLATION: GET PRODUCTS FOR VENDOR ONLY
  getProductsForVendor(vendorId: string): Product[] {
    const db = loadDatabase();
    const clean = vendorId.trim().toLowerCase();
    return db.products.filter(p => p.vendeur_id.toLowerCase() === clean);
  },

  saveProductForVendor(
    vendorId: string, 
    data: Omit<Product, 'id' | 'vendeur_id' | 'created_at'> & { id?: string }
  ): Product {
    const db = loadDatabase();
    const cleanVendorId = vendorId.trim();

    if (data.id) {
      const idx = db.products.findIndex(p => p.id === data.id && p.vendeur_id.toLowerCase() === cleanVendorId.toLowerCase());
      if (idx >= 0) {
        const updatedProduct: Product = {
          ...db.products[idx],
          name: data.name,
          price: Number(data.price),
          original_price: data.original_price ? Number(data.original_price) : undefined,
          description: data.description,
          images: data.images,
          category: data.category || 'Général',
        };
        db.products[idx] = updatedProduct;
        saveDatabase();
        return updatedProduct;
      }
    }

    // New Product strictly attached to vendorId
    const newProduct: Product = {
      id: `prod_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      vendeur_id: cleanVendorId,
      name: data.name,
      price: Number(data.price),
      original_price: data.original_price ? Number(data.original_price) : undefined,
      description: data.description,
      images: data.images && data.images.length > 0 ? data.images : [
        'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=80',
      ],
      category: data.category || 'Général',
      created_at: new Date().toISOString(),
      clicks: 0,
    };

    db.products.unshift(newProduct);
    saveDatabase();
    return newProduct;
  },

  deleteProductForVendor(vendorId: string, productId: string): boolean {
    const db = loadDatabase();
    const cleanVendorId = vendorId.trim().toLowerCase();
    const beforeCount = db.products.length;
    db.products = db.products.filter(p => !(p.id === productId && p.vendeur_id.toLowerCase() === cleanVendorId));
    if (db.products.length !== beforeCount) {
      saveDatabase();
      return true;
    }
    return false;
  },

  // 9. PROSPECTS CRM STRICT ISOLATION
  getProspectsForVendor(vendorId: string): Prospect[] {
    const db = loadDatabase();
    const clean = vendorId.trim().toLowerCase();
    return db.prospects.filter(pr => pr.vendeur_id.toLowerCase() === clean);
  },

  saveProspectForVendor(
    vendorId: string,
    data: Omit<Prospect, 'id' | 'vendeur_id' | 'created_at'> & { id?: string }
  ): Prospect {
    const db = loadDatabase();
    const cleanVendorId = vendorId.trim();

    if (data.id) {
      const idx = db.prospects.findIndex(p => p.id === data.id && p.vendeur_id.toLowerCase() === cleanVendorId.toLowerCase());
      if (idx >= 0) {
        const updated: Prospect = {
          ...db.prospects[idx],
          name: data.name,
          phone: data.phone,
          notes: data.notes,
          status: data.status,
          last_contact: data.last_contact || new Date().toISOString(),
        };
        db.prospects[idx] = updated;
        saveDatabase();
        return updated;
      }
    }

    const newProspect: Prospect = {
      id: `prosp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      vendeur_id: cleanVendorId,
      name: data.name,
      phone: data.phone,
      notes: data.notes,
      status: data.status,
      created_at: new Date().toISOString(),
      last_contact: 'À l’instant',
    };

    db.prospects.unshift(newProspect);
    saveDatabase();
    return newProspect;
  },

  deleteProspectForVendor(vendorId: string, prospectId: string): boolean {
    const db = loadDatabase();
    const cleanVendorId = vendorId.trim().toLowerCase();
    const beforeCount = db.prospects.length;
    db.prospects = db.prospects.filter(p => !(p.id === prospectId && p.vendeur_id.toLowerCase() === cleanVendorId));
    if (db.prospects.length !== beforeCount) {
      saveDatabase();
      return true;
    }
    return false;
  },

  // 10. METRICS TRACKING
  trackView(vendorId: string, productId?: string) {
    const db = loadDatabase();
    const clean = vendorId.trim().toLowerCase();
    const vendor = db.vendeurs.find(v => v.id.toLowerCase() === clean);
    if (vendor) {
      vendor.views = (vendor.views || 0) + 1;
    }
    if (productId) {
      const prod = db.products.find(p => p.id === productId && p.vendeur_id.toLowerCase() === clean);
      if (prod) {
        prod.clicks = (prod.clicks || 0) + 1;
      }
    }
    saveDatabase();
  },

  trackConversion(vendorId: string, productId?: string) {
    const db = loadDatabase();
    const clean = vendorId.trim().toLowerCase();
    const vendor = db.vendeurs.find(v => v.id.toLowerCase() === clean);
    if (vendor) {
      vendor.conversions = (vendor.conversions || 0) + 1;
    }
    if (productId) {
      const prod = db.products.find(p => p.id === productId && p.vendeur_id.toLowerCase() === clean);
      if (prod) {
        prod.clicks = (prod.clicks || 0) + 1;
      }
    }
    saveDatabase();
  },

  // 11. CONFIG & TRIAL DAYS RECALCULATION
  // Changing trial_days immediately updates all active trial vendors in the system!
  getConfig(): SystemConfig & { admin_pin?: string } {
    const db = loadDatabase();
    return db.config || DEFAULT_SYSTEM_CONFIG;
  },

  updateConfig(newConfig: Partial<SystemConfig & { admin_pin?: string }>): SystemConfig & { admin_pin?: string } {
    const db = loadDatabase();
    db.config = { ...db.config, ...newConfig };

    // When trial_days is updated, update all vendors currently on trial!
    if (newConfig.trial_days !== undefined && Number(newConfig.trial_days) > 0) {
      const days = Number(newConfig.trial_days);
      for (const v of db.vendeurs) {
        if (v.status !== 'VIP') {
          const createdAtTime = new Date(v.created_at).getTime();
          v.date_expiration_essai = new Date(createdAtTime + days * 86400000).toISOString();
        }
      }
    }

    saveDatabase();
    return db.config;
  },
};
