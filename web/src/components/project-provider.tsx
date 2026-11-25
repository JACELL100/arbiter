"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ProjectSummary } from "@/lib/types";

interface ProjectContextValue {
  projectId: string;
  project: ProjectSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ projectId, children }: { projectId: string; children: React.ReactNode }) {
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setProject(await api.project(projectId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load project");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <ProjectContext.Provider value={{ projectId, project, loading, error, refresh }}>{children}</ProjectContext.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used inside <ProjectProvider>");
  return ctx;
}
