import assert from 'node:assert/strict';
import { getVendorEntitlements } from '../src/services/entitlements';

const now = Date.parse('2026-10-15T12:00:00.000Z');
const day = 24 * 60 * 60 * 1000;

const activeTrial = getVendorEntitlements({
  status: 'Actif', plan: 'Essai',
  trialStartedAt: new Date(now - day).toISOString(),
  trialEndsAt: new Date(now + 30 * day).toISOString(),
}, now);
assert.equal(activeTrial.hasPremiumAccess, true, 'an active trial should unlock premium features');

const expiredTrial = getVendorEntitlements({
  status: 'Actif', plan: 'Essai',
  trialStartedAt: new Date(now - 4 * day).toISOString(),
  trialEndsAt: new Date(now + 30 * day).toISOString(),
}, now);
assert.equal(expiredTrial.hasPremiumAccess, false, 'stale future expiry must not extend a 3-day trial');
assert.equal(expiredTrial.publicProductLimit, 4, 'expired trial should fall back to the four-product public limit');

const freeSeller = getVendorEntitlements({ status: 'Gratuit', plan: 'Gratuit', trialStartedAt: new Date(now - day).toISOString() }, now);
assert.equal(freeSeller.hasPremiumAccess, false, 'free mode must not unlock premium features');

const activeVip = getVendorEntitlements({ status: 'VIP', plan: 'VIP' }, now);
assert.equal(activeVip.hasPremiumAccess, true, 'VIP without an expiry date is active');
assert.equal(activeVip.publicProductLimit, null, 'active VIP should have an unlimited public catalog');

const expiredVip = getVendorEntitlements({
  status: 'VIP', plan: 'VIP',
  vipEndsAt: new Date(now - 1000).toISOString(),
  trialStartedAt: new Date(now - day).toISOString(),
}, now);
assert.equal(expiredVip.hasPremiumAccess, false, 'expired VIP must not fall back into a still-dated trial');

const missingDates = getVendorEntitlements({ status: 'Actif', plan: 'Essai' }, now);
assert.equal(missingDates.hasPremiumAccess, false, 'missing trial dates must fail closed');

console.log('Entitlement tests passed (trial, free, VIP, expirations).');
