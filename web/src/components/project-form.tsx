"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { LlmModel, Project, ProjectInput, RubricCriterion } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* ------------------------------------------------------------------------------------------------ */
/* Models: shared loader + select (also used by the items page)                                     */
/* ------------------------------------------------------------------------------------------------ */

let modelsPromise: Promise<LlmModel[]> | null = null;

/** Loads `/llm/models` once per page session. `failed` => fall back to free-text input. */
export function useModels() {
  const [models, setModels] = useState<LlmModel[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!modelsPromise) {
      modelsPromise = api.models().catch((e) => {
        modelsPromise = null; // allow a retry on next mount
        throw e;
      });
    }
    modelsPromise.then(
      (m) => alive && setModels(m),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, []);

  return { models, failed, loading: !models && !failed };
}

const OWNER_LABEL: Record<string, string> = {
  openrouter: "OpenRouter",
  groq: "Groq",
  meta: "Meta",
  "meta-llama": "Meta",
  openai: "OpenAI",
  google: "Google",
  "mistral ai": "Mistral",
  mistralai: "Mistral",
  qwen: "Qwen",
  "alibaba cloud": "Alibaba",
  deepseek: "DeepSeek",
  "moonshot ai": "Moonshot",
};

function ownerLabel(owner: string) {
  const k = (owner || "other").toLowerCase();
  return OWNER_LABEL[k] ?? owner.charAt(0).toUpperCase() + owner.slice(1);
}

/** Pretty display for long provider-prefixed ids, e.g. `openrouter/meta-llama/x:free` -> `meta-llama/x:free`. */
function shortModel(id: string) {
  return id.startsWith("openrouter/") ? id.slice("openrouter/".length) : id;
}

