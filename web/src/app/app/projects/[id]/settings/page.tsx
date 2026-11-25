"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { ProjectStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useProfile } from "@/components/profile-provider";
import { useProject } from "@/components/project-provider";
import { ProjectForm } from "@/components/project-form";
import { EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const STATUSES: { value: ProjectStatus; label: string; help: string }[] = [
  { value: "draft", label: "Draft", help: "Being set up. Only staff can open the annotation screen to test it." },
  { value: "active", label: "Active", help: "Visible to contributors, who can start annotating right away." },
  { value: "paused", label: "Paused", help: "Hidden from contributors. Existing judgments are kept." },
  { value: "completed", label: "Completed", help: "Closed for annotation. Stats, review and export remain available." },
];

export default function ProjectSettingsPage() {
  const router = useRouter();
  const { isAdmin, loading: profileLoading } = useProfile();
  const { projectId, project, loading, refresh } = useProject();
  const [statusSaving, setStatusSaving] = useState<ProjectStatus | null>(null);

  if (profileLoading || (loading && !project)) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <EmptyState
        icon={Lock}
        title="You need admin access"
        description="Only admins can change project settings."
      />
    );
  }

  if (!project) {
    return <EmptyState title="Project not found" description="It may have been deleted." />;
  }

  async function setStatus(status: ProjectStatus) {
    if (!project || status === project.status) return;
    setStatusSaving(status);
    try {
      await api.updateProject(projectId, { status });
      await refresh();
      toast.success(`Project is now ${status}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update status");
    } finally {
      setStatusSaving(null);
    }
  }

  const current = STATUSES.find((s) => s.value === project.status);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Status */}
      <Card className="gap-0 py-0">
        <CardHeader className="border-b py-4">
          <CardTitle className="text-sm font-semibold">Status</CardTitle>
          <CardDescription>Contributors only see Active projects.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 py-5">
          <div role="radiogroup" aria-label="Project status" className="inline-flex flex-wrap rounded-lg border bg-muted/40 p-0.5">
            {STATUSES.map((s) => {
              const active = s.value === project.status;
              return (
                <button
                  key={s.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={statusSaving !== null}
                  onClick={() => setStatus(s.value)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed",
                    active
                      ? "border bg-background font-medium text-foreground shadow-xs"
                      : "border border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {statusSaving === s.value && <Loader2 className="size-3.5 animate-spin" />}
                  {s.value === "active" && !statusSaving && <span className="size-1.5 rounded-full bg-emerald-500" />}
                  {s.label}
                </button>
              );
            })}
          </div>
          {current && <p className="text-sm text-muted-foreground">{current.help}</p>}
        </CardContent>
      </Card>

      <ProjectForm
        key={project.id}
        initial={project}
        submitLabel="Save changes"
        onSubmit={async (input) => {
          await api.updateProject(projectId, input);
          await refresh();
          toast.success("Settings saved");
        }}
      />

      <DangerZone
        name={project.name}
        onDelete={async () => {
          await api.deleteProject(projectId);
          toast.success("Project deleted");
          router.push("/app");
        }}
      />
    </div>
  );
}

function DangerZone({ name, onDelete }: { name: string; onDelete: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const matches = typed.trim() === name.trim();

  async function confirm() {
    if (!matches) return;
    setDeleting(true);
    try {
      await onDelete();
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete the project");
      setDeleting(false);
    }
  }

  return (
    <Card className="gap-0 py-0 ring-red-200">
      <CardHeader className="border-b border-red-100 py-4">
        <CardTitle className="text-sm font-semibold text-red-700">Danger zone</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
        <div>
          <p className="text-sm font-medium">Delete this project</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Permanently removes all items, judgments, LLM verdicts and reviews. This can&rsquo;t be undone.
          </p>
        </div>
        <AlertDialog
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) setTyped("");
          }}
        >
          <AlertDialogTrigger render={<Button variant="destructive" />}>Delete project</AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete project?</AlertDialogTitle>
              <AlertDialogDescription>
                All items, judgments and exports for <span className="font-medium text-foreground">{name}</span> will be
                permanently deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-name" className="text-xs font-normal text-muted-foreground">
                Type <span className="font-medium text-foreground">{name}</span> to confirm
              </Label>
              <Input
                id="confirm-name"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void confirm();
                  }
                }}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                className="bg-destructive text-white hover:bg-destructive/90"
                disabled={!matches || deleting}
                onClick={confirm}
              >
                {deleting && <Loader2 className="animate-spin" />}
                Delete project
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
