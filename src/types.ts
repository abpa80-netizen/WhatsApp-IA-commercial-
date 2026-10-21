export type CurrencyType = 'MAD' | 'CFA';

export type VendeurStatus = 'Gratuit' | 'VIP' | 'Actif' | 'Inactif' | 'Suspendu';

export type UserRole = 'seller' | 'admin' | 'vendeur';

export interface PublicStoreProfile {
  id: string;
  name: string;
  slogan: string;
  location: string;
  logo: string;
  currency: CurrencyType;
  status?: VendeurStatus;
  is_active?: boolean;
  hasFullCatalog?: boolean; // Minimal activation state: true if full catalog is allowed, false if limited to 4 products
  isVipActive?: boolean; // Safe public entitlement flag; never exposes subscription dates
  publicSlug: string;
  orderWhatsApp?: string; // Optional commercial contact for WhatsApp checkout if explicitly provided AND allowed
  allowCommercialContact?: boolean;
  plan?: string;
  trialEndsAt?: string;
  vipEndsAt?: string;
}

export interface Vendeur {
  id: string;
  uid?: string; // Firebase Auth UID
  phone: string;
  whatsappNumber?: string;
  phoneNormalized?: string;
  useLoginNumberAsPublic?: boolean; // Explicit opt-in: Use registered login WhatsApp number as public commercial contact
  commercialWhatsApp?: string; // Explicit public commercial phone number (distinct from private login)
  allowCommercialContact?: boolean; // Merchant explicitly authorises displaying commercial WhatsApp
  name: string;
  slogan: string;
  location: string;
  logo: string;
  currency: CurrencyType;
  status: VendeurStatus;
  role?: UserRole;
  is_active?: boolean;
  plan?: 'Gratuit' | 'Essai' | 'VIP' | string;
  trialStartedAt?: string;
  trialEndsAt?: string;
  vipStartedAt?: string;
  vipEndsAt?: string;
  publicSlug?: string;
  date_expiration_essai: string;
  created_at: string;
  createdAt?: string;
  updatedAt?: string;
  views?: number;
  product_clicks?: number;
  conversions?: number;
}

export interface AuthResponse {
  success: boolean;
  isNew: boolean;
  message: string;
  user: Vendeur;
  token?: string;
}

export interface Product {
  id: string;
  vendeur_id: string;
  name: string;
  price: number;
  original_price?: number;
  description: string;
  images: string[];
  created_at: string;
  createdAt?: string;
  updatedAt?: string;
  category?: string;
  clicks?: number;
}

export type ProspectStatus = 'Nouveau' | 'Intéressé' | 'À relancer' | 'Converti' | 'Perdu';

export interface Prospect {
  id: string;
  vendeur_id: string;
  name: string;
  phone: string;
  notes: string;
  status: ProspectStatus;
  created_at: string;
  createdAt?: string;
  updatedAt?: string;
  last_contact?: string;
}

export type OrderStatus = 'Nouveau' | 'Confirmée' | 'En préparation' | 'Expédiée' | 'Livrée' | 'Annulée';

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  total: number;
  image?: string;
}

export interface StructuredOrder {
  id: string;
  vendeur_id: string; // Firebase UID du vendeur
  customerName: string;
  customerWhatsApp: string;
  deliveryAddress: string;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  currency: CurrencyType;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface SystemConfig {
  price_vip: number;
  price_vip_cfa: number;
  trial_days: number;
  whatsapp_support: string;
  freeProductLimit?: number; // Default 4
  trialDays?: number;
  vipPrice?: number;
  vipPriceCfa?: number;
  supportWhatsapp?: string;
  updatedAt?: string;
}

export interface AdminData {
  total_vendeurs: number;
  total_products: number;
  total_views: number;
  total_conversions: number;
  vendeurs: Vendeur[];
}

export interface DailyVisitStat {
  fullDate: string;
  date: string;
  displayDate: string;
  views: number;
  clicks: number;
  conversions: number;
}

export type AIMessageObjective = 'prospection' | 'relance' | 'objections' | 'promo';
export type AIMessageTone = 'amical' | 'pro' | 'urgent' | 'persuasif';

export interface AIMessageParams {
  productName: string;
  targetAudience: string;
  price: string;
  currency: CurrencyType;
  objective: AIMessageObjective;
  tone: AIMessageTone;
  prospectName?: string;
  sellerName?: string;
}
