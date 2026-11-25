"use client";

import { createClient } from "@/lib/supabase/client";
import type {
  ContributorRow,
  ItemDetail,
  ItemRow,
  Job,
  LlmModel,
  MyStats,
  NextTaskResponse,
  Paged,
  Profile,
  Project,
  ProjectInput,
  ProjectStats,
  ProjectSummary,
  Review,
  ReviewQueueRow,
  Role,
  SubmitBody,
  SubmitResponse,
  UploadResult,
  UserRow,
} from "@/lib/types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const BASE = `${API_URL}/api/v1`;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function messageFrom(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d) && d[0]?.msg) return String(d[0].msg);
  }
  return fallback;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(await authHeader()), ...(init.headers as Record<string, string>) };
  if (init.body && !(init.body instanceof FormData)) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "Can't reach the API server. Is it running?");
  }
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, messageFrom(body, `Request failed (${res.status})`));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (body: unknown) => JSON.stringify(body);
const qs = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
};

export const api = {
  // me / users
  me: () => request<Profile>("/me"),
  updateMe: (body: { full_name?: string }) => request<Profile>("/me", { method: "PATCH", body: json(body) }),
  myStats: () => request<MyStats>("/me/stats"),
  users: () => request<UserRow[]>("/users"),
  updateUser: (id: string, body: { role?: Role; status?: "active" | "suspended" }) =>
    request<Profile>(`/users/${id}`, { method: "PATCH", body: json(body) }),

  // projects
  projects: () => request<ProjectSummary[]>("/projects"),
  project: (id: string) => request<ProjectSummary>(`/projects/${id}`),
  createProject: (body: ProjectInput) => request<Project>("/projects", { method: "POST", body: json(body) }),
  updateProject: (id: string, body: Partial<ProjectInput> & { status?: Project["status"] }) =>
    request<Project>(`/projects/${id}`, { method: "PATCH", body: json(body) }),
  deleteProject: (id: string) => request<{ ok: true }>(`/projects/${id}`, { method: "DELETE" }),

  // items
  items: (id: string, p: { limit?: number; offset?: number; filter?: string; q?: string } = {}) =>
    request<Paged<ItemRow>>(`/projects/${id}/items${qs(p)}`),
  item: (id: string, itemId: string) => request<ItemDetail>(`/projects/${id}/items/${itemId}`),
  createItem: (id: string, body: Record<string, unknown>) =>
    request<ItemRow>(`/projects/${id}/items`, { method: "POST", body: json(body) }),
  deleteItem: (id: string, itemId: string) =>
    request<{ ok: true }>(`/projects/${id}/items/${itemId}`, { method: "DELETE" }),
  uploadItems: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<UploadResult>(`/projects/${id}/items/upload`, { method: "POST", body: fd });
  },
  reviewItem: (id: string, itemId: string, body: { final_preference: number; note: string }) =>
    request<Review>(`/projects/${id}/items/${itemId}/review`, { method: "POST", body: json(body) }),
  reviewQueue: (id: string, p: { limit?: number; offset?: number } = {}) =>
    request<Paged<ReviewQueueRow>>(`/projects/${id}/review-queue${qs(p)}`),

  // llm + jobs
  models: () => request<LlmModel[]>("/llm/models"),
  generate: (
    id: string,
    body: { model_a: string; model_b: string; overwrite?: boolean; system_prompt?: string; max_tokens?: number },
  ) => request<Job>(`/projects/${id}/generate`, { method: "POST", body: json(body) }),
  judge: (id: string, body: { model?: string; both_orders?: boolean; overwrite?: boolean }) =>
    request<Job>(`/projects/${id}/judge`, { method: "POST", body: json(body) }),
  jobs: (id: string) => request<Job[]>(`/projects/${id}/jobs`),
  cancelJob: (jobId: string) => request<Job>(`/jobs/${jobId}/cancel`, { method: "POST" }),

  // annotation
  next: (id: string) => request<NextTaskResponse>(`/projects/${id}/next`, { method: "POST" }),
  submit: (assignmentId: string, body: SubmitBody) =>
    request<SubmitResponse>(`/assignments/${assignmentId}/submit`, { method: "POST", body: json(body) }),
  skip: (assignmentId: string, reason?: string) =>
    request<{ ok: true }>(`/assignments/${assignmentId}/skip`, { method: "POST", body: json({ reason }) }),

  // contributors + stats
  contributors: (id: string) => request<ContributorRow[]>(`/projects/${id}/contributors`),
  updateContributor: (id: string, userId: string, body: { status: "active" | "paused"; override?: boolean }) =>
    request<ContributorRow>(`/projects/${id}/contributors/${userId}`, { method: "PATCH", body: json(body) }),
  stats: (id: string) => request<ProjectStats>(`/projects/${id}/stats`),

  /** Downloads an NDJSON export via an authenticated fetch and triggers a browser save. */
  exportFile: async (id: string, format: "dpo" | "raw" | "items") => {
    const res = await fetch(`${BASE}/projects/${id}/export?format=${format}`, { headers: await authHeader() });
    if (!res.ok) throw new ApiError(res.status, `Export failed (${res.status})`);
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") ?? "";
    const name = /filename="?([^"]+)"?/.exec(cd)?.[1] ?? `export-${format}.jsonl`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  },
};
