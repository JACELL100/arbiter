"use client";

import Link from "next/link";
import { useCallback, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  Loader2,
  PauseCircle,
  RotateCcw,
  SkipForward,
  XCircle,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { sign } from "@/lib/format";
import type { Preference, Sign, SubmitResponse, Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useProject } from "@/components/project-provider";
import { useProfile } from "@/components/profile-provider";
import { PREFERENCE_OPTIONS, PreferenceScale, TriToggle } from "@/components/eval/preference-scale";
import { ResponseText } from "@/components/eval/response-text";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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

type PageState =
  | { kind: "loading" }
  | { kind: "task"; task: Task }
  | { kind: "done" }
  | { kind: "paused"; detail: string | null }
  | { kind: "error"; message: string };

const isPausedError = (e: unknown) => e instanceof ApiError && e.status === 403 && /paused/i.test(e.message);
const pausedDetail = (msg: string) => msg.replace(/^paused:\s*/i, "").trim() || null;

/* -------------------------------------------------------------------------------------------- */
/* Page: owns the task lifecycle (next -> task -> submit -> next | done | paused)                 */
/* -------------------------------------------------------------------------------------------- */

export default function AnnotatePage() {
  const { projectId, project } = useProject();
  const { isStaff } = useProfile();
  const [state, setState] = useState<PageState>({ kind: "loading" });

  const backHref = isStaff ? `/app/projects/${projectId}` : "/app";

  /** Fetches the next task without clearing the current screen (no skeleton flash between tasks). */
  const fetchNext = useCallback(async () => {
    try {
      const res = await api.next(projectId);
      if ("done" in res) setState({ kind: "done" });
      else setState({ kind: "task", task: res });
    } catch (e) {
      if (isPausedError(e)) setState({ kind: "paused", detail: pausedDetail((e as Error).message) });
      else setState({ kind: "error", message: e instanceof Error ? e.message : "Couldn't load the next task" });
    }
  }, [projectId]);

  useEffect(() => {
    void fetchNext();
  }, [fetchNext]);

  const retry = () => {
    setState({ kind: "loading" });
    void fetchNext();
  };

  const onFinished = (paused: boolean) => {
    if (paused) setState({ kind: "paused", detail: null });
    else void fetchNext();
  };

  const name = project?.name ?? (state.kind === "task" ? state.task.project.name : null);

  if (state.kind === "task") {
    return (
      <TaskView
        key={state.task.assignment_id}
        task={state.task}
        backHref={backHref}
        onFinished={onFinished}
      />
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col md:min-h-screen">
      <TopBar backHref={backHref} title={name} />
      {state.kind === "loading" && <TaskSkeleton />}
      {state.kind === "error" && (
        <CenterState
          icon={<AlertTriangle className="size-5 text-muted-foreground" strokeWidth={1.75} />}
          title="Couldn't load a task"
          description={state.message}
          actions={
            <>
              <Button onClick={retry}>
                <RotateCcw /> Try again
              </Button>
              <Link href={backHref} className={buttonVariants({ variant: "outline" })}>
                Back
              </Link>
            </>
          }
        />
      )}
      {state.kind === "done" && (
        <CenterState
          icon={<CheckCircle2 className="size-5 text-emerald-600" strokeWidth={1.75} />}
          title="All caught up"
          description="You've judged every item currently available to you in this project. New items will show up here as they're added."
          actions={
            <>
              <Link href={backHref} className={buttonVariants()}>
                {isStaff ? "Back to project" : "Back to projects"}
              </Link>
              <Button variant="outline" onClick={retry}>
                <RotateCcw /> Check again
              </Button>
            </>
          }
        />
      )}
      {state.kind === "paused" && (
        <CenterState
          icon={<PauseCircle className="size-5 text-amber-600" strokeWidth={1.75} />}
          title="Annotation paused"
          description={
            <>
              Your accuracy on quality-check items fell below this project&apos;s threshold, so new tasks are on hold.
              An admin can review your judgments and reinstate you.
              {state.detail && (
                <span className="mt-3 block rounded-md border bg-muted/50 px-3 py-2 text-left text-xs text-muted-foreground">
                  {state.detail}
                </span>
              )}
            </>
          }
          actions={
            <Link href={backHref} className={buttonVariants({ variant: "outline" })}>
              {isStaff ? "Back to project" : "Back to projects"}
            </Link>
          }
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Chrome                                                                                       */
/* -------------------------------------------------------------------------------------------- */

function TopBar({
  backHref,
  title,
  children,
}: {
  backHref: string;
  title: string | null;
  children?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 flex min-h-12 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b bg-background px-4 py-2 lg:static">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Link
          href={backHref}
          aria-label="Back"
          className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "-ml-1.5 text-muted-foreground")}
        >
          <ArrowLeft />
        </Link>
        {title ? (
          <span className="truncate text-sm font-medium">{title}</span>
        ) : (
          <Skeleton className="h-4 w-40" />
        )}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </header>
  );
}

function CenterState({
  icon,
  title,
  description,
  actions,
}: {
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-4 grid size-10 place-items-center rounded-md border bg-muted/50">{icon}</div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <div className="mt-1.5 text-sm text-pretty text-muted-foreground">{description}</div>
        {actions && <div className="mt-6 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

function TaskSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-3 p-4">
      <Skeleton className="h-20 w-full" />
      <div className="grid flex-1 gap-3 md:grid-cols-2">
        <Skeleton className="min-h-64" />
        <Skeleton className="min-h-64" />
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Task view: one assignment. Keyed by assignment_id so all state resets per task.             */
/* -------------------------------------------------------------------------------------------- */

type Feedback = NonNullable<SubmitResponse["gold_feedback"]> & { choice: Preference; paused: boolean };

const noopSubscribe = () => () => {};
function useIsMac() {
  return useSyncExternalStore(
    noopSubscribe,
    () => /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent),
    () => false,
  );
}

function formatClock(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function TaskView({
  task,
  backHref,
  onFinished,
}: {
  task: Task;
  backHref: string;
  onFinished: (paused: boolean) => void;
}) {
  const rubric = task.project.rubric ?? [];
  const minChars = task.project.min_reason_chars ?? 0;
  const minSeconds = task.project.min_seconds ?? 0;
  const isMac = useIsMac();
  const modKey = isMac ? "⌘" : "Ctrl";

  const [overall, setOverall] = useState<Preference | null>(null);
  const [criteria, setCriteria] = useState<Record<string, Sign>>({});
  const [active, setActive] = useState(0);
  const [reason, setReason] = useState("");
  const [flagged, setFlagged] = useState(false);
  const [flagNote, setFlagNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [guidelinesOpen, setGuidelinesOpen] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipReason, setSkipReason] = useState("");
  const [skipping, setSkipping] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const startRef = useRef(0);
  const frozenRef = useRef(false);
  const submittingRef = useRef(false);
  const continuedRef = useRef(false);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Timer starts when the task first renders; duration_ms is measured from the same origin.
  useEffect(() => {
    startRef.current = performance.now();
    const t = setInterval(() => {
      if (frozenRef.current) return;
      setElapsed(Math.floor((performance.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const reasonLen = reason.trim().length;
  const unsetCriteria = rubric.filter((c) => criteria[c.key] === undefined).length;
  const missing: string[] = [];
  if (overall === null) missing.push("choose an overall preference");
  if (unsetCriteria > 0) missing.push(`rate ${unsetCriteria} more ${unsetCriteria === 1 ? "criterion" : "criteria"}`);
  if (reasonLen < minChars) missing.push(`add ${minChars - reasonLen} more ${minChars - reasonLen === 1 ? "character" : "characters"} to the reason`);
  const canSubmit = missing.length === 0 && !submitting && !feedback;
  const tooQuick = elapsed < minSeconds;
  const locked = submitting || !!feedback;

  const setCriterion = (idx: number, v: Sign) => {
    const c = rubric[idx];
    if (!c) return;
    setCriteria((prev) => ({ ...prev, [c.key]: v }));
  };

  const moveActive = (delta: number) => {
    if (!rubric.length) return;
    const next = Math.min(rubric.length - 1, Math.max(0, active + delta));
    setActive(next);
    rowRefs.current[next]?.scrollIntoView({ block: "nearest" });
  };

  const submit = async () => {
    if (overall === null || missing.length > 0 || submittingRef.current || feedback) return;
    submittingRef.current = true;
    setSubmitting(true);
    const duration_ms = Math.max(0, Math.round(performance.now() - startRef.current));
    const note = flagNote.trim();
    try {
      const res = await api.submit(task.assignment_id, {
        choice: overall,
        criteria,
        reason: reason.trim(),
        duration_ms,
        ...(flagged ? { flagged: true, ...(note ? { flag_note: note } : {}) } : {}),
      });
      if (res.gold_feedback) {
        frozenRef.current = true;
        setFeedback({ ...res.gold_feedback, choice: overall, paused: res.paused });
        setSubmitting(false);
      } else {
        // Keep the submitting state until the parent swaps in the next task.
        onFinished(res.paused);
      }
    } catch (e) {
      submittingRef.current = false;
      setSubmitting(false);
      toast.error(e instanceof Error ? e.message : "Couldn't submit your judgment");
      // The assignment expired or was already closed: move on to a fresh task.
      if (e instanceof ApiError && [404, 409, 410].includes(e.status)) onFinished(false);
      else if (isPausedError(e)) onFinished(true);
    }
  };

  const onContinue = () => {
    if (!feedback || continuedRef.current) return;
    continuedRef.current = true;
    setSubmitting(true);
    onFinished(feedback.paused);
  };

  const doSkip = async () => {
    if (skipping || submittingRef.current) return;
    setSkipping(true);
    try {
      await api.skip(task.assignment_id, skipReason.trim() || undefined);
      submittingRef.current = true;
      setSkipOpen(false);
      setSubmitting(true);
      onFinished(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't skip this item");
      setSkipping(false);
    }
  };

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing) return;
    const mod = e.metaKey || e.ctrlKey;
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;

    if (guidelinesOpen || skipOpen) {
      return;
    }

    if (mod && e.key === "Enter") {
      e.preventDefault();
      if (feedback) onContinue();
      else void submit();
      return;
    }

    const typing = tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT" || !!target?.isContentEditable;
    if (typing || mod || e.altKey) return;

    if (feedback) {
      // A focused button handles Enter natively; avoid firing twice.
      if (e.key === "Enter" && tag !== "BUTTON" && tag !== "A") {
        e.preventDefault();
        onContinue();
      }
      return;
    }
    if (submitting) return;

    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key >= "1" && key <= "5" && key.length === 1) {
      e.preventDefault();
      setOverall(PREFERENCE_OPTIONS[Number(key) - 1].value);
      return;
    }
    switch (key) {
      case "q":
      case "w":
      case "e": {
        if (!rubric.length) return;
        e.preventDefault();
        setCriterion(active, key === "q" ? -1 : key === "w" ? 0 : 1);
        moveActive(1);
        return;
      }
      case "j":
      case "ArrowDown":
        if (!rubric.length) return;
        e.preventDefault();
        moveActive(1);
        return;
      case "k":
      case "ArrowUp":
        if (!rubric.length) return;
        e.preventDefault();
        moveActive(-1);
        return;
      case "s":
        e.preventDefault();
        setSkipOpen(true);
        return;
      case "g":
        e.preventDefault();
        setGuidelinesOpen(true);
        return;
    }
  });

  useEffect(() => {
    const h = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const overallSign = sign(overall);

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col md:min-h-screen lg:h-screen lg:min-h-0">
      <TopBar backHref={backHref} title={task.project.name}>
        <span className="tabular hidden text-xs text-muted-foreground sm:inline">
          <span className="font-medium text-foreground">{task.progress.my_judgments}</span> done
          <span className="mx-1.5 text-border">|</span>
          <span className="font-medium text-foreground">{task.progress.remaining_items}</span> remaining
        </span>
        <span
          className={cn(
            "tabular min-w-12 text-right font-mono text-xs text-muted-foreground",
            feedback && "text-muted-foreground/60",
          )}
          aria-label="Time on this item"
        >
          {formatClock(elapsed)}
        </span>
        <Button variant="ghost" size="sm" onClick={() => setSkipOpen(true)} disabled={locked}>
          <SkipForward /> Skip <kbd className="ml-0.5 hidden md:inline-flex">S</kbd>
        </Button>
        <Button variant="outline" size="sm" onClick={() => setGuidelinesOpen(true)}>
          <BookOpen /> Guidelines <kbd className="ml-0.5 hidden md:inline-flex">G</kbd>
        </Button>
      </TopBar>

      {/* Prompt + responses */}
      <div className="flex flex-col gap-3 p-3 sm:p-4 lg:min-h-0 lg:flex-1">
        <PromptPanel prompt={task.prompt} />
        <div className="grid gap-3 md:grid-cols-2 lg:min-h-0 lg:flex-1">
          <ResponsePanel label="Response A" text={task.left.text} leaning={overallSign === -1} />
          <ResponsePanel label="Response B" text={task.right.text} leaning={overallSign === 1} />
        </div>
      </div>

      {/* Decision panel */}
      <div className="shrink-0 border-t bg-background">
        {feedback ? (
          <GoldFeedbackCard feedback={feedback} onContinue={onContinue} busy={submitting} />
        ) : (
          <div className="grid divide-y lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)] lg:divide-x lg:divide-y-0">
            {/* Criteria */}
            <section className="flex min-w-0 flex-col p-4 lg:max-h-[38vh]">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Criteria</h2>
                {rubric.length > 0 && (
                  <span className="hidden items-center gap-1 text-[11px] text-muted-foreground lg:flex">
                    <kbd>Q</kbd>
                    <kbd>W</kbd>
                    <kbd>E</kbd>
                    <span className="ml-0.5">rate</span>
                    <kbd className="ml-2">J</kbd>
                    <kbd>K</kbd>
                    <span className="ml-0.5">move</span>
                  </span>
                )}
              </div>
              {rubric.length === 0 ? (
                <p className="text-sm text-muted-foreground">This project has no rubric criteria. Choose an overall preference.</p>
              ) : (
                <div className="-mx-2 space-y-0.5 lg:min-h-0 lg:overflow-y-auto">
                  {rubric.map((c, i) => {
                    const isActive = i === active;
                    return (
                      <div
                        key={c.key}
                        ref={(el) => {
                          rowRefs.current[i] = el;
                        }}
                        onClick={() => setActive(i)}
                        className={cn(
                          "relative flex items-center justify-between gap-3 rounded-md px-2 py-1.5 transition-colors",
                          isActive ? "bg-muted" : "hover:bg-muted/50",
                        )}
                      >
                        {isActive && (
                          <span className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-foreground" aria-hidden />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-sm font-medium">
                            {criteria[c.key] !== undefined && (
                              <CheckCircle2 className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
                            )}
                            <span className="truncate">{c.label}</span>
                          </div>
                          {c.description && (
                            <p className="line-clamp-1 text-xs text-muted-foreground" title={c.description}>
                              {c.description}
                            </p>
                          )}
                        </div>
                        <TriToggle
                          label={c.label}
                          value={criteria[c.key] ?? null}
                          disabled={locked}
                          onChange={(v) => {
                            setActive(i);
                            setCriterion(i, v);
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Overall + flag */}
            <section className="flex min-w-0 flex-col gap-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Overall preference</h2>
                <span className="hidden items-center gap-1 text-[11px] text-muted-foreground lg:flex">
                  <kbd>1</kbd>–<kbd>5</kbd>
                </span>
              </div>
              <PreferenceScale value={overall} onChange={setOverall} showKbd disabled={locked} />
              <div className="mt-auto space-y-2 pt-1">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox checked={flagged} onCheckedChange={(v) => setFlagged(v)} disabled={locked} />
                  Flag this item
                  <span className="text-xs text-muted-foreground">broken, unsafe or off-topic</span>
                </label>
                {flagged && (
                  <Input
                    value={flagNote}
                    onChange={(e) => setFlagNote(e.target.value)}
                    placeholder="What's wrong with it? (optional)"
                    disabled={locked}
                    className="h-8"
                    maxLength={500}
                  />
                )}
              </div>
            </section>

            {/* Reason + submit */}
            <section className="flex min-w-0 flex-col gap-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="reason" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Reason
                </label>
                <span
                  className={cn(
                    "tabular font-mono text-[11px]",
                    reasonLen >= minChars ? "text-emerald-700" : "text-muted-foreground",
                  )}
                >
                  {reasonLen}/{minChars}
                </span>
              </div>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={locked}
                placeholder="What made one response better? Point to specific errors, omissions or strengths."
                className="max-h-40 min-h-20 resize-none text-sm"
              />
              <div className="mt-auto space-y-1.5 pt-1">
                <Button className="h-9 w-full" disabled={!canSubmit} onClick={() => void submit()}>
                  {submitting ? (
                    <>
                      <Loader2 className="animate-spin" /> Submitting
                    </>
                  ) : (
                    <>
                      Submit
                      <span className="ml-1 inline-flex items-center gap-0.5 font-mono text-[11px] opacity-70">
                        {modKey} ↵
                      </span>
                    </>
                  )}
                </Button>
                {!submitting && missing.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    To submit, {missing.join(", ")}.
                  </p>
                ) : !submitting && tooQuick ? (
                  <p className="flex items-center gap-1.5 text-xs text-amber-700">
                    <AlertTriangle className="size-3.5 shrink-0" />
                    That was quick — make sure you read both responses.
                  </p>
                ) : null}
              </div>
            </section>
          </div>
        )}

        <div className="hidden h-8 items-center gap-4 border-t px-4 text-[11px] text-muted-foreground lg:flex">
          <Shortcut keys={["1", "5"]} range label="overall" />
          <Shortcut keys={["Q", "W", "E"]} label="A / tie / B" />
          <Shortcut keys={["J", "K"]} label="move" />
          <Shortcut keys={[modKey, "↵"]} label={feedback ? "continue" : "submit"} />
          <Shortcut keys={["S"]} label="skip" />
          <Shortcut keys={["G"]} label="guidelines" />
          <span className="ml-auto">Response A is on the left, B on the right.</span>
        </div>
      </div>

      <GuidelinesSheet open={guidelinesOpen} onOpenChange={setGuidelinesOpen} task={task} modKey={modKey} />

      <AlertDialog
        open={skipOpen}
        onOpenChange={(o) => {
          if (!skipping) setSkipOpen(o);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Skip this item?</AlertDialogTitle>
            <AlertDialogDescription>
              It goes back to the pool for someone else, and you won&apos;t see it again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            autoFocus
            value={skipReason}
            onChange={(e) => setSkipReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void doSkip();
              }
            }}
            placeholder="Reason (optional), e.g. outside my expertise"
            maxLength={300}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={skipping}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doSkip()} disabled={skipping}>
              {skipping ? <Loader2 className="animate-spin" /> : <CircleSlash />} Skip item
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Shortcut({ keys, label, range }: { keys: string[]; label: string; range?: boolean }) {
  return (
    <span className="flex items-center gap-1">
      {range ? (
        <>
          <kbd>{keys[0]}</kbd>–<kbd>{keys[1]}</kbd>
        </>
      ) : (
        keys.map((k) => <kbd key={k}>{k}</kbd>)
      )}
      <span className="ml-0.5">{label}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------------------------- */
/* Panels                                                                                       */
/* -------------------------------------------------------------------------------------------- */

function PromptPanel({ prompt }: { prompt: string }) {
  const isLong = prompt.length > 420 || prompt.split("\n").length > 7;
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="shrink-0 rounded-lg border bg-muted/30">
      <div className="flex items-center justify-between px-4 pt-2.5">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Prompt</h2>
        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            aria-expanded={expanded}
          >
            {expanded ? (
              <>
                Collapse <ChevronUp className="size-3.5" />
              </>
            ) : (
              <>
                Show full prompt <ChevronDown className="size-3.5" />
              </>
            )}
          </button>
        )}
      </div>
      <div
        className={cn(
          "px-4 pt-1.5 pb-3",
          isLong && !expanded && "max-h-28 overflow-hidden",
          isLong && expanded && "max-h-[40vh] overflow-y-auto",
        )}
      >
        <ResponseText text={prompt} />
      </div>
      {isLong && !expanded && <div className="mx-4 mb-2 border-t border-dashed" aria-hidden />}
    </section>
  );
}

function ResponsePanel({ label, text, leaning }: { label: string; text: string; leaning: boolean }) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return (
    <section
      className={cn(
        "flex min-h-0 min-w-0 flex-col rounded-lg border bg-card transition-colors",
        leaning && "border-foreground/40",
      )}
      aria-label={label}
    >
      <header className="flex h-9 shrink-0 items-center justify-between border-b px-4">
        <span className="text-sm font-medium">{label}</span>
        <span className="tabular text-xs text-muted-foreground">{words.toLocaleString()} words</span>
      </header>
      <div className="max-h-[60vh] min-h-0 flex-1 overflow-y-auto px-4 py-3 lg:max-h-none" tabIndex={0}>
        <ResponseText text={text} />
      </div>
    </section>
  );
}

function GoldFeedbackCard({
  feedback,
  onContinue,
  busy,
}: {
  feedback: Feedback;
  onContinue: () => void;
  busy: boolean;
}) {
  const userSign = sign(feedback.choice) ?? 0;
  const side = (s: number) => (s < 0 ? "Response A" : "Response B");
  let expected: string;
  if (feedback.expected === 0) expected = "a tie — neither response is meaningfully better.";
  else if (feedback.correct && userSign !== 0) expected = `${side(userSign)} — your pick matched.`;
  else if (userSign !== 0) expected = `${side(-userSign)}, the other response.`;
  else expected = "a clear preference — one response is meaningfully better than the other.";

  return (
    <div className="p-4">
      <div
        className={cn(
          "mx-auto flex max-w-3xl flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-start",
          feedback.correct ? "border-emerald-200 bg-emerald-50/50" : "border-red-200 bg-red-50/50",
        )}
        role="status"
      >
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            {feedback.correct ? (
              <CheckCircle2 className="size-4 text-emerald-600" />
            ) : (
              <XCircle className="size-4 text-red-600" />
            )}
            <span className={cn("text-sm font-semibold", feedback.correct ? "text-emerald-800" : "text-red-800")}>
              {feedback.correct ? "Correct" : "Not quite"}
            </span>
            <span className="text-xs text-muted-foreground">This was a quality-check item with a known answer.</span>
          </div>
          <p className="text-sm">
            <span className="text-muted-foreground">Expected: </span>
            {expected}
          </p>
          {feedback.explanation && (
            <p className="rounded-md border bg-background px-3 py-2 text-sm whitespace-pre-wrap text-foreground">
              {feedback.explanation}
            </p>
          )}
          {feedback.paused && (
            <p className="flex items-center gap-1.5 text-xs text-amber-700">
              <AlertTriangle className="size-3.5" />
              Your quality-check accuracy is now below the project threshold, so annotation will pause.
            </p>
          )}
        </div>
        <Button autoFocus onClick={onContinue} disabled={busy} className="shrink-0 self-end sm:self-start">
          {busy ? <Loader2 className="animate-spin" /> : null}
          Continue <kbd className="ml-1 border-background/30 bg-background/15 text-background">↵</kbd>
        </Button>
      </div>
    </div>
  );
}

function GuidelinesSheet({
  open,
  onOpenChange,
  task,
  modKey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task;
  modKey: string;
}) {
  const rubric = task.project.rubric ?? [];
  const shortcuts: [React.ReactNode, string][] = [
    [
      <>
        <kbd>1</kbd>–<kbd>5</kbd>
      </>,
      "Overall: A much better … B much better",
    ],
    [
      <>
        <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd>
      </>,
      "Rate highlighted criterion A / tie / B, then advance",
    ],
    [
      <>
        <kbd>J</kbd> <kbd>K</kbd>
      </>,
      "Move criterion highlight down / up (or arrow keys)",
    ],
    [
      <>
        <kbd>{modKey}</kbd> <kbd>↵</kbd>
      </>,
      "Submit (works while typing)",
    ],
    [<kbd key="s">S</kbd>, "Skip this item"],
    [<kbd key="g">G</kbd>, "Open guidelines"],
  ];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader className="border-b">
          <SheetTitle>Guidelines</SheetTitle>
          <SheetDescription>{task.project.name}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          <section>
            <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Instructions</h3>
            {task.project.instructions?.trim() ? (
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{task.project.instructions}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No project-specific instructions. Judge which response better serves the prompt.</p>
            )}
          </section>
          {rubric.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Rubric</h3>
              <dl className="divide-y rounded-md border">
                {rubric.map((c) => (
                  <div key={c.key} className="px-3 py-2.5">
                    <dt className="text-sm font-medium">{c.label}</dt>
                    {c.description && <dd className="mt-0.5 text-sm text-muted-foreground">{c.description}</dd>}
                  </div>
                ))}
              </dl>
            </section>
          )}
          <section>
            <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">How to judge</h3>
            <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
              <li>Read the prompt and both responses fully before deciding.</li>
              <li>Use &quot;much better&quot; only when the gap is clear and material.</li>
              <li>Choose tie when neither response is meaningfully better.</li>
              <li>Explain your choice with specifics; reviewers read your reasons.</li>
              <li>Some items are quality checks with a known answer. You&apos;ll see feedback after submitting them.</li>
            </ul>
          </section>
          <section>
            <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Keyboard</h3>
            <dl className="space-y-2">
              {shortcuts.map(([k, d], i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  <dt className="flex w-20 shrink-0 items-center gap-0.5">{k}</dt>
                  <dd className="text-muted-foreground">{d}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
