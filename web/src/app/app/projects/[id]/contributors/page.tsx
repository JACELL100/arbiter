"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronsUpDown, Loader2, RotateCcw, Users } from "lucide-react";
import { api } from "@/lib/api";
import { int, pct, relativeTime } from "@/lib/format";
import type { ContributorRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useProfile } from "@/components/profile-provider";
import { useProject } from "@/components/project-provider";
import { EmptyState, PageHeader, Pill } from "@/components/shared";
import { HelpTip } from "@/components/eval/help-tip";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type SortKey =
  | "name"
  | "judgments"
  | "gold_accuracy"
  | "agreement_rate"
  | "too_fast_rate"
  | "median_seconds"
  | "left_bias"
  | "status"
  | "last_active_at";

const TOO_FAST_MAX = 0.2;
const AGREEMENT_MIN = 0.5;
const BIAS_RANGE: [number, number] = [0.35, 0.65];

const displayName = (r: ContributorRow) => r.full_name || r.email?.split("@")[0] || "Unknown";

function sortValue(r: ContributorRow, key: SortKey): string | number | null {
  switch (key) {
    case "name":
      return displayName(r).toLowerCase();
    case "status":
      return r.status;
    case "last_active_at":
      return r.last_active_at ? new Date(r.last_active_at).getTime() : null;
    case "left_bias":
      // Sort by distance from unbiased so the most skewed rise to the top.
      return r.left_bias === null ? null : Math.abs(r.left_bias - 0.5);
    default:
      return r[key];
  }
}

