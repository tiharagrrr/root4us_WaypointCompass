/**
 * Username prefixes of the synthetic staff the seed makes for every vehicle
 * (drv.) and outlet (mgr.). The demo account menu leaves them out, so it lists
 * only the named personas.
 */
export const SEEDED_STAFF_PREFIXES = ['drv.', 'mgr.'] as const;

export const isSeededStaff = (username: string | null | undefined): boolean =>
  SEEDED_STAFF_PREFIXES.some((prefix) => username?.startsWith(prefix) ?? false);
