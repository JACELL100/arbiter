import { cn } from "@/lib/utils";
import type { ProjectStatus } from "@/lib/types";

/** Page title row used at the top of every screen. */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Empty state: short title, one line of help, one action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-14 text-center", className)}>
      {Icon && (
        <div className="mb-3 grid size-10 place-items-center rounded-md border bg-muted/50">
          <Icon className="size-5 text-muted-foreground" strokeWidth={1.75} />
        </div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const STATUS_STYLE: Record<ProjectStatus, string> = {
  draft: "border-border bg-muted text-muted-foreground",
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  paused: "border-amber-200 bg-amber-50 text-amber-700",
  completed: "border-border bg-background text-foreground",
};

export function StatusBadge({ status, className }: { status: ProjectStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 rounded-md border px-1.5 text-xs font-medium capitalize",
        STATUS_STYLE[status],
        className,
      )}
    >
      {status === "active" && <span className="size-1.5 rounded-full bg-emerald-500" />}
      {status}
    </span>
  );
}

/** Small neutral/semantic pill for inline tags (gold, disputed, too fast...). */
export function Pill({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "neutral" | "good" | "warn" | "bad" | "info";
  children: React.ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: "border-border bg-muted text-muted-foreground",
    good: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warn: "border-amber-200 bg-amber-50 text-amber-800",
    bad: "border-red-200 bg-red-50 text-red-700",
    info: "border-sky-200 bg-sky-50 text-sky-700",
  };
  return (
    <span className={cn("inline-flex h-5 items-center rounded-md border px-1.5 text-xs font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}

/** Compact metric tile. */
export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border bg-card p-4", className)}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="tabular mt-1.5 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
