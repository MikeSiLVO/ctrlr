/** Label and value row in a detail tab. */
export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex py-0.5">
      <span
        className="w-24 shrink-0"
        style={{ color: "var(--text-secondary)" }}
      >
        {label}
      </span>
      <span>{value}</span>
    </div>
  );
}
