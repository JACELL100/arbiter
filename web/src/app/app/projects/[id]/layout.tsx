"use client";

import Link from "next/link";
import { use } from "react";
import { usePathname } from "next/navigation";
import { ArrowLeft, Play } from "lucide-react";
import { ProjectProvider, useProject } from "@/components/project-provider";
import { useProfile } from "@/components/profile-provider";
import { StatusBadge } from "@/components/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <ProjectProvider projectId={id}>
      <ProjectShell>{children}</ProjectShell>
    </ProjectProvider>
  );
}

function ProjectShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { projectId, project, loading, error } = useProject();
  const { isStaff, isAdmin } = useProfile();

  // The annotation screen is a focused, full-width workspace without project chrome.
  if (pathname.endsWith("/annotate")) return <>{children}</>;

  const base = `/app/projects/${projectId}`;
  const tabs = [
    { href: base, label: "Overview" },
    { href: `${base}/items`, label: "Items" },
    { href: `${base}/contributors`, label: "Contributors" },
    { href: `${base}/review`, label: "Review queue" },
    ...(isAdmin ? [{ href: `${base}/settings`, label: "Settings" }] : []),
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-background">
        <div className="mx-auto w-full max-w-7xl px-6 pt-5">
          <Link
            href="/app"
            className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Projects
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              {loading ? (
                <Skeleton className="h-7 w-56" />
              ) : (
                <>
                  <h1 className="truncate text-xl font-semibold tracking-tight">{project?.name ?? "Project"}</h1>
                  {project && <StatusBadge status={project.status} />}
                </>
              )}
            </div>
            {project && (project.status === "active" || isStaff) && (
              <Link href={`${base}/annotate`} className={cn(buttonVariants({ size: "default" }))}>
                <Play className="size-3.5" /> Start annotating
              </Link>
            )}
          </div>
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          {isStaff && (
            <nav className="-mb-px mt-4 flex gap-5 overflow-x-auto text-sm">
              {tabs.map((t) => {
                const active = t.href === base ? pathname === base : pathname.startsWith(t.href);
                return (
                  <Link
                    key={t.href}
                    href={t.href}
                    className={cn(
                      "whitespace-nowrap border-b-2 border-transparent pb-2.5 text-muted-foreground transition-colors hover:text-foreground",
                      active && "border-foreground font-medium text-foreground",
                    )}
                  >
                    {t.label}
                  </Link>
                );
              })}
            </nav>
          )}
          {!isStaff && <div className="h-4" />}
        </div>
      </header>
      <div className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">{children}</div>
    </div>
  );
}
