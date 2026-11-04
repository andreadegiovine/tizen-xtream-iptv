const DAY_MS = 24 * 3600 * 1000;
export const WARN_DAYS = 10;

/**
 * Notice for the provider's subscription: null when the end date is unknown or more than 9 days away,
 * otherwise { type: 'warning' | 'error', days, expired }. `days` counts whole days left (0 = today).
 */
export function subscriptionStatus(provider, now = Date.now()) {
  const until = provider && Number(provider.expiresAt);
  if (!until) return null;
  if (until < now) return { type: 'error', expired: true, days: 0, until };
  const days = Math.floor((until - now) / DAY_MS);
  if (days >= WARN_DAYS) return null;
  return { type: 'warning', expired: false, days, until };
}
