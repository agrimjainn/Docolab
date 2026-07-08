"use client";

// Initials avatar for the admin panel. The backend gives us a display_name and
// an optional avatar_color (no photo URLs), so we render initials on a tinted
// glass disc, with an optional presence dot.
export function InitialsAvatar({
  name,
  color,
  size = 40,
  online,
}: {
  name: string;
  color?: string | null;
  size?: number;
  online?: boolean;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const bg = color || "#0e4d6e";
  const dot = Math.max(9, Math.round(size * 0.28));

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="flex h-full w-full items-center justify-center rounded-full border border-[rgba(125,211,252,0.2)] font-semibold text-[var(--gl-on-primary-container)]"
        style={{ background: bg, fontSize: size * 0.36 }}
      >
        {initials || "?"}
      </div>
      {online !== undefined && (
        <span
          className={`absolute bottom-0 right-0 rounded-full border-2 border-[var(--gl-surface)] ${
            online ? "gl-dot-online" : "gl-dot-offline"
          }`}
          style={{ width: dot, height: dot }}
        />
      )}
    </div>
  );
}
