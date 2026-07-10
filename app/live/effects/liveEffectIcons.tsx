type LiveEffectIconProps = {
  readonly className?: string;
};

export function SoulFeatherIcon({ className }: LiveEffectIconProps) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path
        d="M20 4C12 3 6 7 5 15l-2 5 5-2c8-1 12-7 12-14Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.45"
      />
      <path
        d="M6 17 17 7M10 13h5M8 16v-4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.45"
      />
    </svg>
  );
}

export function VictoryCrestIcon({ className }: LiveEffectIconProps) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 64 64">
      <path
        d="M14 19 25 28 32 12l7 16 11-9-5 27H19l-5-27Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2.5"
      />
      <path d="M21 52h22" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
      <circle cx="14" cy="16" fill="currentColor" r="2.5" />
      <circle cx="32" cy="9" fill="currentColor" r="2.5" />
      <circle cx="50" cy="16" fill="currentColor" r="2.5" />
    </svg>
  );
}
