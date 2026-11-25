"use client";

import { cn } from "@/lib/utils";
import type { Preference, Sign } from "@/lib/types";

export const PREFERENCE_OPTIONS: { value: Preference; label: string; short: string }[] = [
  { value: -2, label: "A much better", short: "A≫" },
  { value: -1, label: "A better", short: "A>" },
  { value: 0, label: "Tie", short: "=" },
  { value: 1, label: "B better", short: "B>" },
  { value: 2, label: "B much better", short: "B≫" },
];

/** Five-point preference scale (-2..2). Labels read A/B; the caller decides whether those are screen or canonical. */
export function PreferenceScale({
  value,
  onChange,
  showKbd = false,
  disabled = false,
  className,
  "aria-label": ariaLabel = "Overall preference",
}: {
  value: Preference | null;
  onChange: (v: Preference) => void;
  showKbd?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("grid grid-cols-5 gap-1.5", className)}>
      {PREFERENCE_OPTIONS.map((o, i) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-1 rounded-md border px-1 py-1.5 text-center text-xs leading-tight transition-colors outline-none",
              "focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60",
              selected
                ? "border-foreground bg-foreground font-medium text-background"
                : "bg-background text-foreground hover:bg-muted",
              o.value === 0 && !selected && "bg-muted/40",
            )}
          >
            {showKbd && (
              <kbd className={cn(selected && "border-background/30 bg-background/15 text-background")}>{i + 1}</kbd>
            )}
            <span className="text-balance">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Three-way segmented control for a single rubric criterion: -1 A, 0 tie, 1 B. */
export function TriToggle({
  value,
  onChange,
  disabled = false,
  showKbd = false,
  label,
  className,
}: {
  value: Sign | null;
  onChange: (v: Sign) => void;
  disabled?: boolean;
  showKbd?: boolean;
  label: string;
  className?: string;
}) {
  const opts: { v: Sign; text: string; key: string }[] = [
    { v: -1, text: "A", key: "q" },
    { v: 0, text: "Tie", key: "w" },
    { v: 1, text: "B", key: "e" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex h-7 shrink-0 items-stretch rounded-md border bg-background p-0.5", className)}
    >
      {opts.map((o) => {
        const selected = value === o.v;
        return (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(o.v)}
            title={showKbd ? `${o.text} (${o.key.toUpperCase()})` : undefined}
            className={cn(
              "min-w-11 rounded-[5px] px-2 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60",
              selected ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {o.text}
          </button>
        );
      })}
    </div>
  );
}
