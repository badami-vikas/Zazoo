// Rate limiting & pacing (architecture doc S7: "max_apps_per_day=40,
// max_apps_per_ats_domain_per_day=5 ... enforced in Dispatcher/SourcingService against
// source_quota; hitting a cap defers to the next burst, never drops"). Pure in-memory counters —
// persistence (the real `source_quota` table) is a future DB concern; the policy shape (defer,
// don't drop) is what this module guarantees and is what's worth testing now.

export interface PacingLimits {
  maxPerDay: number;
  maxPerAtsDomainPerDay: number;
}

export interface PacingGate {
  // Whether one more application may be dispatched today for this ATS domain, given everything
  // recorded so far. Never mutates — check before you record.
  canApply(day: string, atsDomain: string): boolean;
  // Records a dispatched application. Caller must have checked canApply first; recording past a
  // cap is a caller bug, not something this module silently corrects.
  record(day: string, atsDomain: string): void;
  countForDay(day: string): number;
  countForAtsDomain(day: string, atsDomain: string): number;
}

export function createPacingGate(limits: PacingLimits): PacingGate {
  const perDay = new Map<string, number>();
  const perDayPerDomain = new Map<string, number>();
  const domainKey = (day: string, atsDomain: string) => `${day}::${atsDomain}`;

  function canApply(day: string, atsDomain: string): boolean {
    const dayCount = perDay.get(day) ?? 0;
    const domainCount = perDayPerDomain.get(domainKey(day, atsDomain)) ?? 0;
    return dayCount < limits.maxPerDay && domainCount < limits.maxPerAtsDomainPerDay;
  }

  function record(day: string, atsDomain: string): void {
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
    const key = domainKey(day, atsDomain);
    perDayPerDomain.set(key, (perDayPerDomain.get(key) ?? 0) + 1);
  }

  function countForDay(day: string): number {
    return perDay.get(day) ?? 0;
  }

  function countForAtsDomain(day: string, atsDomain: string): number {
    return perDayPerDomain.get(domainKey(day, atsDomain)) ?? 0;
  }

  return { canApply, record, countForDay, countForAtsDomain };
}
