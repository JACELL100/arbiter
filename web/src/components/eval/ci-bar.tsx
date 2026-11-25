import { cn } from "@/lib/utils";

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Horizontal interval on a 0–100% axis: whisker from lo to hi, a point at the estimate,
 * and a faint reference tick at 50%.
 */
export function CiBar({
  value,
  lo,
  hi,
  className,
}: {
  value: number;
  lo: number;
  hi: number;
  className?: string;
}) {
  const v = clamp(value) * 100;
  const l = clamp(Math.min(lo, hi)) * 100;
  const h = clamp(Math.max(lo, hi)) * 100;
  return (
    <div
      className={cn("relative h-4 w-full min-w-24", className)}
      role="img"
      aria-label={`${v.toFixed(0)}% (95% CI ${l.toFixed(0)}–${h.toFixed(0)}%)`}
    >
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
      <div className="absolute top-1/2 left-1/2 h-2.5 w-px -translate-y-1/2 bg-muted-foreground/40" />
      <div
        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-foreground/15"
        style={{ left: `${l}%`, width: `${Math.max(h - l, 0.5)}%` }}
      />
      <div className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-foreground/50" style={{ left: `${l}%` }} />
      <div className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-foreground/50" style={{ left: `${h}%` }} />
      <div
        className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-background"
        style={{ left: `${v}%` }}
      />
    </div>
  );
}

/**
 * Centred bias meter: track from 0–100%, filled from 50% to the value. Tone turns amber
 * when outside the [warnLo, warnHi] band.
 */
export function CenteredBar({
  value,
  warn,
  className,
}: {
  value: number;
  warn?: boolean;
  className?: string;
}) {
  const v = clamp(value) * 100;
  const left = Math.min(v, 50);
  const width = Math.abs(v - 50);
  return (
    <div className={cn("relative h-1.5 w-full rounded-full bg-muted", className)}>
      <div
        className={cn("absolute inset-y-0 rounded-full", warn ? "bg-amber-500" : "bg-foreground/70")}
        style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%` }}
      />
      <div className="absolute -top-1 -bottom-1 left-1/2 w-px bg-muted-foreground/50" />
    </div>
  );
}
