"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileUp,
  Gavel,
  Loader2,
  Lock,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { ItemRow, Job, Paged, Sign, UploadResult } from "@/lib/types";
import { int, relativeTime, signLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useProfile } from "@/components/profile-provider";
import { useProject } from "@/components/project-provider";
import { ModelSelect, useModels } from "@/components/project-form";
import { ItemDetailSheet } from "@/components/item-detail-sheet";
import { useProjectRealtime } from "@/hooks/use-realtime";
import { EmptyState, Pill } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const PAGE_SIZE = 50;

type Filter = "all" | "gold" | "pending" | "disputed";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "gold", label: "Gold" },
  { value: "pending", label: "Pending responses" },
  { value: "disputed", label: "Disputed" },
];

const isActiveJob = (j: Job) => j.status === "queued" || j.status === "running";
const shortModel = (id: string | null) => (id ? (id.startsWith("openrouter/") ? id.slice(11) : id) : null);

export default function ItemsPage() {
  const { projectId, project, refresh } = useProject();
  const { isAdmin, isStaff, loading: profileLoading } = useProfile();

  /* ---------------- items ---------------- */
  const [filter, setFilter] = useState<Filter>("all");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: Paged<ItemRow>; error?: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toDelete, setToDelete] = useState<ItemRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const key = `${projectId}|${filter}|${q}|${page}|${nonce}`;

  useEffect(() => {
    if (!isStaff) return;
    let alive = true;
    api.items(projectId, { limit: PAGE_SIZE, offset: page * PAGE_SIZE, filter, q }).then(
      (data) => alive && setResult({ key, data }),
      (e) => alive && setResult({ key, error: e instanceof Error ? e.message : "Couldn't load items" }),
    );
    return () => {
      alive = false;
    };
  }, [isStaff, projectId, filter, q, page, key]);

  useEffect(() => {
    const next = qInput.trim();
    if (next === q) return;
    const t = setTimeout(() => {
      setQ(next);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [qInput, q]);

  const reloadItems = useCallback(() => setNonce((n) => n + 1), []);
  const reloadAll = useCallback(() => {
    reloadItems();
    void refresh();
  }, [reloadItems, refresh]);

  const data = result?.data;
  const itemsLoading = result?.key !== key;
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /* ---------------- jobs ---------------- */
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const prevActive = useRef<Set<string>>(new Set());

  const loadJobs = useCallback(async () => {
    try {
      const list = await api.jobs(projectId);
      setJobs(list);
      const nowActive = new Set(list.filter(isActiveJob).map((j) => j.id));
      const finished = [...prevActive.current].some((id) => !nowActive.has(id));
      prevActive.current = nowActive;
      if (finished) reloadAll();
    } catch {
      /* jobs are secondary; keep the last known list */
    }
  }, [projectId, reloadAll]);

  useEffect(() => {
    if (isStaff) void loadJobs();
  }, [isStaff, loadJobs]);

  const onJobsChange = useCallback(() => void loadJobs(), [loadJobs]);
  useProjectRealtime("jobs", isStaff ? projectId : undefined, onJobsChange);

  const hasActive = jobs?.some(isActiveJob) ?? false;
  useEffect(() => {
    if (!hasActive) return;
    const t = setInterval(() => void loadJobs(), 3000);
    return () => clearInterval(t);
  }, [hasActive, loadJobs]);

  const activeKinds = useMemo(() => new Set((jobs ?? []).filter(isActiveJob).map((j) => j.kind)), [jobs]);

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.deleteItem(projectId, toDelete.id);
      toast.success("Item deleted");
      setToDelete(null);
      reloadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete item");
    } finally {
      setDeleting(false);
    }
  }

  if (profileLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!isStaff) {
    return <EmptyState icon={Lock} title="Staff only" description="Only admins and reviewers can browse project items." />;
  }

  const emptyProject = !itemsLoading && filter === "all" && !q && total === 0;

  return (
    <div className="space-y-6">
      {isAdmin && (
        <div className="grid gap-4 lg:grid-cols-3">
          <AddDataCard projectId={projectId} onChanged={reloadAll} />
          <GenerateCard projectId={projectId} busy={activeKinds.has("generate")} onStarted={loadJobs} />
          <JudgeCard
            projectId={projectId}
            defaultModel={project?.judge_model ?? ""}
            busy={activeKinds.has("judge")}
            onStarted={loadJobs}
          />
        </div>
      )}

      {jobs && jobs.length > 0 && <JobsList jobs={jobs} canCancel={isAdmin} onChanged={loadJobs} />}

      {/* Items table */}
      <section>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold">Items</h2>
            {data && <span className="tabular text-sm text-muted-foreground">{int(total)}</span>}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="overflow-x-auto">
              <Tabs
                value={filter}
                onValueChange={(v) => {
                  setFilter(v as Filter);
                  setPage(0);
                }}
              >
                <TabsList>
                  {FILTERS.map((f) => (
                    <TabsTrigger key={f.value} value={f.value} className="px-2.5 text-[13px]">
                      {f.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
            <div className="relative sm:w-60">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="Search prompts"
                aria-label="Search prompts"
                className="pr-8 pl-8"
              />
              {qInput && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQInput("")}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {result?.error && !data ? (
          <EmptyState
            title="Couldn't load items"
            description={result.error}
            action={
              <Button variant="outline" onClick={reloadItems}>
                Retry
              </Button>
            }
          />
        ) : !data ? (
          <ItemsSkeleton />
        ) : emptyProject ? (
          <EmptyState
            icon={FileUp}
            title="No items yet"
            description={
              isAdmin
                ? "Upload a CSV or JSONL file above, or add a single item to get started."
                : "An admin hasn't added any items to this project yet."
            }
          />
        ) : data.items.length === 0 ? (
          <EmptyState
            title="No items match"
            description={q ? `Nothing matches “${q}” in this view.` : "No items in this view yet."}
          />
        ) : (
          <div className={cn("overflow-hidden rounded-lg border transition-opacity", itemsLoading && "opacity-60")}>
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4 text-xs font-medium text-muted-foreground">Prompt</TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground">Models</TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground">
                    <span title="Human votes: A better / tie / B better">Votes A · Tie · B</span>
                  </TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground">LLM</TableHead>
                  <TableHead className="text-xs font-medium text-muted-foreground">Tags</TableHead>
                  <TableHead className="text-right text-xs font-medium text-muted-foreground">Judgments</TableHead>
                  {isAdmin && <TableHead className="w-10 pr-4" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((it) => (
                  <TableRow
                    key={it.id}
                    className="cursor-pointer"
                    onClick={() => {
                      setSelected(it.id);
                      setSheetOpen(true);
                    }}
                  >
                    <TableCell className="max-w-[26rem] min-w-56 py-3 pl-4 whitespace-normal">
                      <p className="line-clamp-2 text-sm leading-snug">{it.prompt}</p>
                    </TableCell>
                    <TableCell className="font-mono text-[11px] leading-relaxed text-muted-foreground">
                      {it.model_a || it.model_b ? (
                        <div className="max-w-52">
                          <div className="truncate" title={it.model_a ?? undefined}>
                            <span className="text-foreground/50">A</span> {shortModel(it.model_a) ?? "—"}
                          </div>
                          <div className="truncate" title={it.model_b ?? undefined}>
                            <span className="text-foreground/50">B</span> {shortModel(it.model_b) ?? "—"}
                          </div>
                        </div>
                      ) : (
                        "—"
                      )}
                      {(!it.response_a || !it.response_b) && (
                        <div className="mt-1 font-sans">
                          <Pill>Pending responses</Pill>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Votes votes={it.human_votes} />
                    </TableCell>
                    <TableCell>
                      {it.llm_preference === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="inline-flex h-5 min-w-7 items-center justify-center rounded border px-1 text-xs font-medium">
                            {signLabel(it.llm_preference)}
                          </span>
                          {it.llm_consistent === false && <Pill tone="warn">inconsistent</Pill>}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {it.is_gold && (
                          <Pill>
                            <span className="mr-1 size-1.5 rounded-full bg-amber-500" />
                            Gold{it.gold_preference !== null && ` · ${signLabel(it.gold_preference)}`}
                          </Pill>
                        )}
                        {it.disputed && <Pill tone="warn">Disputed</Pill>}
                        {it.review_preference !== null && <Pill tone="good">Reviewed</Pill>}
                        {!it.is_gold && !it.disputed && it.review_preference === null && (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {int(it.judgments_count)}
                      {!it.is_gold && project && (
                        <span className="text-muted-foreground"> / {project.judgments_per_item}</span>
                      )}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="pr-4 text-right">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Delete item"
                          className="text-muted-foreground hover:text-red-600"
                          onClick={(e) => {
                            e.stopPropagation();
                            setToDelete(it);
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between gap-3 border-t bg-muted/20 px-4 py-2.5 text-sm">
              <span className="tabular text-muted-foreground">
                {int(page * PAGE_SIZE + 1)}–{int(Math.min(total, (page + 1) * PAGE_SIZE))} of {int(total)}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Previous page"
                  disabled={page === 0 || itemsLoading}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft />
                </Button>
                <span className="tabular px-2 text-xs text-muted-foreground">
                  {page + 1} / {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Next page"
                  disabled={page + 1 >= pageCount || itemsLoading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </div>
        )}
      </section>

      <ItemDetailSheet
        projectId={projectId}
        itemId={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onReviewed={reloadItems}
      />

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && !deleting && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this item?</AlertDialogTitle>
            <AlertDialogDescription>
              The item and all {toDelete?.judgments_count ? int(toDelete.judgments_count) : "its"} judgments, its LLM
              verdict and any review will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {toDelete && (
            <p className="line-clamp-3 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {toDelete.prompt}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleting}
              onClick={confirmDelete}
            >
              {deleting && <Loader2 className="animate-spin" />}
              Delete item
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* Table bits                                                                                       */
/* ------------------------------------------------------------------------------------------------ */

function Votes({ votes }: { votes: { a: number; tie: number; b: number } }) {
  const total = votes.a + votes.tie + votes.b;
  if (total === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="w-24" title={`A ${votes.a} · Tie ${votes.tie} · B ${votes.b}`}>
      <div className="tabular flex justify-between text-xs">
        <span>{votes.a}</span>
        <span className="text-muted-foreground">{votes.tie}</span>
        <span>{votes.b}</span>
      </div>
      <div className="mt-1 flex h-1 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-foreground" style={{ width: `${(votes.a / total) * 100}%` }} />
        <div className="h-full bg-zinc-300" style={{ width: `${(votes.tie / total) * 100}%` }} />
        <div className="h-full bg-zinc-500" style={{ width: `${(votes.b / total) * 100}%` }} />
      </div>
    </div>
  );
}

function ItemsSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="h-10 border-b bg-muted/40" />
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-6 border-b px-4 py-3.5 last:border-0">
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-full max-w-md" />
            <Skeleton className="h-3.5 w-2/3 max-w-xs" />
          </div>
          <Skeleton className="hidden h-8 w-32 md:block" />
          <Skeleton className="hidden h-6 w-24 md:block" />
          <Skeleton className="h-5 w-12" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* Add data                                                                                         */
/* ------------------------------------------------------------------------------------------------ */

const COLUMNS: { name: string; note: string; required?: boolean }[] = [
  { name: "prompt", note: "The user prompt", required: true },
  { name: "response_a", note: "First response" },
  { name: "response_b", note: "Second response" },
  { name: "model_a", note: "Model that wrote A" },
  { name: "model_b", note: "Model that wrote B" },
  { name: "is_gold", note: "true / false" },
  { name: "gold", note: "A, B or tie" },
  { name: "gold_explanation", note: "Shown after a gold answer" },
];

function csvCell(v: string) {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function downloadTemplate() {
  const rows = [
    COLUMNS.map((c) => c.name),
    [
      "Explain the difference between a process and a thread.",
      "A process is an independent program with its own memory space; threads are units of execution inside a process that share its memory.",
      "Processes and threads both run code, but threads are faster.",
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "false",
      "",
      "",
    ],
    ["Write a short, polite reply declining a meeting invitation.", "", "", "", "", "false", "", ""],
    [
      "What is 17 × 23?",
      "17 × 23 = 391.",
      "17 × 23 = 401.",
      "",
      "",
      "true",
      "A",
      "17 × 23 is 391. Correctness outweighs everything else when one answer is wrong.",
    ],
  ];
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "arbiter-items-template.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function AddDataCard({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [result, setResult] = useState<(UploadResult & { file: string }) | null>(null);

  async function upload(file: File) {
    const ext = file.name.toLowerCase().split(".").pop();
    if (ext !== "csv" && ext !== "jsonl") {
      toast.error("Upload a .csv or .jsonl file.");
      return;
    }
    setUploading(file.name);
    setResult(null);
    try {
      const res = await api.uploadItems(projectId, file);
      setResult({ ...res, file: file.name });
      if (res.inserted > 0) {
        toast.success(`Imported ${int(res.inserted)} ${res.inserted === 1 ? "item" : "items"}`);
        onChanged();
      } else {
        toast.error("No items were imported");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="pt-4 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <FileUp className="size-4 text-muted-foreground" /> Add data
        </CardTitle>
        <CardDescription className="text-xs">Import prompts and response pairs from CSV or JSONL.</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-3 pb-4">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void upload(f);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-5 text-center transition-colors focus-within:ring-3 focus-within:ring-ring/50 hover:bg-muted/40",
            dragging && "border-foreground/40 bg-muted/60",
            uploading && "pointer-events-none opacity-70",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.jsonl"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          {uploading ? (
            <>
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
              <span className="mt-2 max-w-full truncate text-sm">Uploading {uploading}…</span>
            </>
          ) : (
            <>
              <span className="text-sm font-medium">Drop a file or click to browse</span>
              <span className="mt-0.5 text-xs text-muted-foreground">.csv or .jsonl, one item per row</span>
            </>
          )}
        </label>

        {result && (
          <div className="rounded-md border text-xs">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0 truncate font-mono text-muted-foreground">{result.file}</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                aria-label="Dismiss"
                onClick={() => setResult(null)}
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="tabular flex gap-4 border-t px-3 py-2">
              <span>
                <span className="font-medium text-emerald-700">{int(result.inserted)}</span> inserted
              </span>
              <span>
                <span className="font-medium">{int(result.skipped)}</span> skipped
              </span>
              {result.errors.length > 0 && (
                <span>
                  <span className="font-medium text-red-700">{int(result.errors.length)}</span> errors
                </span>
              )}
            </div>
            {result.errors.length > 0 && (
              <ul className="max-h-28 space-y-0.5 overflow-y-auto border-t px-3 py-2 text-red-700">
                {result.errors.slice(0, 50).map((er, i) => (
                  <li key={i}>
                    <span className="tabular font-mono">Row {er.row}</span>: {er.message}
                  </li>
                ))}
                {result.errors.length > 50 && (
                  <li className="text-muted-foreground">and {int(result.errors.length - 50)} more</li>
                )}
              </ul>
            )}
          </div>
        )}

        <details className="group text-xs">
          <summary className="cursor-pointer list-none text-muted-foreground select-none hover:text-foreground">
            <span className="group-open:hidden">Show expected columns</span>
            <span className="hidden group-open:inline">Hide expected columns</span>
          </summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border bg-muted/30 px-3 py-2">
            {COLUMNS.map((c) => (
              <div key={c.name} className="contents">
                <dt className="font-mono">
                  {c.name}
                  {c.required && <span className="text-red-600">*</span>}
                </dt>
                <dd className="text-muted-foreground">{c.note}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-1.5 text-muted-foreground">
            Leave responses empty to generate them below. Any other columns are kept as metadata.
          </p>
        </details>
      </CardContent>
      <CardFooter className="justify-between gap-2 py-3">
        <Button variant="ghost" size="sm" onClick={downloadTemplate}>
          <Download /> Template
        </Button>
        <AddItemDialog projectId={projectId} onCreated={onChanged} />
      </CardFooter>
    </Card>
  );
}

function AddItemDialog({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [responseA, setResponseA] = useState("");
  const [responseB, setResponseB] = useState("");
  const [modelA, setModelA] = useState("");
  const [modelB, setModelB] = useState("");
  const [isGold, setIsGold] = useState(false);
  const [goldPref, setGoldPref] = useState<Sign | null>(null);
  const [explanation, setExplanation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setPrompt("");
    setResponseA("");
    setResponseB("");
    setModelA("");
    setModelB("");
    setIsGold(false);
    setGoldPref(null);
    setExplanation("");
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return setError("Prompt is required.");
    if (isGold && (!responseA.trim() || !responseB.trim())) return setError("Gold items need both responses.");
    if (isGold && goldPref === null) return setError("Pick the correct answer for this gold item.");
    setError(null);
    setSaving(true);
    try {
      await api.createItem(projectId, {
        prompt: prompt.trim(),
        response_a: responseA.trim() || null,
        response_b: responseB.trim() || null,
        model_a: modelA.trim() || null,
        model_b: modelB.trim() || null,
        is_gold: isGold,
        gold_preference: isGold ? goldPref : null,
        gold_explanation: isGold ? explanation.trim() || null : null,
      });
      toast.success("Item added");
      onCreated();
      reset();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add item");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Plus /> Add one item
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add an item</DialogTitle>
            <DialogDescription>Responses are optional; missing ones can be generated later.</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="item-prompt">Prompt</Label>
            <Textarea
              id="item-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              className="min-h-20"
              autoFocus
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["A", responseA, setResponseA, modelA, setModelA],
                ["B", responseB, setResponseB, modelB, setModelB],
              ] as const
            ).map(([side, resp, setResp, model, setModel]) => (
              <div key={side} className="space-y-1.5">
                <Label htmlFor={`item-resp-${side}`}>Response {side}</Label>
                <Textarea
                  id={`item-resp-${side}`}
                  value={resp}
                  onChange={(e) => setResp(e.target.value)}
                  rows={5}
                  className="min-h-28"
                />
                <Input
                  aria-label={`Model ${side}`}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={`Model ${side} (optional)`}
                  className="font-mono text-[13px]"
                />
              </div>
            ))}
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="item-gold">Gold item</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  A known-answer check. Contributors see the explanation after answering.
                </p>
              </div>
              <Switch id="item-gold" checked={isGold} onCheckedChange={(c) => setIsGold(c)} />
            </div>
            {isGold && (
              <>
                <div className="flex items-center gap-3">
                  <span className="text-sm">Correct answer</span>
                  <div role="radiogroup" aria-label="Correct answer" className="inline-flex rounded-lg border p-0.5">
                    {([-1, 0, 1] as Sign[]).map((v) => (
                      <button
                        key={v}
                        type="button"
                        role="radio"
                        aria-checked={goldPref === v}
                        onClick={() => setGoldPref(v)}
                        className={cn(
                          "h-7 min-w-12 rounded-md px-3 text-sm transition-colors",
                          goldPref === v
                            ? "bg-foreground font-medium text-background"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {signLabel(v)}
                      </button>
                    ))}
                  </div>
                </div>
                <Textarea
                  aria-label="Gold explanation"
                  value={explanation}
                  onChange={(e) => setExplanation(e.target.value)}
                  placeholder="Why this answer is correct, referencing the guidelines."
                  rows={2}
                  className="min-h-14"
                />
              </>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              Add item
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* LLM jobs                                                                                         */
/* ------------------------------------------------------------------------------------------------ */

const PREFERRED_A = "openai/gpt-oss-20b";
const PREFERRED_B = "qwen/qwen3.8-27b";

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-[13px]">
          {label}
        </Label>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={(c) => onChange(c)} className="mt-0.5" />
    </div>
  );
}

function GenerateCard({ projectId, busy, onStarted }: { projectId: string; busy: boolean; onStarted: () => void }) {
  const { models, failed } = useModels();
  const [modelA, setModelA] = useState("");
  const [modelB, setModelB] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [maxTokens, setMaxTokens] = useState("700");
  const [overwrite, setOverwrite] = useState(false);
  const [starting, setStarting] = useState(false);

  const defaults = useMemo(() => {
    const ids = models?.map((m) => m.id) ?? [];
    if (failed || ids.length === 0) return { a: failed ? PREFERRED_A : "", b: failed ? PREFERRED_B : "" };
    const a = ids.includes(PREFERRED_A) ? PREFERRED_A : ids[0];
    const b = ids.includes(PREFERRED_B) && PREFERRED_B !== a ? PREFERRED_B : (ids.find((i) => i !== a) ?? "");
    return { a, b };
  }, [models, failed]);

  const a = modelA || defaults.a;
  const b = modelB || defaults.b;

  async function start() {
    const tokens = Number(maxTokens);
    if (!a || !b) return toast.error("Pick both models.");
    if (!Number.isInteger(tokens) || tokens < 16 || tokens > 8192) return toast.error("Max tokens must be 16–8192.");
    setStarting(true);
    try {
      await api.generate(projectId, {
        model_a: a.trim(),
        model_b: b.trim(),
        overwrite,
        system_prompt: systemPrompt.trim() || undefined,
        max_tokens: tokens,
      });
      toast.success("Generation started", { description: "Progress shows in the jobs list." });
      onStarted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start generation");
    } finally {
      setStarting(false);
    }
  }

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="pt-4 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-muted-foreground" /> Generate responses
        </CardTitle>
        <CardDescription className="text-xs">Fill missing responses by sampling two models.</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-3 pb-4">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
          <Label htmlFor="gen-a" className="text-xs text-muted-foreground">
            Model A
          </Label>
          <ModelSelect id="gen-a" value={a} onChange={setModelA} models={models} failed={failed} />
          <Label htmlFor="gen-b" className="text-xs text-muted-foreground">
            Model B
          </Label>
          <ModelSelect id="gen-b" value={b} onChange={setModelB} models={models} failed={failed} />
        </div>
        <Textarea
          aria-label="System prompt"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="System prompt (optional)"
          rows={2}
          className="min-h-14 text-[13px]"
        />
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="gen-tokens" className="text-[13px]">
            Max tokens
          </Label>
          <Input
            id="gen-tokens"
            type="number"
            min={16}
            max={8192}
            value={maxTokens}
            onChange={(e) => setMaxTokens(e.target.value)}
            className="tabular w-24 text-right"
          />
        </div>
        <ToggleRow
          id="gen-overwrite"
          label="Overwrite existing"
          hint="Regenerate every non-gold item, not just missing ones."
          checked={overwrite}
          onChange={setOverwrite}
        />
      </CardContent>
      <CardFooter className="py-3">
        <Button className="w-full" onClick={start} disabled={starting || busy || !a || !b}>
          {(starting || busy) && <Loader2 className="animate-spin" />}
          {busy ? "Generation running…" : "Generate responses"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function JudgeCard({
  projectId,
  defaultModel,
  busy,
  onStarted,
}: {
  projectId: string;
  defaultModel: string;
  busy: boolean;
  onStarted: () => void;
}) {
  const { models, failed } = useModels();
  const [model, setModel] = useState("");
  const [bothOrders, setBothOrders] = useState(true);
  const [overwrite, setOverwrite] = useState(false);
  const [starting, setStarting] = useState(false);
  const m = model || defaultModel;

  async function start() {
    setStarting(true);
    try {
      await api.judge(projectId, { model: m.trim() || undefined, both_orders: bothOrders, overwrite });
      toast.success("LLM judge started", { description: "Progress shows in the jobs list." });
      onStarted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the judge");
    } finally {
      setStarting(false);
    }
  }

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="pt-4 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Gavel className="size-4 text-muted-foreground" /> Run LLM judge
        </CardTitle>
        <CardDescription className="text-xs">Pre-score every item that has both responses.</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-3 pb-4">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3">
          <Label htmlFor="judge-model" className="text-xs text-muted-foreground">
            Model
          </Label>
          <ModelSelect id="judge-model" value={m} onChange={setModel} models={models} failed={failed} />
        </div>
        <ToggleRow
          id="judge-both"
          label="Ask twice with swapped order"
          hint="Verdicts that flip with position are marked inconsistent and count as a tie."
          checked={bothOrders}
          onChange={setBothOrders}
        />
        <ToggleRow
          id="judge-overwrite"
          label="Overwrite existing verdicts"
          hint="Re-judge items that already have a verdict."
          checked={overwrite}
          onChange={setOverwrite}
        />
      </CardContent>
      <CardFooter className="py-3">
        <Button className="w-full" onClick={start} disabled={starting || busy}>
          {(starting || busy) && <Loader2 className="animate-spin" />}
          {busy ? "Judge running…" : "Run judge"}
        </Button>
      </CardFooter>
    </Card>
  );
}

const JOB_STATUS_TONE: Record<Job["status"], "neutral" | "info" | "good" | "bad"> = {
  queued: "neutral",
  running: "info",
  completed: "good",
  failed: "bad",
  cancelled: "neutral",
};

function JobsList({ jobs, canCancel, onChanged }: { jobs: Job[]; canCancel: boolean; onChanged: () => void }) {
  const [showAll, setShowAll] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const visible = showAll ? jobs : jobs.slice(0, 4);

  async function cancel(job: Job) {
    setCancelling(job.id);
    try {
      await api.cancelJob(job.id);
      toast.success("Job cancelled");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't cancel job");
    } finally {
      setCancelling(null);
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Jobs</h2>
        {jobs.length > 4 && (
          <Button variant="ghost" size="xs" onClick={() => setShowAll((s) => !s)}>
            {showAll ? "Show recent" : `Show all ${jobs.length}`}
          </Button>
        )}
      </div>
      <ul className="divide-y rounded-lg border">
        {visible.map((j) => {
          const active = isActiveJob(j);
          const frac = j.total > 0 ? Math.min(1, (j.done + j.failed) / j.total) : 0;
          const params = j.params ?? {};
          const modelInfo =
            j.kind === "generate"
              ? [params.model_a, params.model_b].filter(Boolean).map((x) => shortModel(String(x))).join(" vs ")
              : params.model
                ? shortModel(String(params.model))
                : "";
          return (
            <li key={j.id} className="grid gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_14rem_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{j.kind === "generate" ? "Generate responses" : "LLM judge"}</span>
                  <Pill tone={JOB_STATUS_TONE[j.status]} className="capitalize">
                    {j.status === "running" && <Loader2 className="mr-1 size-3 animate-spin" />}
                    {j.status}
                  </Pill>
                  <span className="text-xs text-muted-foreground">{relativeTime(j.created_at)}</span>
                </div>
                {modelInfo && <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{modelInfo}</div>}
                {j.error && (
                  <p className="mt-1 line-clamp-2 text-xs text-red-700" title={j.error}>
                    {j.error}
                  </p>
                )}
              </div>
              <div>
                <div className="tabular flex justify-between text-xs">
                  <span>
                    {int(j.done)} / {int(j.total)}
                  </span>
                  {j.failed > 0 && <span className="text-red-700">{int(j.failed)} failed</span>}
                </div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full transition-all", j.status === "failed" ? "bg-red-500" : "bg-foreground")}
                    style={{ width: `${frac * 100}%` }}
                  />
                </div>
              </div>
              <div className="flex justify-end sm:w-20">
                {canCancel && active && (
                  <Button variant="outline" size="xs" disabled={cancelling === j.id} onClick={() => cancel(j)}>
                    {cancelling === j.id && <Loader2 className="animate-spin" />}
                    Cancel
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
