"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { int, preferenceLabel } from "@/lib/format";
import type { DisputeReason, Paged, ReviewQueueRow } from "@/lib/types";
import { useProject } from "@/components/project-provider";
import { EmptyState, PageHeader, Pill } from "@/components/shared";
import { ItemDetailSheet } from "@/components/item-detail-sheet";
import { VoteBar } from "@/components/eval/vote-bar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PAGE_SIZE = 25;

const REASON: Record<DisputeReason, { label: string; tone: "warn" | "info" | "bad" }> = {
  human_split: { label: "Humans split", tone: "warn" },
  llm_disagrees: { label: "LLM disagrees", tone: "info" },
  flagged: { label: "Flagged", tone: "bad" },
};

export default function ReviewQueuePage() {
  const { projectId } = useProject();
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Paged<ReviewQueueRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const fetchPage = useCallback(
    async (off: number) => {
      try {
        const res = await api.reviewQueue(projectId, { limit: PAGE_SIZE, offset: off });
        setData(res);
        setError(null);
        return res;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Couldn't load the review queue";
        setError(msg);
        toast.error(msg);
        return null;
      }
    },
    [projectId],
  );

  useEffect(() => {
    void fetchPage(offset);
  }, [fetchPage, offset]);

  const goTo = (off: number) => {
    setData(null);
    setOffset(off);
  };

  const openItem = (id: string) => {
    setOpenId(id);
    setSheetOpen(true);
  };

  const onReviewed = async () => {
    toast.success("Decision saved");
    const prev = data?.items ?? [];
    const idx = prev.findIndex((r) => r.id === openId);
    // The reviewed item leaves the queue; move on to the next one in line.
    const candidates = [...prev.slice(idx + 1), ...prev.slice(0, Math.max(idx, 0))];
    let res = await fetchPage(offset);
    if (res && res.items.length === 0 && offset > 0) {
      const off = Math.max(0, offset - PAGE_SIZE);
      setOffset(off);
      res = await fetchPage(off);
    }
    const stillQueued = new Set(res?.items.map((r) => r.id) ?? []);
    const next = candidates.find((r) => stillQueued.has(r.id) && r.id !== openId);
    if (next) setOpenId(next.id);
    else setSheetOpen(false);
  };

  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Review queue"
        description="Items where humans split, the LLM judge disagrees with the majority, or someone flagged the content. Your decision becomes the final label."
        actions={
          data && total > 0 ? (
            <span className="tabular text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{int(total)}</span> open
            </span>
          ) : null
        }
      />

      {error && !data ? (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load the review queue"
          description={error}
          action={
            <Button variant="outline" onClick={() => void fetchPage(offset)}>
              <RotateCcw /> Retry
            </Button>
          }
        />
      ) : !data ? (
        <div className="overflow-hidden rounded-lg border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b px-4 py-3.5 last:border-0">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-28" />
            </div>
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Queue is clear"
          description="No disputed items right now. Items land here when annotators split, the LLM judge disagrees, or content is flagged."
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-4">Prompt</TableHead>
                  <TableHead>Reasons</TableHead>
                  <TableHead>Human votes</TableHead>
                  <TableHead>LLM verdict</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((row) => (
                  <TableRow
                    key={row.id}
                    tabIndex={0}
                    onClick={() => openItem(row.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openItem(row.id);
                      }
                    }}
                    className="group cursor-pointer outline-none focus-visible:bg-muted/60"
                  >
                    <TableCell className="max-w-0 min-w-60 py-3 pl-4 whitespace-normal">
                      <p className="line-clamp-2 text-sm">{row.prompt}</p>
                      <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                        {row.model_a ?? "?"} <span className="text-muted-foreground/60">vs</span> {row.model_b ?? "?"}
                      </p>
                    </TableCell>
                    <TableCell className="w-48">
                      <div className="flex flex-wrap gap-1">
                        {row.reasons.map((r) => (
                          <Pill key={r} tone={REASON[r]?.tone ?? "neutral"}>
                            {REASON[r]?.label ?? r}
                          </Pill>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="w-52">
                      <VoteBar votes={row.human_votes} />
                    </TableCell>
                    <TableCell className="w-40">
                      {row.llm_preference === null ? (
                        <span className="text-sm text-muted-foreground">Not judged</span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm">{preferenceLabel(row.llm_preference)}</span>
                          {row.llm_consistent === false && (
                            <span className="text-xs text-amber-700" title="Verdict changed when responses were swapped">
                              unstable
                            </span>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="pr-3">
                      <ChevronRight className="size-4 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span className="tabular">
                {int(from)}–{int(to)} of {int(total)}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => goTo(Math.max(0, offset - PAGE_SIZE))}
                >
                  <ChevronLeft /> Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => goTo(offset + PAGE_SIZE)}
                >
                  Next <ChevronRight />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <ItemDetailSheet
        projectId={projectId}
        itemId={openId}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onReviewed={() => void onReviewed()}
      />
    </div>
  );
}
