import { cn } from "@/lib/utils";

/** Stacked A / tie / B vote bar with counts. Canonical A/B. */
export function VoteBar({
  votes,
  className,
  showCounts = true,
}: {
  votes: { a: number; tie: number; b: number };
  className?: string;
  showCounts?: boolean;
}) {
  const total = votes.a + votes.tie + votes.b;
  const w = (n: number) => (total ? `${(n / total) * 100}%` : "0%");
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <div
        className="flex h-1.5 w-20 shrink-0 gap-px overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`A ${votes.a}, tie ${votes.tie}, B ${votes.b}`}
      >
        {votes.a > 0 && <div className="h-full bg-foreground" style={{ width: w(votes.a) }} />}
        {votes.tie > 0 && <div className="h-full bg-muted-foreground/40" style={{ width: w(votes.tie) }} />}
        {votes.b > 0 && <div className="h-full bg-muted-foreground" style={{ width: w(votes.b) }} />}
      </div>
      {showCounts && (
        <span className="tabular font-mono text-xs whitespace-nowrap text-muted-foreground">
          <span className="text-foreground">{votes.a}</span> A · {votes.tie} = · <span className="text-foreground">{votes.b}</span> B
        </span>
      )}
    </div>
  );
}
