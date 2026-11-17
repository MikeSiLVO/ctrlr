/** Degrees to turn the right-pointing chevron for each direction. */
const ROTATION = { right: 0, down: 90, left: 180, up: 270 } as const;

/** Stroked chevron pointing the given way, in the current text color. */
export function ChevronIcon({ direction, size = 12, className, style }: {
  direction: keyof typeof ROTATION;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 12 12" fill="none" className={className}
      style={{ ...style, transform: ROTATION[direction] ? `rotate(${ROTATION[direction]}deg)` : undefined }}
    >
      <path d="M4.25 2.5L7.75 6L4.25 9.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Stroked X in the current text color. */
export function CloseIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Outline house in the current text color. */
export function HomeIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path
        d="M1.5 5.5L6 1.75L10.5 5.5M2.75 4.5V10.25H5V7.5H7V10.25H9.25V4.5"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

/** Filled triangle marking a sorted column's direction. */
export function SortIcon({ asc, className }: { asc: boolean; className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className={className}>
      {/* offset toward the point; a triangle's weight sits on its wide edge */}
      <path d={asc ? "M6 2.5L10.5 7.5H1.5Z" : "M1.5 4.5H10.5L6 9.5Z"} />
    </svg>
  );
}

/** Column header label with its sort arrow outside the label's own width. */
export function SortLabel({ label, sorted, asc, align }: {
  label: string;
  sorted: boolean;
  asc: boolean;
  align: "left" | "right";
}) {
  return (
    <span className="relative inline-flex items-center">
      {label}
      {sorted && (
        <SortIcon
          asc={asc}
          className={`absolute ${align === "right" ? "right-full mr-1" : "left-full ml-1"}`}
        />
      )}
    </span>
  );
}
