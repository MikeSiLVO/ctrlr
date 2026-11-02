/** Compact RSS dialog button in neutral, danger or accent style. */
export function SmallButton({
  label,
  onClick,
  disabled,
  variant,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "danger" | "accent";
}) {
  const bg =
    variant === "danger"
      ? "var(--danger)"
      : variant === "accent"
        ? "var(--accent)"
        : "var(--bg-tertiary)";
  const color = variant === "accent" ? "#fff" : "var(--text-primary)";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-2 py-1 rounded text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      style={{ background: bg, color }}
    >
      {label}
    </button>
  );
}
