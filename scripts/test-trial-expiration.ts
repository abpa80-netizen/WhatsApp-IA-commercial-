import { computeVendorEntitlements } from '../src/server/entitlementsService.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[PASS] ${message}`);
}

const now = Date.parse('2026-10-14T12:00:00.000Z');
const day = 86400000;
const startDaysAgo = (days: number) => new Date(now - days * day).toISOString();
const endAfterStart = (start: string, days: number) =>
  new Date(Date.parse(start) + days * day).toISOString();

const tenDaysAgo = startDaysAgo(10);
const longerTrial = computeVendorEntitlements({
  uid: 'seller-longer-trial',
  status: 'Actif',
  plan: 'Essai',
  trialStartedAt: tenDaysAgo,
  trialEndsAt: endAfterStart(tenDaysAgo, 7), // stale stored date
}, now, 14);
assert(
  longerTrial.reason === 'trial_active' && longerTrial.hasFullCatalog,
  'An admin-extended trial follows trialStartedAt + configuredTrialDays, not stale trialEndsAt'
);

const sixDaysAgo = startDaysAgo(6);
const shorterTrial = computeVendorEntitlements({
  uid: 'seller-shorter-trial',
  status: 'Actif',
  plan: 'Essai',
  trialStartedAt: sixDaysAgo,
  trialEndsAt: endAfterStart(sixDaysAgo, 7), // stale future date
}, now, 5);
assert(
  shorterTrial.reason === 'trial_expired' && !shorterTrial.hasFullCatalog,
  'A shortened trial expires at the newly configured duration despite stale future trialEndsAt'
);

const fourDaysAgo = startDaysAgo(4);
const fixedThreeDayTrial = computeVendorEntitlements({
  uid: 'seller-fixed-three-day-trial',
  status: 'Actif',
  plan: 'Essai',
  trialStartedAt: fourDaysAgo,
  trialEndsAt: endAfterStart(fourDaysAgo, 7), // stale legacy date
}, now, 3);
assert(
  fixedThreeDayTrial.reason === 'trial_expired' && !fixedThreeDayTrial.hasFullCatalog,
  'The fixed three-day policy expires a seller after three days even when the stored date is stale'
);

const twoDaysAgo = startDaysAgo(2);
const activeThreeDayTrial = computeVendorEntitlements({
  uid: 'seller-active-three-day-trial',
  status: 'Actif',
  plan: 'Essai',
  trialStartedAt: twoDaysAgo,
}, now, 3);
assert(
  activeThreeDayTrial.reason === 'trial_active' && activeThreeDayTrial.hasFullCatalog,
  'The fixed three-day policy keeps a seller eligible during the first three days'
);

const eightDaysAgo = startDaysAgo(8);
const expiredTrial = computeVendorEntitlements({
  uid: 'seller-expired-trial',
  status: 'Actif',
  plan: 'Essai',
  trialStartedAt: eightDaysAgo,
  trialEndsAt: endAfterStart(eightDaysAgo, 7),
}, now, 7);
assert(
  expiredTrial.reason === 'trial_expired' && !expiredTrial.hasFullCatalog && expiredTrial.is_active,
  'An expired trial is restricted while the seller account remains active'
);

if (process.exitCode) {
  throw new Error('Trial expiration tests failed.');
}
console.log('Trial expiration tests passed.');
