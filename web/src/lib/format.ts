import type { Preference, Sign } from "@/lib/types";

export const pct = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : `${(v * 100).toFixed(digits)}%`;

export const num = (v: number | null | undefined, digits = 2) =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : v.toFixed(digits);

export const int = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : new Intl.NumberFormat("en-US").format(v);

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.round(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export const sign = (v: number | null | undefined): Sign | null =>
  v === null || v === undefined ? null : v < 0 ? -1 : v > 0 ? 1 : 0;

/** Canonical preference label (A/B terms). */
export function preferenceLabel(p: number | null | undefined): string {
  if (p === null || p === undefined) return "—";
  const r = Math.round(p) as Preference;
  return { [-2]: "A much better", [-1]: "A better", 0: "Tie", 1: "B better", 2: "B much better" }[r] ?? "—";
}

export const signLabel = (s: number | null | undefined) =>
  s === null || s === undefined ? "—" : s < 0 ? "A" : s > 0 ? "B" : "Tie";

/** Agreement coefficient interpretation (Landis & Koch-ish, commonly used for alpha/kappa). */
export function agreementBand(v: number | null | undefined): { label: string; tone: "good" | "ok" | "bad" | "none" } {
  if (v === null || v === undefined) return { label: "Not enough data", tone: "none" };
  if (v >= 0.667) return { label: "Reliable", tone: "good" };
  if (v >= 0.4) return { label: "Tentative", tone: "ok" };
  return { label: "Unreliable", tone: "bad" };
}
