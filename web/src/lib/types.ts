// Mirrors SPEC.md. Keep in sync with the FastAPI backend.

export type Role = "admin" | "reviewer" | "contributor";
export type ProjectStatus = "draft" | "active" | "paused" | "completed";

/** -2 A much better, -1 A better, 0 tie, 1 B better, 2 B much better (canonical A/B terms). */
export type Preference = -2 | -1 | 0 | 1 | 2;
/** -1 A better, 0 tie, 1 B better */
export type Sign = -1 | 0 | 1;

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: Role;
  status: "active" | "suspended";
  created_at: string;
}

export interface UserRow extends Profile {
  judgments_count: number;
  last_active_at: string | null;
}

export interface RubricCriterion {
  key: string;
  label: string;
  description: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  instructions: string;
  rubric: RubricCriterion[];
  status: ProjectStatus;
  judgments_per_item: number;
  min_reason_chars: number;
  min_seconds: number;
  gold_rate: number;
  gold_min_accuracy: number;
  gold_min_count: number;
  judge_model: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ProjectInput = Omit<Project, "id" | "created_by" | "created_at" | "updated_at" | "status">;

export interface ProjectSummary extends Project {
  items_count: number;
  gold_count: number;
  ready_items_count: number;
  judgments_count: number;
  target_judgments: number;
  progress: number;
  my_judgments_count: number;
  contributors_count: number;
}

export interface Item {
  id: string;
  project_id: string;
  prompt: string;
  response_a: string | null;
  response_b: string | null;
  model_a: string | null;
  model_b: string | null;
  is_gold: boolean;
  gold_preference: Sign | null;
  gold_explanation: string | null;
  metadata: Record<string, unknown>;
  judgments_count: number;
  created_at: string;
}

export interface ItemRow extends Item {
  human_votes: { a: number; tie: number; b: number };
  human_mean: number | null;
  llm_preference: number | null;
  llm_consistent: boolean | null;
  review_preference: number | null;
  disputed: boolean;
}

export interface Judgment {
  id: string;
  assignment_id: string;
  project_id: string;
  item_id: string;
  user_id: string;
  preference: Preference;
  criteria: Record<string, Sign>;
  reason: string;
  duration_ms: number;
  swapped: boolean;
  too_fast: boolean;
  is_gold: boolean;
  gold_correct: boolean | null;
  flagged: boolean;
  flag_note: string | null;
  created_at: string;
}

export interface LlmJudgment {
  id: string;
  item_id: string;
  model: string;
  preference: Preference;
  criteria: Record<string, Sign>;
  rationale: string;
  consistent: boolean;
  created_at: string;
}

export interface Review {
  id: string;
  item_id: string;
  reviewer_id: string | null;
  final_preference: Preference;
  note: string;
  created_at: string;
}

export interface ItemDetail extends ItemRow {
  judgments: (Judgment & { user_email: string | null; user_name: string | null })[];
  llm_judgment: LlmJudgment | null;
  review: Review | null;
}

export type DisputeReason = "human_split" | "llm_disagrees" | "flagged";
export interface ReviewQueueRow extends ItemRow {
  reasons: DisputeReason[];
}

export interface Job {
  id: string;
  project_id: string;
  kind: "generate" | "judge";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  total: number;
  done: number;
  failed: number;
  error: string | null;
  params: Record<string, unknown>;
  created_at: string;
  finished_at: string | null;
}

export interface LlmModel {
  id: string;
  owned_by: string;
}

export interface Task {
  assignment_id: string;
  item_id: string;
  project: Pick<Project, "id" | "name" | "instructions" | "rubric" | "min_reason_chars" | "min_seconds">;
  prompt: string;
  left: { text: string };
  right: { text: string };
  assigned_at: string;
  expires_at: string;
  progress: { my_judgments: number; remaining_items: number };
}

export type NextTaskResponse = Task | { done: true };

export interface SubmitBody {
  /** SCREEN terms: -2 left much better ... 2 right much better */
  choice: Preference;
  /** SCREEN terms: -1 left, 0 tie, 1 right */
  criteria: Record<string, Sign>;
  reason: string;
  duration_ms: number;
  flagged?: boolean;
  flag_note?: string;
}

export interface SubmitResponse {
  ok: true;
  gold_feedback: null | { correct: boolean; expected: Sign; explanation: string | null };
  paused: boolean;
}

export interface MyStats {
  total_judgments: number;
  projects: {
    project_id: string;
    project_name: string;
    judgments: number;
    gold_accuracy: number | null;
    golds: number;
    too_fast_rate: number;
    agreement_rate: number | null;
    median_seconds: number | null;
    status: "active" | "paused";
  }[];
}

export interface ContributorRow {
  user_id: string;
  email: string | null;
  full_name: string | null;
  judgments: number;
  golds: number;
  gold_accuracy: number | null;
  too_fast_rate: number;
  median_seconds: number | null;
  agreement_rate: number | null;
  left_bias: number | null;
  status: "active" | "paused";
  paused_reason: string | null;
  override: boolean;
  last_active_at: string | null;
}

export interface ModelStat {
  model: string;
  wins: number;
  losses: number;
  ties: number;
  comparisons: number;
  win_rate: number;
  win_rate_ci: [number, number];
  bt_score: number;
  bt_ci: [number, number];
}

export interface ProjectStats {
  totals: {
    items: number;
    gold_items: number;
    ready_items: number;
    judgments: number;
    contributors: number;
    target_judgments: number;
    progress: number;
    disputed: number;
    reviewed: number;
    llm_judged: number;
  };
  models: ModelStat[];
  agreement: {
    krippendorff_alpha: number | null;
    fleiss_kappa: number | null;
    pairwise_agreement: number | null;
    llm_human_agreement: number | null;
    llm_human_kappa: number | null;
    llm_consistency: number | null;
  };
  position_bias: { left_rate: number | null; n: number };
  quality: {
    too_fast_rate: number;
    gold_accuracy: number | null;
    flagged_count: number;
    paused_contributors: number;
  };
  criteria: { key: string; label: string; models: { model: string; win_rate: number; n: number }[] }[];
  timeline: { bucket: string; judgments: number }[];
  preference_histogram: { value: Preference; count: number }[];
}

export interface UploadResult {
  inserted: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

export interface Paged<T> {
  items: T[];
  total: number;
}
