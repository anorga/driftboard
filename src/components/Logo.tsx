export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Driftboard">
      <rect x="4" y="4" width="56" height="56" rx="14" fill="#6366f1" />
      <path
        d="M18 40c6-16 10-20 13-18s-2 12 1 13 8-9 11-7-1 9 2 10"
        fill="none"
        stroke="#fff"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="46" cy="20" r="4" fill="#fbbf24" />
    </svg>
  );
}
