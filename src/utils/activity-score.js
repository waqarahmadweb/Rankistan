const MEANINGFUL_EVENT_TYPES = new Set([
  'PushEvent',
  'PullRequestEvent',
  'IssuesEvent',
  'ReleaseEvent'
]);

const EVENT_TYPE_TO_KEY = {
  PushEvent: 'push',
  PullRequestEvent: 'pr',
  IssuesEvent: 'issue',
  ReleaseEvent: 'release'
};

const COUNT_KEY_TO_TYPE = {
  pushes: 'push',
  prs: 'pr',
  issues: 'issue',
  releases: 'release'
};

export const SCORING_WINDOW_DAYS = 30;

export { MEANINGFUL_EVENT_TYPES, EVENT_TYPE_TO_KEY };

function resolveConfig(options) {
  const config = options?.config;
  if (!config || typeof config !== 'object') {
    throw new Error('activity-score: options.config is required');
  }
  return config;
}

export function getActivityScoringConfig(config) {
  const fromConfig = config?.ACTIVITY_SCORING;
  if (fromConfig && typeof fromConfig === 'object') {
    return fromConfig;
  }

  const weights = config?.WEIGHTS || {};
  return {
    push: { base: weights.push ?? 2, dailyCap: 15, maxCountedPerDay: 20 },
    issue: { base: weights.issue ?? 1.5, dailyCap: 15 },
    pr: { base: weights.pr ?? 4, dailyCap: 25 },
    release: { base: weights.release ?? 5, dailyCap: 20 }
  };
}

export function marginalPoints(n, base) {
  return base / Math.log2(n + 1);
}

export function scoreDayType(count, typeConfig) {
  const safeCount = Math.max(0, Math.floor(Number(count) || 0));
  if (safeCount === 0) {
    return 0;
  }

  const { base, dailyCap, maxCountedPerDay } = typeConfig;
  const limit = maxCountedPerDay != null ? Math.min(safeCount, maxCountedPerDay) : safeCount;
  let sum = 0;

  for (let n = 1; n <= limit; n += 1) {
    sum += marginalPoints(n, base);
  }

  return Math.min(dailyCap, sum);
}

function utcDayKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return null;
  }

  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function bucketEventsByUtcDay(events, cutoffMs, now = Date.now()) {
  const buckets = new Map();

  for (const event of events || []) {
    if (!MEANINGFUL_EVENT_TYPES.has(event?.type)) {
      continue;
    }

    const ts = new Date(event.created_at).getTime();
    if (Number.isNaN(ts) || ts < now - cutoffMs) {
      continue;
    }

    const dayKey = utcDayKey(event.created_at);
    const typeKey = EVENT_TYPE_TO_KEY[event.type];
    if (!dayKey || !typeKey) {
      continue;
    }

    const bucketKey = `${dayKey}|${typeKey}`;
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, []);
    }
    buckets.get(bucketKey).push(event);
  }

  return buckets;
}

function createEmptyActivityByType() {
  return {
    push: { points: 0, events30d: 0 },
    pr: { points: 0, events30d: 0 },
    issue: { points: 0, events30d: 0 },
    release: { points: 0, events30d: 0 }
  };
}

export function computeActivityBreakdown30d(events, options = {}) {
  const config = resolveConfig(options);
  const now = options.now ?? Date.now();
  const activityScoring = getActivityScoringConfig(config);
  const cutoffMs = SCORING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const buckets = bucketEventsByUtcDay(events, cutoffMs, now);
  const byType = createEmptyActivityByType();

  for (const [, dayEvents] of buckets) {
    const typeKey = EVENT_TYPE_TO_KEY[dayEvents[0]?.type];
    if (!typeKey || !activityScoring[typeKey]) {
      continue;
    }

    byType[typeKey].events30d += dayEvents.length;
    dayEvents.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    byType[typeKey].points += scoreDayType(dayEvents.length, activityScoring[typeKey]);
  }

  const total = Object.values(byType).reduce((sum, row) => sum + row.points, 0);

  return { total, byType };
}

export function computeActivityScore30d(events, options = {}) {
  return computeActivityBreakdown30d(events, options).total;
}

export function computeActivityScore30dFromCounts(eventCounts, options = {}) {
  const config = resolveConfig(options);
  const activityScoring = getActivityScoringConfig(config);
  let total = 0;

  for (const [countKey, typeKey] of Object.entries(COUNT_KEY_TO_TYPE)) {
    const count = eventCounts?.[countKey] || 0;
    total += scoreDayType(count, activityScoring[typeKey]);
  }

  return total;
}
