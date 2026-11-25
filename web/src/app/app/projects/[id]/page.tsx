"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from "recharts";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Copy,
  Download,
  Loader2,
  PenLine,
  RotateCcw,
} from "lucide-react";
import { api } from "@/lib/api";
import { agreementBand, int, num, pct } from "@/lib/format";
import type { ProjectStats, ProjectSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useProjectRealtime } from "@/hooks/use-realtime";
import { useProfile } from "@/components/profile-provider";
import { useProject } from "@/components/project-provider";
import { EmptyState, Pill, Stat } from "@/components/shared";
import { CenteredBar, CiBar } from "@/components/eval/ci-bar";
import { HelpTip } from "@/components/eval/help-tip";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const REFRESH_MS = 15_000;
const HOUR = 3_600_000;
/** Neutral series palette (darkest first). Identity is always backed by a legend. */
const SERIES = ["var(--chart-5)", "var(--chart-2)", "var(--chart-1)", "var(--chart-3)", "var(--chart-4)"];

type Loaded = { stats: ProjectStats; at: number };

export default function OverviewPage() {
  const { profile, isStaff } = useProfile();
  if (!profile) return <OverviewSkeleton />;
  if (!isStaff) return <ContributorOverview />;
  return <StaffOverview />;
}

/* -------------------------------------------------------------------------------------------- */

function ContributorOverview() {
  const { projectId, project } = useProject();
  return (
    <EmptyState
      icon={PenLine}
      title={project?.status === "active" ? "Ready when you are" : "This project isn't open yet"}
      description={
        project?.status === "active"
          ? "Compare two responses side by side, rate them on the rubric, and explain your choice."
          : "An admin needs to activate it before tasks become available."
      }
      action={
        project?.status === "active" ? (
          <Link href={`/app/projects/${projectId}/annotate`} className={buttonVariants()}>
            Start annotating
          </Link>
        ) : undefined
      }
    />
  );
}

function StaffOverview() {
  const { projectId, project } = useProject();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const errorRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const stats = await api.stats(projectId);
      setData({ stats, at: Date.now() });
      errorRef.current = null;
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't load project stats";
      if (errorRef.current === null) toast.error(msg);
      errorRef.current = msg;
      setError(msg);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void load();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  useProjectRealtime("judgments", projectId, () => void load());

  const manualRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (!data) {
    if (error) {
      return (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load the dashboard"
          description={error}
          action={
            <Button variant="outline" onClick={() => void manualRefresh()} disabled={refreshing}>
              {refreshing ? <Loader2 className="animate-spin" /> : <RotateCcw />} Retry
            </Button>
          }
        />
      );
    }
    return <OverviewSkeleton />;
  }

  const { stats, at } = data;
  const t = stats.totals;
  const base = `/app/projects/${projectId}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">Live evaluation</h2>
          <span className="inline-flex h-5 items-center gap-1.5 rounded-md border px-1.5 text-xs text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", error ? "bg-amber-500" : "animate-pulse bg-emerald-500")} />
            {error ? "Reconnecting" : "Live"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="tabular">
            Updated {new Date(at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
          <Button variant="ghost" size="icon-sm" onClick={() => void manualRefresh()} aria-label="Refresh" disabled={refreshing}>
            <RotateCcw className={cn(refreshing && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Judgments"
          value={
            <>
              {int(t.judgments)}
              <span className="text-base font-normal text-muted-foreground"> / {int(t.target_judgments)}</span>
            </>
          }
          hint={
            <div className="space-y-1.5">
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-foreground transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, t.progress * 100))}%` }}
                />
              </div>
              <span className="tabular">{pct(t.progress)} of target</span>
            </div>
          }
        />
        <Stat
          label="Contributors"
          value={int(t.contributors)}
          hint={
            stats.quality.paused_contributors > 0 ? (
              <span className="text-amber-700">{int(stats.quality.paused_contributors)} paused</span>
            ) : (
              "None paused"
            )
          }
        />
        <Stat
          label="Items ready"
          value={int(t.ready_items)}
          hint={
            <span className="tabular">
              {int(t.gold_items)} gold · {int(t.items)} total
            </span>
          }
        />
        <Link
          href={`${base}/review`}
          className="group rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Stat
            className="h-full transition-colors group-hover:bg-muted/40"
            label={
              <span className="flex items-center justify-between">
                Disputed
                <ArrowUpRight className="size-3.5 text-muted-foreground/60 group-hover:text-foreground" />
              </span>
            }
            value={<span className={cn(t.disputed > 0 && "text-amber-700")}>{int(t.disputed)}</span>}
            hint={<span className="tabular">{int(t.reviewed)} reviewed</span>}
          />
        </Link>
      </div>

      {t.judgments === 0 ? (
        <SetupChecklist project={project} projectId={projectId} />
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-3">
            <Leaderboard stats={stats} className="xl:col-span-2" />
            <AgreementPanel stats={stats} />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <TimelinePanel stats={stats} at={at} className="xl:col-span-2" />
            <QualityPanel stats={stats} project={project} base={base} />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <HistogramPanel stats={stats} />
            <CriteriaPanel stats={stats} className="xl:col-span-2" />
          </div>
        </>
      )}

      <ExportPanel projectId={projectId} />
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Building blocks                                                                              */
/* -------------------------------------------------------------------------------------------- */

