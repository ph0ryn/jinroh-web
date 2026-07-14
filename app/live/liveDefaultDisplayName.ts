const DEFAULT_NAME_PREFIXES = [
  "Amber",
  "Azure",
  "Bright",
  "Calm",
  "Copper",
  "Coral",
  "Crimson",
  "Dawn",
  "Dusk",
  "Golden",
  "Hazel",
  "Indigo",
  "Ivory",
  "Jade",
  "Lunar",
  "Mint",
  "Misty",
  "Mossy",
  "Navy",
  "Noble",
  "Olive",
  "Quiet",
  "Ruby",
  "Silver",
  "Solar",
  "Swift",
  "Teal",
  "Verdant",
  "Violet",
  "Warm",
  "Wild",
  "Wise",
] as const;

const DEFAULT_NAME_SUFFIXES = [
  "Badger",
  "Bear",
  "Birch",
  "Brook",
  "Cedar",
  "Clover",
  "Comet",
  "Cove",
  "Deer",
  "Echo",
  "Ember",
  "Falcon",
  "Fern",
  "Finch",
  "Fox",
  "Grove",
  "Heron",
  "Juniper",
  "Lake",
  "Lark",
  "Lynx",
  "Maple",
  "Moss",
  "Oak",
  "Otter",
  "Owl",
  "Reed",
  "River",
  "Robin",
  "Sage",
  "Sparrow",
  "Wren",
] as const;

export const DEFAULT_DISPLAY_NAMES: readonly string[] = Object.freeze(
  DEFAULT_NAME_PREFIXES.flatMap((prefix) =>
    DEFAULT_NAME_SUFFIXES.map((suffix) => `${prefix} ${suffix}`),
  ),
);

const UINT32_RANGE = 0x1_0000_0000;

export function createDefaultDisplayName(
  randomUint32: () => number = readBrowserRandomUint32,
  names: readonly string[] = DEFAULT_DISPLAY_NAMES,
): string {
  if (names.length === 0 || names.length > UINT32_RANGE) {
    throw new Error("Default display names must contain between 1 and 2^32 entries.");
  }

  const unbiasedLimit = Math.floor(UINT32_RANGE / names.length) * names.length;
  let randomValue = randomUint32();

  assertUint32(randomValue);

  while (randomValue >= unbiasedLimit) {
    randomValue = randomUint32();
    assertUint32(randomValue);
  }

  const displayName = names[randomValue % names.length];

  if (displayName === undefined) {
    throw new Error("The display-name random selection was out of range.");
  }

  return displayName;
}

function assertUint32(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value >= UINT32_RANGE) {
    throw new Error("The display-name random source must return an unsigned 32-bit integer.");
  }
}

function readBrowserRandomUint32(): number {
  const values = new Uint32Array(1);

  globalThis.crypto.getRandomValues(values);

  const value = values[0];

  if (value === undefined) {
    throw new Error("Browser entropy was unavailable.");
  }

  return value;
}
