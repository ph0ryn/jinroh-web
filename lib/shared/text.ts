export function getCodePointLength(value: string): number {
  return Array.from(value).length;
}

export function truncateCodePoints(value: string, maximumLength: number): string {
  return Array.from(value).slice(0, maximumLength).join("");
}
