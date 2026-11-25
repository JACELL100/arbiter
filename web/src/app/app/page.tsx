"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, FolderKanban, Inbox, PauseCircle, Plus, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { MyStats, ProjectSummary } from "@/lib/types";
import { int, num, pct, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useProfile } from "@/components/profile-provider";
import { EmptyState, PageHeader, Pill, Stat, StatusBadge } from "@/components/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function HomePage() {
  const { profile, loading, error, isStaff, refresh } = useProfile();

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      {loading ? (
        <>
          <Skeleton className="mb-1 h-7 w-40" />
          <Skeleton className="mb-8 h-4 w-72" />
          <TableSkeleton />
        </>
      ) : error || !profile ? (
        <ApiErrorPanel message={error ?? "Couldn't load your profile."} onRetry={refresh} />
      ) : isStaff ? (
        <StaffHome />
      ) : (
        <ContributorHome />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */

function ApiErrorPanel({ message, onRetry }: { message: string; onRetry: () => Promise<void> | void }) {
  const [retrying, setRetrying] = useState(false);
  return (
    <div className="mx-auto mt-10 max-w-lg rounded-lg border p-6">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-md border border-amber-200 bg-amber-50">
          <AlertTriangle className="size-4 text-amber-700" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Can&rsquo;t connect to Arbiter</h2>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
          <ul className="mt-3 list-disc space-y-1 pl-4 text-sm text-muted-foreground">
            <li>
              Make sure the API server is running (<code className="font-mono text-xs">uvicorn</code> on port 8000).
            </li>
            <li>
              Check <code className="font-mono text-xs">NEXT_PUBLIC_API_URL</code> in{" "}
              <code className="font-mono text-xs">web/.env.local</code> and{" "}
              <code className="font-mono text-xs">CORS_ORIGINS</code> in <code className="font-mono text-xs">api/.env</code>.
            </li>
          </ul>
          <Button
            variant="outline"
            className="mt-4"
            disabled={retrying}
            onClick={async () => {
              setRetrying(true);
              try {
                await onRetry();
              } finally {
                setRetrying(false);
              }
            }}
          >
            <RotateCw className={cn(retrying && "animate-spin")} /> Retry
          </Button>
        </div>
      </div>
    </div>
  );
}

function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="h-10 border-b bg-muted/40" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-6 border-b px-4 py-3.5 last:border-0">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
          <Skeleton className="hidden h-5 w-16 sm:block" />
          <Skeleton className="hidden h-4 w-24 md:block" />
          <Skeleton className="hidden h-4 w-32 md:block" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* Staff                                                                                            */
/* ------------------------------------------------------------------------------------------------ */

function StaffHome() {
  const router = useRouter();
  const { isAdmin } = useProfile();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setProjects(await api.projects());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load projects");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const newButton = isAdmin && (
    <Link href="/app/projects/new" className={buttonVariants()}>
      <Plus /> New project
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Projects"
        description="Pairwise evaluation studies in this workspace."
        actions={projects && projects.length > 0 ? newButton : undefined}
        className="mb-6"
      />

      {error && !projects ? (
        <ApiErrorPanel message={error} onRetry={load} />
      ) : !projects ? (
        <TableSkeleton />
      ) : projects.length === 0 ? (
        isAdmin ? (
          <EmptyState
            icon={FolderKanban}
            title="Create your first project"
            description="A project holds the prompts and response pairs to compare, your guidelines and rubric, and quality settings."
            action={newButton}
          />
        ) : (
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description="Projects appear here once an admin creates one."
          />
        )
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4 text-xs font-medium text-muted-foreground">Project</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground">Status</TableHead>
                <TableHead className="text-right text-xs font-medium text-muted-foreground">Items</TableHead>
                <TableHead className="w-56 text-xs font-medium text-muted-foreground">Judgments</TableHead>
                <TableHead className="text-right text-xs font-medium text-muted-foreground">Contributors</TableHead>
                <TableHead className="pr-4 text-right text-xs font-medium text-muted-foreground">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => {
                const progress = Math.max(0, Math.min(1, p.progress || 0));
                return (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/app/projects/${p.id}`)}
                  >
                    <TableCell className="max-w-[28rem] py-3 pl-4 whitespace-normal">
                      <Link
                        href={`/app/projects/${p.id}`}
                        className="font-medium hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {p.name}
                      </Link>
                      {p.description && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{p.description}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} />
                    </TableCell>
                    <TableCell className="tabular text-right">
                      <div>{int(p.ready_items_count)}</div>
                      <div className="text-xs text-muted-foreground">
                        {int(p.gold_count)} gold
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="tabular flex items-baseline justify-between gap-2 text-sm">
                        <span>
                          {int(p.judgments_count)}
                          <span className="text-muted-foreground"> / {int(p.target_judgments)}</span>
                        </span>
                        <span className="text-xs text-muted-foreground">{pct(progress)}</span>
                      </div>
                      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-foreground" style={{ width: `${progress * 100}%` }} />
                      </div>
                    </TableCell>
                    <TableCell className="tabular text-right">{int(p.contributors_count)}</TableCell>
                    <TableCell className="pr-4 text-right text-muted-foreground">{relativeTime(p.updated_at)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* Contributor                                                                                      */
/* ------------------------------------------------------------------------------------------------ */

function ContributorHome() {
  const { profile } = useProfile();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [stats, setStats] = useState<MyStats | null>(null);
  const [statsFailed, setStatsFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, s] = await Promise.allSettled([api.projects(), api.myStats()]);
    if (p.status === "fulfilled") {
      setProjects(p.value);
      setError(null);
    } else {
      setError(p.reason instanceof Error ? p.reason.message : "Couldn't load projects");
    }
    if (s.status === "fulfilled") {
      setStats(s.value);
      setStatsFailed(false);
    } else {
      setStatsFailed(true);
      if (p.status === "fulfilled") toast.error(s.reason instanceof Error ? s.reason.message : "Couldn't load your stats");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const firstName = profile?.full_name?.split(" ")[0];
  const pausedIds = new Set(stats?.projects.filter((s) => s.status === "paused").map((s) => s.project_id) ?? []);
  const pausedProjects = stats?.projects.filter((s) => s.status === "paused") ?? [];

  if (error && !projects) return <ApiErrorPanel message={error} onRetry={load} />;

  return (
    <div className="space-y-10">
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : "Welcome back"}
        description="Pick a project to start comparing responses."
      />

      {pausedProjects.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <PauseCircle className="mt-0.5 size-4 shrink-0 text-amber-700" />
          <div>
            <p className="font-medium">
              You&rsquo;re paused on {pausedProjects.map((p) => p.project_name).join(", ")}
            </p>
            <p className="mt-0.5 text-amber-800">
              Your accuracy on gold (known-answer) items fell below the project&rsquo;s threshold, so new tasks are on
              hold. Re-read the guidelines; an admin can review your work and reinstate you.
            </p>
          </div>
        </div>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold">Available projects</h2>
        {!projects ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-40 rounded-lg" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No active projects yet"
            description="An admin will add you when an evaluation is ready. Check back soon."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => {
              const paused = pausedIds.has(p.id);
              return (
                <div key={p.id} className="flex flex-col rounded-lg border bg-card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-medium leading-snug">{p.name}</h3>
                    {paused && <Pill tone="warn">Paused</Pill>}
                  </div>
                  <p className="mt-1.5 line-clamp-2 flex-1 text-sm text-muted-foreground">
                    {p.description || "No description."}
                  </p>
                  <div className="mt-5 flex items-center justify-between gap-3">
                    <span className="tabular text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">{int(p.my_judgments_count)}</span>{" "}
                      {p.my_judgments_count === 1 ? "judgment" : "judgments"} by you
                    </span>
                    {paused ? (
                      <Button size="sm" variant="outline" disabled>
                        Paused
                      </Button>
                    ) : (
                      <Link href={`/app/projects/${p.id}/annotate`} className={buttonVariants({ size: "sm" })}>
                        {p.my_judgments_count > 0 ? "Continue" : "Start"} <ArrowRight data-icon="inline-end" />
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Your stats</h2>
        {!stats && !statsFailed ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-24 rounded-lg" />
              ))}
            </div>
          </div>
        ) : statsFailed || !stats ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            Stats are unavailable right now.
          </p>
        ) : (
          <MyStatsView stats={stats} />
        )}
      </section>
    </div>
  );
}

function MyStatsView({ stats }: { stats: MyStats }) {
  const golds = stats.projects.reduce((a, p) => a + p.golds, 0);
  const goldCorrect = stats.projects.reduce((a, p) => a + (p.gold_accuracy ?? 0) * p.golds, 0);
  const withAgreement = stats.projects.filter((p) => p.agreement_rate !== null);
  const agreeWeight = withAgreement.reduce((a, p) => a + p.judgments, 0);
  const agreement =
    agreeWeight > 0 ? withAgreement.reduce((a, p) => a + (p.agreement_rate ?? 0) * p.judgments, 0) / agreeWeight : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Judgments" value={int(stats.total_judgments)} hint="Across all projects" />
        <Stat
          label="Gold accuracy"
          value={golds > 0 ? pct(goldCorrect / golds) : "—"}
          hint={golds > 0 ? `${int(golds)} gold ${golds === 1 ? "item" : "items"} answered` : "No gold items answered yet"}
        />
        <Stat
          label="Agreement with others"
          value={pct(agreement)}
          hint={agreement === null ? "Needs items with other votes" : "Share matching the majority"}
        />
      </div>

      {stats.projects.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4 text-xs font-medium text-muted-foreground">Project</TableHead>
                <TableHead className="text-right text-xs font-medium text-muted-foreground">Judgments</TableHead>
                <TableHead className="text-right text-xs font-medium text-muted-foreground">Gold accuracy</TableHead>
                <TableHead className="text-right text-xs font-medium text-muted-foreground">Agreement</TableHead>
                <TableHead className="text-right text-xs font-medium text-muted-foreground">Median time</TableHead>
                <TableHead className="pr-4 text-xs font-medium text-muted-foreground">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.projects.map((p) => (
                <TableRow key={p.project_id} className="hover:bg-transparent">
                  <TableCell className="pl-4 font-medium">{p.project_name}</TableCell>
                  <TableCell className="tabular text-right">{int(p.judgments)}</TableCell>
                  <TableCell className="tabular text-right">
                    {pct(p.gold_accuracy)}
                    {p.golds > 0 && <span className="ml-1 text-xs text-muted-foreground">({p.golds})</span>}
                  </TableCell>
                  <TableCell className="tabular text-right">{pct(p.agreement_rate)}</TableCell>
                  <TableCell className="tabular text-right">
                    {p.median_seconds === null ? "—" : `${num(p.median_seconds, 0)}s`}
                  </TableCell>
                  <TableCell className="pr-4">
                    {p.status === "paused" ? <Pill tone="warn">Paused</Pill> : <Pill tone="good">Active</Pill>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
