export type RuleSetNumberField =
  | "dayReadyCheckSecondsPerPlayer"
  | "daySpeechSeconds"
  | "executionLastWordsSeconds"
  | "firstDaySpeechRounds"
  | "firstNightSeconds"
  | "nightSeconds"
  | "normalDaySpeechRounds"
  | "votingSeconds";

export type RuleSetNumberLimit = {
  readonly max: number;
  readonly min: number;
};

export const RULE_SET_NUMBER_FIELDS: readonly RuleSetNumberField[] = [
  "dayReadyCheckSecondsPerPlayer",
  "daySpeechSeconds",
  "executionLastWordsSeconds",
  "firstDaySpeechRounds",
  "firstNightSeconds",
  "nightSeconds",
  "normalDaySpeechRounds",
  "votingSeconds",
];

export const RULE_SET_NUMBER_LIMITS: Readonly<Record<RuleSetNumberField, RuleSetNumberLimit>> = {
  dayReadyCheckSecondsPerPlayer: { max: 300, min: 1 },
  daySpeechSeconds: { max: 300, min: 1 },
  executionLastWordsSeconds: { max: 300, min: 1 },
  firstDaySpeechRounds: { max: 5, min: 1 },
  firstNightSeconds: { max: 300, min: 1 },
  nightSeconds: { max: 600, min: 1 },
  normalDaySpeechRounds: { max: 5, min: 1 },
  votingSeconds: { max: 300, min: 1 },
};

export function isValidRuleSetNumber(field: RuleSetNumberField, value: unknown): value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return false;
  }

  const limits = RULE_SET_NUMBER_LIMITS[field];

  return value >= limits.min && value <= limits.max;
}