function Panel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-lg border bg-card", className)}>
      <header className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </header>
      <div className={cn("flex-1 px-4 pb-4", bodyClassName)}>{children}</div>
    </section>
  );
}

const BAND_TONE = { good: "good", ok: "warn", bad: "bad", none: "neutral" } as const;

function MetricRow({
  label,
  help,
  value,
  pill,
}: {
  label: string;
  help?: React.ReactNode;
  value: React.ReactNode;
  pill?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 py-2">
      <span className="flex min-w-0 flex-1 items-center gap-1 text-sm text-muted-foreground">
        <span className="truncate">{label}</span>
        {help && <HelpTip>{help}</HelpTip>}
      </span>
      <span className="tabular font-mono text-sm font-medium">{value}</span>
      {pill !== undefined && <span className="flex w-24 justify-end">{pill}</span>}
    </div>
  );
}

function BandPill({ value }: { value: number | null }) {
  const b = agreementBand(value);
  if (b.tone === "none") return <span className="text-xs text-muted-foreground">No data</span>;
  return <Pill tone={BAND_TONE[b.tone]}>{b.label}</Pill>;
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-6 w-48" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-lg" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-72 rounded-lg xl:col-span-2" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-64 rounded-lg xl:col-span-2" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Leaderboard                                                                                  */
/* -------------------------------------------------------------------------------------------- */

function Leaderboard({ stats, className }: { stats: ProjectStats; className?: string }) {
  const models = useMemo(() => [...stats.models].sort((a, b) => b.bt_score - a.bt_score), [stats.models]);
  return (
    <Panel
      title="Model leaderboard"
      description="Bradley–Terry rating on an Elo-like scale from pairwise human votes (ties count half); ranges are 95% bootstrap CIs."
      className={className}
      bodyClassName="px-0 pb-2"
    >
      {models.length === 0 ? (
        <p className="mx-4 rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          Rankings appear once items with model names receive judgments.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10 pl-4 text-xs text-muted-foreground">#</TableHead>
              <TableHead className="text-xs text-muted-foreground">Model</TableHead>
              <TableHead className="text-right text-xs text-muted-foreground">Rating</TableHead>
              <TableHead className="text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  Win rate
                  <HelpTip>
                    (wins + ½ ties) / comparisons. The bar shows the Wilson 95% interval on a 0–100% axis; the tick marks
                    50%.
                  </HelpTip>
                </span>
              </TableHead>
              <TableHead className="text-right text-xs text-muted-foreground">W / T / L</TableHead>
              <TableHead className="pr-4 text-right text-xs text-muted-foreground">Comparisons</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.map((m, i) => (
              <TableRow key={m.model}>
                <TableCell className="tabular pl-4 font-mono text-muted-foreground">{i + 1}</TableCell>
                <TableCell className="max-w-56 truncate font-mono text-[13px]" title={m.model}>
                  {m.model}
                </TableCell>
                <TableCell className="text-right">
                  <span className="tabular font-mono font-medium">{Math.round(m.bt_score)}</span>
                  <span className="tabular ml-1.5 font-mono text-[11px] text-muted-foreground">
                    {Math.round(m.bt_ci[0])}–{Math.round(m.bt_ci[1])}
                  </span>
                </TableCell>
                <TableCell className="min-w-48">
                  <div className="flex items-center gap-3">
                    <span className="tabular w-10 text-right font-mono">{pct(m.win_rate)}</span>
                    <CiBar value={m.win_rate} lo={m.win_rate_ci[0]} hi={m.win_rate_ci[1]} className="w-32" />
                  </div>
                </TableCell>
                <TableCell className="tabular text-right font-mono text-muted-foreground">
                  <span className="text-foreground">{m.wins}</span> / {m.ties} / {m.losses}
                </TableCell>
                <TableCell className="tabular pr-4 text-right font-mono">{int(m.comparisons)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Agreement + quality                                                                          */
/* -------------------------------------------------------------------------------------------- */

function AgreementPanel({ stats }: { stats: ProjectStats }) {
  const a = stats.agreement;
  const consistencyTone = a.llm_consistency === null ? null : a.llm_consistency >= 0.8 ? "good" : a.llm_consistency >= 0.6 ? "warn" : "bad";
  return (
    <Panel title="Agreement" description="Inter-annotator reliability on non-gold items with 2+ votes.">
      <div className="divide-y">
        <MetricRow
          label="Krippendorff's α"
          help="Agreement on the full −2…2 scale, corrected for chance. α ≥ 0.667 is generally considered reliable; below 0.4 the labels are too noisy to train on."
          value={num(a.krippendorff_alpha)}
          pill={<BandPill value={a.krippendorff_alpha} />}
        />
        <MetricRow
          label="Fleiss' κ"
          help="Chance-corrected agreement on three categories (A / tie / B) across many raters. Same reading as α: ≥ 0.667 reliable."
          value={num(a.fleiss_kappa)}
          pill={<BandPill value={a.fleiss_kappa} />}
        />
        <MetricRow
          label="Pairwise agreement"
          help="Raw share of rater pairs on the same item that picked the same side (or both tie). Not chance-corrected."
          value={pct(a.pairwise_agreement)}
          pill={<BandPill value={a.pairwise_agreement} />}
        />
      </div>
      <div className="mt-3 mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">LLM judge vs humans</div>
      <div className="divide-y">
        <MetricRow
          label="Agreement"
          help="Share of items where the LLM judge's side matches the human majority."
          value={pct(a.llm_human_agreement)}
          pill={<BandPill value={a.llm_human_agreement} />}
        />
        <MetricRow
          label="Cohen's κ"
          help="Chance-corrected agreement between the LLM judge and the human majority on A / tie / B."
          value={num(a.llm_human_kappa)}
          pill={<BandPill value={a.llm_human_kappa} />}
        />
        <MetricRow
          label="Self-consistency"
          help="Share of items where the judge gave the same verdict with the responses in both orders. Low values mean position bias in the judge."
          value={pct(a.llm_consistency)}
          pill={
            consistencyTone === null ? (
              <span className="text-xs text-muted-foreground">No data</span>
            ) : (
              <Pill tone={consistencyTone}>
                {consistencyTone === "good" ? "Stable" : consistencyTone === "warn" ? "Some bias" : "Biased"}
              </Pill>
            )
          }
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        <span className="tabular">{int(stats.totals.llm_judged)}</span> items judged by the LLM.
      </p>
    </Panel>
  );
}

function QualityPanel({
  stats,
  project,
  base,
}: {
  stats: ProjectStats;
  project: ProjectSummary | null;
  base: string;
}) {
  const q = stats.quality;
  const pb = stats.position_bias;
  const goldMin = project?.gold_min_accuracy ?? null;
  const goldLow = q.gold_accuracy !== null && goldMin !== null && q.gold_accuracy < goldMin;
  const biasWarn = pb.left_rate !== null && pb.n >= 20 && (pb.left_rate < 0.4 || pb.left_rate > 0.6);
  return (
    <Panel title="Quality" description="Signals that the labels can be trusted.">
      <div className="divide-y">
        <MetricRow
          label="Gold accuracy"
          help={`Share of quality-check items answered correctly across all contributors. Individuals below ${pct(goldMin)} are paused automatically.`}
          value={<span className={cn(goldLow && "text-red-600")}>{pct(q.gold_accuracy)}</span>}
        />
        <MetricRow
          label="Too-fast rate"
          help={`Share of judgments submitted faster than the minimum reading time (${project?.min_seconds ?? "—"}s).`}
          value={<span className={cn(q.too_fast_rate > 0.2 && "text-amber-700")}>{pct(q.too_fast_rate)}</span>}
        />
        <MetricRow
          label="Flagged items"
          help="Items at least one contributor flagged as broken, unsafe or off-topic. They go to the review queue."
          value={
            q.flagged_count > 0 ? (
              <Link href={`${base}/review`} className="underline-offset-4 hover:underline">
                {int(q.flagged_count)}
              </Link>
            ) : (
              int(q.flagged_count)
            )
          }
        />
        <MetricRow
          label="Paused contributors"
          value={
            q.paused_contributors > 0 ? (
              <Link href={`${base}/contributors`} className="text-amber-700 underline-offset-4 hover:underline">
                {int(q.paused_contributors)}
              </Link>
            ) : (
              int(q.paused_contributors)
            )
          }
        />
        <div className="py-2">
          <div className="flex items-center gap-2">
            <span className="flex flex-1 items-center gap-1 text-sm text-muted-foreground">
              Position bias
              <HelpTip>
                Share of non-tie human choices that picked the left-hand response. The side is randomised per task, so
                ~50% is expected; outside 40–60% suggests annotators favour a screen position.
              </HelpTip>
            </span>
            <span className={cn("tabular font-mono text-sm font-medium", biasWarn && "text-amber-700")}>
              {pct(pb.left_rate)} left
            </span>
          </div>
          {pb.left_rate !== null && (
            <div className="mt-2 space-y-1">
              <CenteredBar value={pb.left_rate} warn={biasWarn} />
              <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
                <span>Right</span>
                <span className="tabular">n={int(pb.n)}</span>
                <span>Left</span>
              </div>
            </div>
          )}
          {biasWarn && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-700">
              <AlertTriangle className="size-3.5" /> Annotators lean {pb.left_rate! > 0.5 ? "left" : "right"} more than
              expected.
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Charts                                                                                       */
/* -------------------------------------------------------------------------------------------- */

const timelineConfig = { judgments: { label: "Judgments", color: "var(--chart-5)" } } satisfies ChartConfig;

function TimelinePanel({ stats, at, className }: { stats: ProjectStats; at: number; className?: string }) {
  const data = useMemo(() => {
    const byHour = new Map<number, number>();
    for (const b of stats.timeline) {
      const ts = new Date(b.bucket).getTime();
      if (Number.isNaN(ts)) continue;
      const h = Math.floor(ts / HOUR) * HOUR;
      byHour.set(h, (byHour.get(h) ?? 0) + b.judgments);
    }
    const end = Math.floor(at / HOUR) * HOUR;
    return Array.from({ length: 48 }, (_, i) => {
      const ts = end - (47 - i) * HOUR;
      return { ts, judgments: byHour.get(ts) ?? 0 };
    });
  }, [stats.timeline, at]);
  const last24 = data.slice(24).reduce((s, d) => s + d.judgments, 0);
  const hourFmt = (ts: number) => new Date(ts).toLocaleTimeString("en-US", { hour: "numeric" });

  return (
    <Panel
      title="Judgments over time"
      description="Hourly, last 48 hours."
      className={className}
      action={
        <span className="tabular text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{int(last24)}</span> in last 24h
        </span>
      }
    >
      <ChartContainer config={timelineConfig} className="aspect-auto h-[220px] w-full">
        <BarChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="ts"
            tickLine={false}
            axisLine={false}
            interval={5}
            tickMargin={8}
            tickFormatter={(v: number) => hourFmt(v)}
          />
          <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={40} tickMargin={4} />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const ts = payload?.[0]?.payload?.ts as number | undefined;
                  return ts
                    ? new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                    : "";
                }}
              />
            }
          />
          <Bar dataKey="judgments" fill="var(--color-judgments)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartContainer>
    </Panel>
  );
}

const histogramConfig = { count: { label: "Judgments", color: "var(--chart-5)" } } satisfies ChartConfig;
const HIST_LABELS: Record<number, { short: string; long: string }> = {
  [-2]: { short: "A≫", long: "A much better" },
  [-1]: { short: "A>", long: "A better" },
  0: { short: "=", long: "Tie" },
  1: { short: "B>", long: "B better" },
  2: { short: "B≫", long: "B much better" },
};

function HistogramPanel({ stats, className }: { stats: ProjectStats; className?: string }) {
  const data = useMemo(() => {
    const counts = new Map(stats.preference_histogram.map((h) => [h.value, h.count]));
    return [-2, -1, 0, 1, 2].map((v) => ({
      value: v,
      label: HIST_LABELS[v].short,
      long: HIST_LABELS[v].long,
      count: counts.get(v as -2 | -1 | 0 | 1 | 2) ?? 0,
    }));
  }, [stats.preference_histogram]);
  const total = data.reduce((s, d) => s + d.count, 0);
  const ties = data[2].count;

  return (
    <Panel
      title="Preference distribution"
      description="Canonical A vs B, all non-gold judgments."
      className={className}
      action={
        <span className="tabular text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{pct(total ? ties / total : null)}</span> ties
        </span>
      }
    >
      <ChartContainer config={histogramConfig} className="aspect-auto h-[220px] w-full">
        <BarChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={40} tickMargin={4} />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => (payload?.[0]?.payload?.long as string | undefined) ?? ""}
              />
            }
          />
          <Bar dataKey="count" radius={[3, 3, 0, 0]} maxBarSize={48}>
            {data.map((d) => (
              <Cell key={d.value} fill={d.value === 0 ? "var(--chart-2)" : "var(--color-count)"} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </Panel>
  );
}

function CriteriaPanel({ stats, className }: { stats: ProjectStats; className?: string }) {
  const { data, config, keys } = useMemo(() => {
    // Series follow leaderboard order so colours stay stable per model.
    const order = [...stats.models].sort((a, b) => b.bt_score - a.bt_score).map((m) => m.model);
    for (const c of stats.criteria) for (const m of c.models) if (!order.includes(m.model)) order.push(m.model);
    const models = order.slice(0, SERIES.length);
    const cfg: ChartConfig = {};
    const ks = models.map((m, i) => {
      const k = `m${i}`;
      cfg[k] = { label: m, color: SERIES[i] };
      return k;
    });
    const rows = stats.criteria.map((c) => {
      const row: Record<string, string | number | null> = { label: c.label };
      models.forEach((m, i) => {
        const found = c.models.find((x) => x.model === m);
        row[ks[i]] = found ? Math.round(found.win_rate * 1000) / 10 : null;
      });
      return row;
    });
    return { data: rows, config: cfg, keys: ks };
  }, [stats.criteria, stats.models]);

  return (
    <Panel
      title="Win rate by criterion"
      description="Share of criterion-level comparisons each model won (ties count half). 50% line marks parity."
      className={className}
    >
      {data.length === 0 || keys.length === 0 ? (
        <p className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          No criterion ratings yet.
        </p>
      ) : (
        <ChartContainer config={config} className="aspect-auto h-[240px] w-full">
          <BarChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }} barGap={2}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval={0} />
            <YAxis
              tickLine={false}
              axisLine={false}
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(v: number) => `${v}%`}
              width={44}
              tickMargin={4}
            />
            <ReferenceLine y={50} stroke="var(--muted-foreground)" strokeOpacity={0.5} strokeDasharray="4 4" />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value, name, item) => (
                    <div className="flex w-full items-center gap-2">
                      <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: item.color }} />
                      <span className="font-mono text-muted-foreground">{config[String(name)]?.label ?? name}</span>
                      <span className="ml-auto pl-3 font-mono font-medium tabular-nums">
                        {value === null || value === undefined ? "—" : `${Number(value).toFixed(0)}%`}
                      </span>
                    </div>
                  )}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent className="font-mono" />} />
            {keys.map((k) => (
              <Bar key={k} dataKey={k} fill={`var(--color-${k})`} radius={[3, 3, 0, 0]} maxBarSize={28} />
            ))}
          </BarChart>
        </ChartContainer>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Export + setup                                                                               */
/* -------------------------------------------------------------------------------------------- */

const EXPORTS: { format: "dpo" | "raw" | "items"; label: string; hint: string }[] = [
  { format: "dpo", label: "Preference pairs (DPO)", hint: "Decided items as prompt / chosen / rejected" },
  { format: "raw", label: "Raw judgments", hint: "Every human judgment, canonical A/B" },
  { format: "items", label: "Items with aggregates", hint: "Votes, means and LLM verdict per item" },
];

function ExportPanel({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (format: "dpo" | "raw" | "items") => {
    setBusy(format);
    try {
      await api.exportFile(projectId, format);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Panel
      title="Export"
      description={
        <>
          JSONL. DPO lines are <code className="font-mono text-[11px]">{"{prompt, chosen, rejected}"}</code> plus
          chosen/rejected model, margin, votes and source; a reviewer decision overrides the human majority and ties are
          dropped.
        </>
      }
    >
      <div className="grid gap-2 sm:grid-cols-3">
        {EXPORTS.map((x) => (
          <button
            key={x.format}
            type="button"
            disabled={busy !== null}
            onClick={() => void run(x.format)}
            className="flex items-center gap-3 rounded-md border bg-background px-3 py-2.5 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-md border bg-muted/40">
              {busy === x.format ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <Download className="size-4 text-muted-foreground" strokeWidth={1.75} />
              )}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{x.label}</span>
              <span className="block truncate text-xs text-muted-foreground">{x.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function SetupChecklist({ project, projectId }: { project: ProjectSummary | null; projectId: string }) {
  const { isAdmin } = useProfile();
  const [copied, setCopied] = useState(false);
  const base = `/app/projects/${projectId}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${base}/annotate`);
      setCopied(true);
      toast.success("Annotate link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy the link");
    }
  };

  const steps: { title: string; description: string; done: boolean; action?: React.ReactNode }[] = [
    {
      title: "Add prompts",
      description: "Upload a CSV or JSONL of prompts, optionally with both responses.",
      done: (project?.items_count ?? 0) > 0,
      action: (
        <Link href={`${base}/items`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Add items
        </Link>
      ),
    },
    {
      title: "Generate responses",
      description: "Fill in Response A and B with two models, or include them in your upload.",
      done: (project?.ready_items_count ?? 0) > 0,
      action: (
        <Link href={`${base}/items`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Generate
        </Link>
      ),
    },
    {
      title: "Add gold items",
      description: "Recommended. Items with a known answer keep annotators calibrated and catch low-effort work.",
      done: (project?.gold_count ?? 0) > 0,
      action: (
        <Link href={`${base}/items`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Add gold
        </Link>
      ),
    },
    {
      title: "Set the project to active",
      description: "Contributors only see active projects. Staff can test-annotate drafts.",
      done: project?.status === "active",
      action: isAdmin ? (
        <Link href={`${base}/settings`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Settings
        </Link>
      ) : undefined,
    },
    {
      title: "Share the annotate link",
      description: "Send contributors straight to the annotation screen.",
      done: false,
      action: (
        <Button variant="outline" size="sm" onClick={() => void copyLink()}>
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy link"}
        </Button>
      ),
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Panel
      title="Get this evaluation running"
      description="No judgments yet. The dashboard fills in live as soon as the first one lands."
      action={
        <span className="tabular text-xs text-muted-foreground">
          {doneCount} of {steps.length} done
        </span>
      }
      bodyClassName="px-0 pb-0"
    >
      <ol className="divide-y border-t">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full border text-xs font-medium",
                s.done ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "text-muted-foreground",
              )}
            >
              {s.done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm font-medium", s.done && "text-muted-foreground line-through decoration-muted-foreground/40")}>
                {s.title}
              </p>
              <p className="text-xs text-muted-foreground">{s.description}</p>
            </div>
            {!s.done && s.action}
          </li>
        ))}
      </ol>
    </Panel>
  );
}