export function ModelSelect({
  id,
  value,
  onChange,
  models,
  failed,
  placeholder = "Select a model",
  className,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  models: LlmModel[] | null;
  failed: boolean;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const groups = useMemo(() => {
    const list = [...(models ?? [])];
    if (value && !list.some((m) => m.id === value)) list.unshift({ id: value, owned_by: "current" });
    const map = new Map<string, LlmModel[]>();
    for (const m of list) {
      const key = m.owned_by === "current" ? "Current" : ownerLabel(m.owned_by);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.id.localeCompare(b.id));
    // Keep "Current" first, OpenRouter last, rest alphabetical.
    return [...map.entries()].sort(([a], [b]) => {
      const rank = (s: string) => (s === "Current" ? 0 : s === "OpenRouter" ? 2 : 1);
      return rank(a) - rank(b) || a.localeCompare(b);
    });
  }, [models, value]);

  if (failed) {
    return (
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. llama-3.3-70b-versatile"
        className={cn("font-mono", className)}
        disabled={disabled}
      />
    );
  }

  return (
    <Select value={value || null} onValueChange={(v) => v && onChange(String(v))} disabled={disabled || !models}>
      <SelectTrigger id={id} className={cn("w-full font-mono text-[13px]", className)}>
        <SelectValue placeholder={models ? placeholder : "Loading models…"}>
          {(v: string | null) => (v ? shortModel(v) : models ? placeholder : "Loading models…")}
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="max-h-80">
        {groups.map(([group, items], gi) => (
          <div key={group}>
            {gi > 0 && <SelectSeparator />}
            <SelectGroup>
              {groups.length > 1 && <SelectLabel>{group}</SelectLabel>}
              {items.map((m) => (
                <SelectItem key={m.id} value={m.id} className="font-mono text-[13px]">
                  {shortModel(m.id)}
                </SelectItem>
              ))}
            </SelectGroup>
          </div>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* Project form                                                                                     */
/* ------------------------------------------------------------------------------------------------ */

const DEFAULT_RUBRIC: RubricCriterion[] = [
  {
    key: "helpfulness",
    label: "Helpfulness",
    description: "Addresses what the user actually asked, completely and at the right level of detail.",
  },
  {
    key: "correctness",
    label: "Correctness",
    description: "Facts, reasoning, code and numbers are accurate. No invented details or unsupported claims.",
  },
  {
    key: "clarity",
    label: "Clarity",
    description: "Well organized, concise and easy to follow. Formatting helps rather than distracts.",
  },
  {
    key: "safety",
    label: "Safety",
    description: "Avoids harmful, biased or inappropriate content, and declines only when declining is warranted.",
  },
];

const DEFAULT_JUDGE = "llama-3.3-70b-versatile";

interface Row extends RubricCriterion {
  uid: string;
  keyTouched: boolean;
}

let uidSeq = 0;
const uid = () => `c${++uidSeq}`;

export function toKey(label: string) {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

const KEY_RE = /^[a-z0-9_][a-z0-9_-]{0,63}$/;

const numStr = (v: number | string | undefined | null, fallback: number) =>
  String(v === undefined || v === null || v === "" ? fallback : Number(v));
const pctStr = (v: number | string | undefined | null, fallback: number) =>
  String(Math.round(Number(v ?? fallback) * 1000) / 10);

type Errors = Partial<Record<string, string>>;

export function ProjectForm({
  initial,
  onSubmit,
  submitLabel,
}: {
  initial?: Project;
  /** Throw to signal failure; the form shows the error as a toast and stays editable. */
  onSubmit: (input: ProjectInput) => Promise<void>;
  submitLabel: string;
}) {
  const { models, failed } = useModels();

  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [rows, setRows] = useState<Row[]>(() =>
    (initial ? initial.rubric : DEFAULT_RUBRIC).map((c) => ({ ...c, uid: uid(), keyTouched: true })),
  );
  const [jpi, setJpi] = useState(numStr(initial?.judgments_per_item, 3));
  const [minReason, setMinReason] = useState(numStr(initial?.min_reason_chars, 20));
  const [minSeconds, setMinSeconds] = useState(numStr(initial?.min_seconds, 8));
  const [goldRate, setGoldRate] = useState(pctStr(initial?.gold_rate, 0.1));
  const [goldAcc, setGoldAcc] = useState(pctStr(initial?.gold_min_accuracy, 0.6));
  const [goldCount, setGoldCount] = useState(numStr(initial?.gold_min_count, 5));
  const [judgeModel, setJudgeModel] = useState(initial?.judge_model ?? DEFAULT_JUDGE);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  const duplicateKeys = useMemo(() => {
    const seen = new Map<string, number>();
    rows.forEach((r) => seen.set(r.key, (seen.get(r.key) ?? 0) + 1));
    return new Set([...seen.entries()].filter(([k, n]) => k && n > 1).map(([k]) => k));
  }, [rows]);

  function updateRow(id: string, patch: Partial<Row>) {
    setRows((rs) =>
      rs.map((r) => {
        if (r.uid !== id) return r;
        const next = { ...r, ...patch };
        if (patch.label !== undefined && !r.keyTouched) next.key = toKey(patch.label);
        return next;
      }),
    );
  }

  function move(index: number, dir: -1 | 1) {
    setRows((rs) => {
      const j = index + dir;
      if (j < 0 || j >= rs.length) return rs;
      const copy = [...rs];
      [copy[index], copy[j]] = [copy[j], copy[index]];
      return copy;
    });
  }

  function validate(): { input: ProjectInput | null; errors: Errors } {
    const e: Errors = {};
    if (!name.trim()) e.name = "Name is required.";
    if (rows.length === 0) e.rubric = "Add at least one criterion.";
    rows.forEach((r) => {
      if (!r.label.trim()) e[`label:${r.uid}`] = "Label is required.";
      if (!r.key) e[`key:${r.uid}`] = "Key is required.";
      else if (!KEY_RE.test(r.key)) e[`key:${r.uid}`] = "Use lowercase letters, digits, _ or -.";
      else if (duplicateKeys.has(r.key)) e[`key:${r.uid}`] = "Keys must be unique.";
    });

    const int = (raw: string, field: string, min: number, max: number) => {
      const n = Number(raw);
      if (raw.trim() === "" || !Number.isInteger(n) || n < min || n > max) {
        e[field] = `Whole number from ${min} to ${max}.`;
        return min;
      }
      return n;
    };
    const percent = (raw: string, field: string) => {
      const n = Number(raw);
      if (raw.trim() === "" || Number.isNaN(n) || n < 0 || n > 100) {
        e[field] = "Percentage from 0 to 100.";
        return 0;
      }
      return Math.round(n * 10) / 1000;
    };

    const input: ProjectInput = {
      name: name.trim(),
      description: description.trim(),
      instructions: instructions.trim(),
      rubric: rows.map((r) => ({ key: r.key.trim(), label: r.label.trim(), description: r.description.trim() })),
      judgments_per_item: int(jpi, "judgments_per_item", 1, 10),
      min_reason_chars: int(minReason, "min_reason_chars", 0, 5000),
      min_seconds: int(minSeconds, "min_seconds", 0, 3600),
      gold_rate: percent(goldRate, "gold_rate"),
      gold_min_accuracy: percent(goldAcc, "gold_min_accuracy"),
      gold_min_count: int(goldCount, "gold_min_count", 0, 1000),
      judge_model: judgeModel.trim() || DEFAULT_JUDGE,
    };
    return { input: Object.keys(e).length ? null : input, errors: e };
  }

  async function handleSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const { input, errors: e } = validate();
    setErrors(e);
    if (!input) {
      toast.error("Fix the highlighted fields before saving.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(input);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the project");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {/* Basics */}
      <Section title="Basics" description="How this project appears to your team.">
        <div className="grid gap-4">
          <Field label="Name" htmlFor="name" error={errors.name}>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Support assistant v3 vs v2"
              aria-invalid={!!errors.name}
              maxLength={200}
            />
          </Field>
          <Field label="Description" htmlFor="description" hint="Optional. One or two sentences about what you're comparing.">
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Pairwise comparison of the new fine-tune against production on real support tickets."
              rows={2}
              className="min-h-14"
            />
          </Field>
        </div>
      </Section>

      {/* Guidelines */}
      <Section
        title="Guidelines"
        description="Shown to contributors on every task. Be specific about what makes one response better than another."
      >
        <Field
          label="Instructions"
          htmlFor="instructions"
          hint="Plain text. Use blank lines between paragraphs and “- ” for bullet points. Gold explanations should point back to these rules."
        >
          <Textarea
            id="instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={8}
            className="min-h-40 font-mono text-[13px] leading-relaxed"
            placeholder={
              "Compare the two responses to the prompt.\n\n- Prefer the response that fully answers the question.\n- Penalize factual errors more than style issues.\n- Choose Tie only when neither response is meaningfully better."
            }
          />
        </Field>
      </Section>

      {/* Rubric */}
      <Section
        title="Rubric"
        description="Contributors pick Left, Tie or Right for each criterion, in addition to the overall preference."
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={rows.length >= 20}
            onClick={() => setRows((rs) => [...rs, { uid: uid(), key: "", label: "", description: "", keyTouched: false }])}
          >
            <Plus /> Add criterion
          </Button>
        }
      >
        {rows.length === 0 ? (
          <p className={cn("rounded-md border border-dashed px-4 py-6 text-center text-sm", errors.rubric ? "border-red-300 text-red-700" : "text-muted-foreground")}>
            {errors.rubric ?? "No criteria yet. Add at least one."}
          </p>
        ) : (
          <ol className="divide-y rounded-lg border">
            {rows.map((r, i) => {
              const keyErr = errors[`key:${r.uid}`] ?? (duplicateKeys.has(r.key) ? "Keys must be unique." : undefined);
              const labelErr = errors[`label:${r.uid}`];
              return (
                <li key={r.uid} className="flex gap-3 p-3">
                  <span className="tabular mt-2 w-5 shrink-0 text-right font-mono text-xs text-muted-foreground">{i + 1}</span>
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <div>
                      <Input
                        aria-label={`Criterion ${i + 1} label`}
                        value={r.label}
                        onChange={(e) => updateRow(r.uid, { label: e.target.value })}
                        placeholder="Label, e.g. Helpfulness"
                        aria-invalid={!!labelErr}
                        maxLength={120}
                      />
                      {labelErr && <p className="mt-1 text-xs text-red-600">{labelErr}</p>}
                    </div>
                    <div>
                      <Input
                        aria-label={`Criterion ${i + 1} key`}
                        value={r.key}
                        onChange={(e) => updateRow(r.uid, { key: e.target.value.toLowerCase(), keyTouched: true })}
                        placeholder="key"
                        className="font-mono text-[13px]"
                        aria-invalid={!!keyErr}
                        maxLength={64}
                      />
                      {keyErr && <p className="mt-1 text-xs text-red-600">{keyErr}</p>}
                    </div>
                    <Textarea
                      aria-label={`Criterion ${i + 1} description`}
                      value={r.description}
                      onChange={(e) => updateRow(r.uid, { description: e.target.value })}
                      placeholder="What should contributors look for?"
                      rows={2}
                      className="min-h-14 sm:col-span-2"
                    />
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Move up"
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Move down"
                      disabled={i === rows.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remove criterion"
                      className="text-muted-foreground hover:text-red-600"
                      onClick={() => setRows((rs) => rs.filter((x) => x.uid !== r.uid))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Section>

      {/* Quality controls */}
      <Section
        title="Quality controls"
        description="How many votes each item needs, and when a contributor is considered unreliable."
      >
        <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField
            id="judgments_per_item"
            label="Judgments per item"
            hint="Independent votes collected per item (1–10)."
            value={jpi}
            onChange={setJpi}
            min={1}
            max={10}
            error={errors.judgments_per_item}
          />
          <NumberField
            id="min_reason_chars"
            label="Minimum reason length"
            suffix="chars"
            hint="Contributors must explain their choice."
            value={minReason}
            onChange={setMinReason}
            min={0}
            error={errors.min_reason_chars}
          />
          <NumberField
            id="min_seconds"
            label="Too-fast threshold"
            suffix="sec"
            hint="Submissions faster than this are flagged."
            value={minSeconds}
            onChange={setMinSeconds}
            min={0}
            error={errors.min_seconds}
          />
          <NumberField
            id="gold_rate"
            label="Gold rate"
            suffix="%"
            hint="Share of served tasks drawn from gold items."
            value={goldRate}
            onChange={setGoldRate}
            min={0}
            max={100}
            step={1}
            error={errors.gold_rate}
          />
          <NumberField
            id="gold_min_accuracy"
            label="Minimum gold accuracy"
            suffix="%"
            hint="Contributors below this are paused automatically."
            value={goldAcc}
            onChange={setGoldAcc}
            min={0}
            max={100}
            step={1}
            error={errors.gold_min_accuracy}
          />
          <NumberField
            id="gold_min_count"
            label="Golds before pausing"
            hint="Accuracy is enforced after this many gold answers."
            value={goldCount}
            onChange={setGoldCount}
            min={0}
            error={errors.gold_min_count}
          />
        </div>
      </Section>

      {/* LLM judge */}
      <Section title="LLM judge" description="Default model used to pre-score items. You can override it per run.">
        <Field label="Judge model" htmlFor="judge_model" hint={failed ? "Couldn't load the model list; enter a model id." : undefined}>
          <ModelSelect
            id="judge_model"
            value={judgeModel}
            onChange={setJudgeModel}
            models={models}
            failed={failed}
            className="sm:max-w-md"
          />
        </Field>
      </Section>

      <div className="flex items-center justify-end gap-3 border-t pt-6">
        <Button type="submit" size="lg" className="px-4" disabled={submitting}>
          {submitting && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------------------------------------ */

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-wrap items-start justify-between gap-3 border-b py-4">
        <div className="min-w-0">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          {description && <CardDescription className="mt-1">{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent className="py-5">{children}</CardContent>
    </Card>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

function NumberField({
  id,
  label,
  hint,
  suffix,
  value,
  onChange,
  min,
  max,
  step = 1,
  error,
}: {
  id: string;
  label: string;
  hint?: string;
  suffix?: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  step?: number;
  error?: string;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error}>
      <div className="relative">
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          className={cn("tabular", suffix && "pr-12")}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </Field>
  );
}
