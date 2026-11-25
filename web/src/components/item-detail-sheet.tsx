"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeftRight, Bot, CheckCircle2, Flag, Gavel, Loader2, RotateCcw, Timer } from "lucide-react";
import { api } from "@/lib/api";
import { preferenceLabel, relativeTime, sign, signLabel } from "@/lib/format";
import type { ItemDetail, Preference, Sign } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useProfile } from "@/components/profile-provider";
import { useProject } from "@/components/project-provider";
import { Pill } from "@/components/shared";
import { PreferenceScale } from "@/components/eval/preference-scale";
import { ResponseText } from "@/components/eval/response-text";
import { VoteBar } from "@/components/eval/vote-bar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface ItemDetailSheetProps {
  projectId: string;
  itemId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a reviewer decision is saved so lists can refresh. */
  onReviewed?: () => void;
}

export function ItemDetailSheet({ projectId, itemId, open, onOpenChange, onReviewed }: ItemDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[880px]">
        {itemId ? (
          <ItemDetailBody key={itemId} projectId={projectId} itemId={itemId} onReviewed={onReviewed} />
        ) : (
          <SheetHeader className="border-b">
            <SheetTitle>Item</SheetTitle>
            <SheetDescription>No item selected.</SheetDescription>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ItemDetailBody({
  projectId,
  itemId,
  onReviewed,
}: {
  projectId: string;
  itemId: string;
  onReviewed?: () => void;
}) {
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.item(projectId, itemId);
      setItem(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load this item");
    }
  }, [projectId, itemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const shortId = itemId.slice(0, 8);

  return (
    <>
      <SheetHeader className="border-b pr-12">
        <div className="flex flex-wrap items-center gap-2">
          <SheetTitle>Item</SheetTitle>
          <span className="font-mono text-xs text-muted-foreground">{shortId}</span>
          {item?.is_gold && <Pill tone="info">Gold</Pill>}
          {item?.disputed && !item.review && <Pill tone="warn">Disputed</Pill>}
          {item?.review && <Pill tone="good">Reviewed</Pill>}
        </div>
        <SheetDescription>
          {item
            ? `${item.judgments_count} human ${item.judgments_count === 1 ? "judgment" : "judgments"} · added ${relativeTime(item.created_at)}`
            : "Loading item…"}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto">
        {error && !item ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <AlertTriangle className="size-5 text-muted-foreground" strokeWidth={1.75} />
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RotateCcw /> Retry
            </Button>
          </div>
        ) : !item ? (
          <DetailSkeleton />
        ) : (
          <ItemDetailContent
            item={item}
            projectId={projectId}
            onSaved={async () => {
              await load();
              onReviewed?.();
            }}
          />
        )}
      </div>
    </>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-5 p-4">
      <Skeleton className="h-16 w-full" />
      <div className="grid gap-3 md:grid-cols-2">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{children}</h3>
      {right}
    </div>
  );
}

function ItemDetailContent({
  item,
  projectId,
  onSaved,
}: {
  item: ItemDetail;
  projectId: string;
  onSaved: () => Promise<void>;
}) {
  const { isStaff } = useProfile();
  const { project } = useProject();
  const labelFor = (key: string) => project?.rubric.find((c) => c.key === key)?.label ?? key;
  const humanMajority = majoritySign(item.human_votes);

  return (
    <div className="space-y-6 p-4">
      {/* Prompt */}
      <section>
        <SectionTitle>Prompt</SectionTitle>
        <div className="max-h-64 overflow-y-auto rounded-md border bg-muted/30 px-4 py-3">
          <ResponseText text={item.prompt} />
        </div>
      </section>

      {/* Responses (canonical order) */}
      <section className="grid gap-3 md:grid-cols-2">
        {(["a", "b"] as const).map((side) => {
          const text = side === "a" ? item.response_a : item.response_b;
          const model = side === "a" ? item.model_a : item.model_b;
          const winner =
            item.review !== null
              ? sign(item.review.final_preference)
              : item.is_gold
                ? item.gold_preference
                : humanMajority;
          const isWinner = winner !== null && winner !== 0 && (side === "a" ? winner === -1 : winner === 1);
          return (
            <div
              key={side}
              className={cn("flex min-w-0 flex-col rounded-lg border bg-card", isWinner && "border-foreground/40")}
            >
              <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3">
                <span className="text-sm font-medium">Response {side.toUpperCase()}</span>
                <span className="flex min-w-0 items-center gap-2">
                  {isWinner && <Pill>Preferred</Pill>}
                  <span className="truncate font-mono text-xs text-muted-foreground" title={model ?? undefined}>
                    {model ?? "unknown model"}
                  </span>
                </span>
              </div>
              <div className="max-h-[45vh] overflow-y-auto px-3 py-3">
                <ResponseText text={text} className="text-sm" />
              </div>
            </div>
          );
        })}
      </section>

      {/* Gold */}
      {item.is_gold && (
        <section className="rounded-lg border border-sky-200 bg-sky-50/40 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Pill tone="info">Gold</Pill>
            <span className="text-muted-foreground">Expected:</span>
            <span className="font-medium">
              {item.gold_preference === null
                ? "—"
                : item.gold_preference === 0
                  ? "Tie"
                  : `Response ${signLabel(item.gold_preference)} better`}
            </span>
          </div>
          {item.gold_explanation && (
            <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">{item.gold_explanation}</p>
          )}
        </section>
      )}

      {/* Summary */}
      <section className="grid gap-3 sm:grid-cols-3">
        <SummaryCell label="Human votes">
          <VoteBar votes={item.human_votes} />
        </SummaryCell>
        <SummaryCell label="Human mean">
          <span className="text-sm font-medium">{preferenceLabel(item.human_mean)}</span>
          {item.human_mean !== null && (
            <span className="tabular ml-1.5 font-mono text-xs text-muted-foreground">
              {item.human_mean > 0 ? "+" : ""}
              {item.human_mean.toFixed(2)}
            </span>
          )}
        </SummaryCell>
        <SummaryCell label="LLM judge">
          <span className="text-sm font-medium">{preferenceLabel(item.llm_preference)}</span>
          {item.llm_consistent === false && (
            <Pill tone="warn" className="ml-1.5">
              Inconsistent
            </Pill>
          )}
        </SummaryCell>
      </section>

      {/* Human judgments */}
      <section>
        <SectionTitle>Human judgments ({item.judgments.length})</SectionTitle>
        {item.judgments.length === 0 ? (
          <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No human judgments yet.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {item.judgments.map((j) => (
              <li key={j.id} className="space-y-2 px-3 py-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium">{j.user_name || j.user_email || "Unknown user"}</span>
                  {j.user_name && j.user_email && (
                    <span className="text-xs text-muted-foreground">{j.user_email}</span>
                  )}
                  <span className="ml-auto flex flex-wrap items-center gap-1.5">
                    {j.swapped && (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span className="inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-xs text-muted-foreground" />
                          }
                        >
                          <ArrowLeftRight className="size-3" /> Swapped
                        </TooltipTrigger>
                        <TooltipContent>Shown with B on the left. Values here are already canonical.</TooltipContent>
                      </Tooltip>
                    )}
                    {j.too_fast && (
                      <Pill tone="warn">
                        <Timer className="mr-1 size-3" /> Too fast
                      </Pill>
                    )}
                    {j.flagged && (
                      <Pill tone="bad">
                        <Flag className="mr-1 size-3" /> Flagged
                      </Pill>
                    )}
                    {j.is_gold && j.gold_correct !== null && (
                      <Pill tone={j.gold_correct ? "good" : "bad"}>
                        {j.gold_correct ? "Gold correct" : "Gold missed"}
                      </Pill>
                    )}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <PreferenceChip value={j.preference} />
                  {Object.entries(j.criteria ?? {}).map(([k, v]) => (
                    <CriterionChip key={k} label={labelFor(k)} value={v} />
                  ))}
                </div>
                {j.reason && <p className="text-sm whitespace-pre-wrap text-foreground/90">{j.reason}</p>}
                {j.flagged && j.flag_note && (
                  <p className="rounded-md border border-red-200 bg-red-50/50 px-2.5 py-1.5 text-xs text-red-800">
                    Flag note: {j.flag_note}
                  </p>
                )}
                <div className="tabular flex items-center gap-3 font-mono text-[11px] text-muted-foreground">
                  <span>{formatDuration(j.duration_ms)}</span>
                  <span>{relativeTime(j.created_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* LLM verdict */}
      <section>
        <SectionTitle>LLM judge</SectionTitle>
        {item.llm_judgment ? (
          <div className="space-y-2 rounded-lg border px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Bot className="size-4 text-muted-foreground" strokeWidth={1.75} />
              <span className="font-mono text-xs text-muted-foreground">{item.llm_judgment.model}</span>
              <span className="ml-auto">
                {item.llm_judgment.consistent ? (
                  <Pill tone="good">Consistent across orders</Pill>
                ) : (
                  <Tooltip>
                    <TooltipTrigger render={<span className="inline-flex" />}>
                      <Pill tone="warn">Position-dependent</Pill>
                    </TooltipTrigger>
                    <TooltipContent>
                      The judge disagreed with itself when the responses were swapped, so its verdict is recorded as a tie.
                    </TooltipContent>
                  </Tooltip>
                )}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <PreferenceChip value={item.llm_judgment.preference} />
              {Object.entries(item.llm_judgment.criteria ?? {}).map(([k, v]) => (
                <CriterionChip key={k} label={labelFor(k)} value={v} />
              ))}
            </div>
            {item.llm_judgment.rationale && (
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">{item.llm_judgment.rationale}</p>
            )}
          </div>
        ) : (
          <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            Not judged by the LLM yet.
          </p>
        )}
      </section>

      {/* Review */}
      {isStaff ? (
        <ReviewForm item={item} projectId={projectId} onSaved={onSaved} />
      ) : (
        item.review && (
          <section>
            <SectionTitle>Reviewer decision</SectionTitle>
            <ReviewSummary item={item} />
          </section>
        )
      )}
    </div>
  );
}

function ReviewSummary({ item }: { item: ItemDetail }) {
  if (!item.review) return null;
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50/40 px-3 py-2.5">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
      <div className="min-w-0 space-y-1">
        <p className="text-sm">
          <span className="font-medium">{preferenceLabel(item.review.final_preference)}</span>
          <span className="text-muted-foreground"> · decided {relativeTime(item.review.created_at)}</span>
        </p>
        {item.review.note && <p className="text-sm whitespace-pre-wrap text-muted-foreground">{item.review.note}</p>}
      </div>
    </div>
  );
}

function ReviewForm({
  item,
  projectId,
  onSaved,
}: {
  item: ItemDetail;
  projectId: string;
  onSaved: () => Promise<void>;
}) {
  const review = item.review;
  const [value, setValue] = useState<Preference | null>(review?.final_preference ?? null);
  const [note, setNote] = useState(review?.note ?? "");
  const [editing, setEditing] = useState(!review);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (value === null || saving) return;
    setSaving(true);
    try {
      await api.reviewItem(projectId, item.id, { final_preference: value, note: note.trim() });
      await onSaved();
      setEditing(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save the decision");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border bg-muted/20 p-3">
      <SectionTitle
        right={
          review && !editing ? (
            <Button variant="outline" size="xs" onClick={() => setEditing(true)}>
              Change decision
            </Button>
          ) : null
        }
      >
        <span className="inline-flex items-center gap-1.5">
          <Gavel className="size-3.5" /> Reviewer decision
        </span>
      </SectionTitle>

      {review && !editing ? (
        <ReviewSummary item={item} />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            The final label for this item. It overrides the human majority in the DPO export. A and B are the canonical
            responses shown above.
          </p>
          <PreferenceScale value={value} onChange={setValue} disabled={saving} aria-label="Final preference" />
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note for the record (optional): why this decision?"
            disabled={saving}
            className="min-h-16 resize-none bg-background text-sm"
          />
          <div className="flex items-center justify-end gap-2">
            {review && (
              <Button
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={() => {
                  setValue(review.final_preference);
                  setNote(review.note ?? "");
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            )}
            <Button size="sm" disabled={value === null || saving} onClick={() => void save()}>
              {saving && <Loader2 className="animate-spin" />}
              {review ? "Update decision" : "Save decision"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function SummaryCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border px-3 py-2.5">
      <div className="mb-1.5 text-xs text-muted-foreground">{label}</div>
      <div className="flex min-h-5 flex-wrap items-center">{children}</div>
    </div>
  );
}

function PreferenceChip({ value }: { value: number }) {
  return (
    <span className="inline-flex h-6 items-center rounded-md bg-foreground px-2 text-xs font-medium text-background">
      {preferenceLabel(value)}
    </span>
  );
}

function CriterionChip({ label, value }: { label: string; value: Sign }) {
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-md border px-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{signLabel(value)}</span>
    </span>
  );
}

function majoritySign(v: { a: number; tie: number; b: number }): Sign | null {
  const total = v.a + v.tie + v.b;
  if (!total) return null;
  if (v.a * 2 > total) return -1;
  if (v.b * 2 > total) return 1;
  if (v.tie * 2 > total) return 0;
  return null;
}

function formatDuration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