export default function ContributorsPage() {
  const { projectId, project } = useProject();
  const { isAdmin } = useProfile();
  const [rows, setRows] = useState<ContributorRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "judgments", dir: "desc" });
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.contributors(projectId));
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't load contributors";
      setError(msg);
      toast.error(msg);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(() => {
    if (!rows) return null;
    const mult = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = sortValue(a, sort.key);
      const vb = sortValue(b, sort.key);
      if (va === null && vb === null) return 0;
      if (va === null) return 1; // nulls always last
      if (vb === null) return -1;
      if (va < vb) return -1 * mult;
      if (va > vb) return 1 * mult;
      return 0;
    });
  }, [rows, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" },
    );

  const setStatus = async (row: ContributorRow, status: "active" | "paused") => {
    setPending(row.user_id);
    try {
      const updated = await api.updateContributor(
        projectId,
        row.user_id,
        status === "active" ? { status: "active", override: true } : { status: "paused" },
      );
      setRows((rs) => rs?.map((r) => (r.user_id === row.user_id ? { ...r, ...updated } : r)) ?? rs);
      toast.success(status === "active" ? `${displayName(row)} reinstated` : `${displayName(row)} paused`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update contributor");
    } finally {
      setPending(null);
    }
  };

  const goldMin = project?.gold_min_accuracy ?? null;
  const pausedCount = rows?.filter((r) => r.status === "paused").length ?? 0;

  const head = (key: SortKey, label: string, opts: { align?: "right"; help?: React.ReactNode } = {}) => {
    const active = sort.key === key;
    const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <TableHead className={cn(opts.align === "right" && "text-right")} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
        <span className={cn("inline-flex items-center gap-1", opts.align === "right" && "flex-row-reverse")}>
          <button
            type="button"
            onClick={() => toggleSort(key)}
            className={cn(
              "inline-flex items-center gap-1 rounded-sm text-xs font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
              active ? "text-foreground" : "text-muted-foreground",
              opts.align === "right" && "flex-row-reverse",
            )}
          >
            {label}
            <Icon className={cn("size-3", !active && "opacity-50")} />
          </button>
          {opts.help && <HelpTip>{opts.help}</HelpTip>}
        </span>
      </TableHead>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Contributors"
        description="Per-annotator quality. Values outside project thresholds are highlighted."
        actions={
          rows && rows.length > 0 ? (
            <span className="tabular text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{int(rows.length)}</span> contributors
              {pausedCount > 0 && (
                <>
                  {" · "}
                  <span className="font-medium text-amber-700">{int(pausedCount)}</span> paused
                </>
              )}
            </span>
          ) : null
        }
      />

      {error && !rows ? (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load contributors"
          description={error}
          action={
            <Button variant="outline" onClick={() => void load()}>
              <RotateCcw /> Retry
            </Button>
          }
        />
      ) : !sorted ? (
        <div className="overflow-hidden rounded-lg border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-6 border-b px-4 py-3 last:border-0">
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              {Array.from({ length: 5 }).map((__, j) => (
                <Skeleton key={j} className="h-4 w-12" />
              ))}
            </div>
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No contributors yet"
          description="People appear here after their first judgment in this project. Share the annotate link to get started."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-4">
                  <button
                    type="button"
                    onClick={() => toggleSort("name")}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-sm text-xs font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                      sort.key === "name" ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    Contributor
                    {sort.key !== "name" ? (
                      <ChevronsUpDown className="size-3 opacity-50" />
                    ) : sort.dir === "asc" ? (
                      <ArrowUp className="size-3" />
                    ) : (
                      <ArrowDown className="size-3" />
                    )}
                  </button>
                </TableHead>
                {head("judgments", "Judgments", { align: "right" })}
                {head("gold_accuracy", "Gold acc.", {
                  align: "right",
                  help: `Share of quality-check items answered correctly. Contributors below ${pct(goldMin)} are paused automatically once they've seen enough golds.`,
                })}
                {head("agreement_rate", "Agreement", {
                  align: "right",
                  help: "Share of their judgments that match the majority of other annotators on the same item (items with 2+ other votes).",
                })}
                {head("too_fast_rate", "Too fast", {
                  align: "right",
                  help: "Share of judgments submitted faster than the project's minimum time.",
                })}
                {head("median_seconds", "Median time", { align: "right" })}
                {head("left_bias", "Left bias", {
                  align: "right",
                  help: "Share of non-tie choices that picked the left-hand response. 50% is unbiased; the side is randomised per task.",
                })}
                {head("status", "Status")}
                {head("last_active_at", "Last active")}
                {isAdmin && <TableHead className="w-24 pr-4" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r) => {
                const goldRisk = r.gold_accuracy !== null && goldMin !== null && r.gold_accuracy < goldMin;
                const fastRisk = r.too_fast_rate > TOO_FAST_MAX;
                const agreeRisk = r.agreement_rate !== null && r.agreement_rate < AGREEMENT_MIN;
                const biasRisk = r.left_bias !== null && (r.left_bias < BIAS_RANGE[0] || r.left_bias > BIAS_RANGE[1]);
                return (
                  <TableRow key={r.user_id}>
                    <TableCell className="py-2.5 pl-4">
                      <div className="text-sm font-medium">{displayName(r)}</div>
                      {r.email && <div className="text-xs text-muted-foreground">{r.email}</div>}
                    </TableCell>
                    <TableCell className="tabular text-right font-mono">{int(r.judgments)}</TableCell>
                    <TableCell className="text-right">
                      <span className={cn("tabular font-mono", goldRisk && "font-medium text-red-600")}>
                        {pct(r.gold_accuracy)}
                      </span>
                      <span className="tabular ml-1 font-mono text-[11px] text-muted-foreground">n={r.golds}</span>
                    </TableCell>
                    <TableCell className={cn("tabular text-right font-mono", agreeRisk && "text-amber-700")}>
                      {pct(r.agreement_rate)}
                    </TableCell>
                    <TableCell className={cn("tabular text-right font-mono", fastRisk && "text-amber-700")}>
                      {pct(r.too_fast_rate)}
                    </TableCell>
                    <TableCell className="tabular text-right font-mono">
                      {r.median_seconds === null ? "—" : `${Math.round(r.median_seconds)}s`}
                    </TableCell>
                    <TableCell className={cn("tabular text-right font-mono", biasRisk && "text-amber-700")}>
                      {pct(r.left_bias)}
                    </TableCell>
                    <TableCell>
                      {r.status === "paused" ? (
                        <Tooltip>
                          <TooltipTrigger render={<span className="inline-flex cursor-help" />}>
                            <Pill tone="warn">Paused</Pill>
                          </TooltipTrigger>
                          <TooltipContent>{r.paused_reason || "Paused by an admin"}</TooltipContent>
                        </Tooltip>
                      ) : r.override ? (
                        <Tooltip>
                          <TooltipTrigger render={<span className="inline-flex cursor-help" />}>
                            <Pill tone="good">Reinstated</Pill>
                          </TooltipTrigger>
                          <TooltipContent>An admin reinstated this contributor; automatic pausing is off.</TooltipContent>
                        </Tooltip>
                      ) : (
                        <Pill tone="good">Active</Pill>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{relativeTime(r.last_active_at)}</TableCell>
                    {isAdmin && (
                      <TableCell className="pr-4 text-right">
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={pending === r.user_id}
                          onClick={() => void setStatus(r, r.status === "paused" ? "active" : "paused")}
                        >
                          {pending === r.user_id && <Loader2 className="animate-spin" />}
                          {r.status === "paused" ? "Reinstate" : "Pause"}
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {sorted && sorted.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Highlighted: gold accuracy below {pct(goldMin)}, too-fast above {pct(TOO_FAST_MAX)}, agreement below{" "}
          {pct(AGREEMENT_MIN)}, left bias outside {pct(BIAS_RANGE[0])}–{pct(BIAS_RANGE[1])}.
        </p>
      )}
    </div>
  );
}
