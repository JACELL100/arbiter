"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useProfile } from "@/components/profile-provider";
import { ProjectForm } from "@/components/project-form";
import { EmptyState, PageHeader } from "@/components/shared";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function NewProjectPage() {
  const router = useRouter();
  const { loading, isAdmin } = useProfile();

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Link
        href="/app"
        className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Projects
      </Link>
      <PageHeader
        title="New project"
        description="Set up the guidelines, rubric and quality controls. You can change all of this later."
        className="mb-6"
      />

      {loading ? (
        <div className="space-y-6">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      ) : !isAdmin ? (
        <EmptyState
          icon={Lock}
          title="You need admin access"
          description="Only admins can create projects. Ask an admin to change your role."
          action={
            <Link href="/app" className={buttonVariants({ variant: "outline" })}>
              Back to projects
            </Link>
          }
        />
      ) : (
        <ProjectForm
          submitLabel="Create project"
          onSubmit={async (input) => {
            const project = await api.createProject(input);
            toast.success("Project created", { description: "Next, add items to evaluate." });
            router.push(`/app/projects/${project.id}/items`);
          }}
        />
      )}
    </div>
  );
}
