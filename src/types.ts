export type CurrencyType = 'MAD' | 'CFA';

export type VendeurStatus = 'Gratuit' | 'VIP' | 'Actif' | 'Inactif';

export interface Vendeur {
  id: string;
  phone: string;
  name: string;
  slogan: string;
  location: string;
  logo: string;
  currency: CurrencyType;
  status: VendeurStatus;
  is_active?: boolean;
  role?: 'admin' | 'vendeur';
  date_expiration_essai: string;
  created_at: string;
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
  last_contact?: string;
}

export interface SystemConfig {
  price_vip: number;
  price_vip_cfa: number;
  trial_days: number;
  whatsapp_support: string;
}

export interface AdminData {
  total_vendeurs: number;
  total_products: number;
  total_views: number;
  total_conversions: number;
  vendeurs: Vendeur[];
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
