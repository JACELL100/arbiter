"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Calls `onChange` (debounced) whenever rows for this project change in `table`.
 * Tables published for Realtime: `judgments`, `jobs` (see supabase/schema.sql).
 * Use it as a refetch trigger: re-query the API rather than trusting the payload.
 */
export function useProjectRealtime(
  table: "judgments" | "jobs",
  projectId: string | undefined,
  onChange: () => void,
  debounceMs = 800,
) {
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!projectId) return;
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel(`${table}:${projectId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `project_id=eq.${projectId}` },
        () => {
          clearTimeout(timer);
          timer = setTimeout(() => cb.current(), debounceMs);
        },
      )
      .subscribe();
    return () => {
      clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [table, projectId, debounceMs]);
}
