import { cn } from "@/lib/utils";

/** Wordmark: two offset squares (A vs B) + name. Plain, no gradients. */
export function Logo({ className, showText = true }: { className?: string; showText?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 20 20" className="size-5" aria-hidden>
        <rect x="1.5" y="1.5" width="10" height="10" rx="2" className="fill-foreground" />
        <rect x="8.5" y="8.5" width="10" height="10" rx="2" className="fill-background stroke-foreground" strokeWidth="1.5" />
      </svg>
      {showText && <span className="text-[15px] font-semibold tracking-tight">Arbiter</span>}
    </span>
  );
}
