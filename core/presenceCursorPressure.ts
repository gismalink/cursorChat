export type PresenceCursorSendRates = {
  audienceSize: number;
  tier: "low" | "medium" | "high" | "very_high" | "critical";
  pointerHz: number;
  textHz: number;
};

const POINTER_HZ_MAX = 20;
const TEXT_HZ_MAX = 15;
const POINTER_HZ_MIN = 3;
const TEXT_HZ_MIN = 2;

function clampHz(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

export function normalizePresenceCursorAudienceSize(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(1, Math.floor(parsed));
}

export function resolvePresenceCursorSendRates(audienceSizeInput: unknown): PresenceCursorSendRates {
  const audienceSize = normalizePresenceCursorAudienceSize(audienceSizeInput);

  if (audienceSize <= 15) {
    return {
      audienceSize,
      tier: "low",
      pointerHz: POINTER_HZ_MAX,
      textHz: TEXT_HZ_MAX
    };
  }

  if (audienceSize <= 40) {
    return {
      audienceSize,
      tier: "medium",
      pointerHz: 12,
      textHz: 10
    };
  }

  if (audienceSize <= 80) {
    return {
      audienceSize,
      tier: "high",
      pointerHz: 8,
      textHz: 6
    };
  }

  if (audienceSize <= 150) {
    return {
      audienceSize,
      tier: "very_high",
      pointerHz: 5,
      textHz: 4
    };
  }

  return {
    audienceSize,
    tier: "critical",
    pointerHz: POINTER_HZ_MIN,
    textHz: TEXT_HZ_MIN
  };
}

export function minIntervalMsForHz(hz: number): number {
  const normalizedHz = clampHz(hz, POINTER_HZ_MIN, POINTER_HZ_MAX);
  return 1000 / normalizedHz;
}
