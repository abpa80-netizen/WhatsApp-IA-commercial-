import { Vendeur } from '../types';

export interface VendorEntitlements {
  isVipActive: boolean;
  isTrialActive: boolean;
  isFreeMode: boolean;
  hasPremiumAccess: boolean;
  publicProductLimit: number | null;
}

const TRIAL_DURATION_MS = 3 * 24 * 60 * 60 * 1000;
const FREE_PUBLIC_PRODUCT_LIMIT = 4;

/** One source of truth for client-side feature access. Missing/invalid trial dates fail closed. */
export function getVendorEntitlements(vendeur: Partial<Vendeur> | null | undefined, now = Date.now()): VendorEntitlements {
  if (!vendeur) {
    return { isVipActive: false, isTrialActive: false, isFreeMode: true, hasPremiumAccess: false, publicProductLimit: FREE_PUBLIC_PRODUCT_LIMIT };
  }

  const vipEndsAt = vendeur.vipEndsAt ? new Date(vendeur.vipEndsAt).getTime() : Number.NaN;
  const vipIsExpired = Number.isFinite(vipEndsAt) && vipEndsAt <= now;
  const isVipActive = (vendeur.status === 'VIP' || vendeur.plan === 'VIP') && !vipIsExpired;
  if (isVipActive) {
    return { isVipActive: true, isTrialActive: false, isFreeMode: false, hasPremiumAccess: true, publicProductLimit: null };
  }

  const trialEndValue = vendeur.trialEndsAt || vendeur.date_expiration_essai;
  const explicitTrialEnd = trialEndValue ? new Date(trialEndValue).getTime() : Number.NaN;
  const trialStartValue = vendeur.trialStartedAt || vendeur.createdAt || vendeur.created_at;
  const trialStart = trialStartValue ? new Date(trialStartValue).getTime() : Number.NaN;
  // Match the trial banner: registration time + 3 days is authoritative when available,
  // so a stale legacy expiration field can never extend a trial.
  const trialEnd = Number.isFinite(trialStart)
    ? trialStart + TRIAL_DURATION_MS
    : explicitTrialEnd;
  const statusAllowsTrial = vendeur.status !== 'VIP' && vendeur.status !== 'Gratuit' && vendeur.status !== 'Inactif' && vendeur.status !== 'Suspendu' && vendeur.plan !== 'VIP' && vendeur.plan !== 'Gratuit';
  const isTrialActive = statusAllowsTrial && Number.isFinite(trialEnd) && trialEnd > now;
  const isFreeMode = !isTrialActive;

  return {
    isVipActive: false,
    isTrialActive,
    isFreeMode,
    hasPremiumAccess: isTrialActive,
    publicProductLimit: FREE_PUBLIC_PRODUCT_LIMIT,
  };
}
