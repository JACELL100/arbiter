import Link from "next/link";
import { ArrowRight, Download, Gavel, ShieldCheck, Sigma } from "lucide-react";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FEATURES = [
  {
    icon: ShieldCheck,
    title: "Gold checks and auto-pause",
    body: "Seed known-answer items into the queue. Contributors see the expected answer after each gold, and anyone who drops below your accuracy threshold is paused automatically.",
  },
  {
    icon: Sigma,
    title: "Agreement you can report",
    body: "Krippendorff's α on the full preference scale and Fleiss' κ on A / tie / B, plus pairwise agreement, position bias, and too-fast rates per contributor.",
  },
  {
    icon: Gavel,
    title: "LLM judge with a dispute queue",
    body: "Pre-score every pair with an LLM judge asked in both orders to catch position bias. Split votes and human–judge disagreements land in a reviewer queue.",
  },
  {
    icon: Download,
    title: "DPO and RLHF export",
    body: "Download chosen / rejected pairs as JSONL with margin, vote counts and provenance, or the raw judgments in canonical A/B terms for your own analysis.",
  },
];

const STEPS = [
  { n: "01", title: "Upload", body: "Import prompts and response pairs from CSV or JSONL, or generate responses from two models." },
  { n: "02", title: "Annotate", body: "Contributors compare responses blind, in random order, on a 5-point scale with a rubric and a reason." },
  { n: "03", title: "Review", body: "Track agreement live, inspect disputed items, and record a final reviewer decision where humans split." },
  { n: "04", title: "Export", body: "Ship preference pairs straight into DPO or reward-model training as JSONL." },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/" aria-label="Arbiter home">
            <Logo />
          </Link>
          <nav className="flex items-center gap-1.5">
            <Link href="/login" className={buttonVariants({ variant: "ghost" })}>
              Sign in
            </Link>
            <Link href="/signup" className={buttonVariants()}>
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-6 pt-16 pb-12 md:pt-24">
          <div className="max-w-2xl">
            <p className="mb-4 inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Pairwise evaluation workbench
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">
              Human evaluation for model outputs
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
              Arbiter runs side-by-side preference studies on your model responses, with gold checks, agreement
              metrics, an LLM judge and a reviewer queue. Every judgment ends up as clean, training-ready data.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/signup" className={buttonVariants({ size: "lg", className: "px-4" })}>
                Get started <ArrowRight data-icon="inline-end" />
              </Link>
              <Link href="#how-it-works" className={buttonVariants({ size: "lg", variant: "outline", className: "px-4" })}>
                How it works
              </Link>
            </div>
          </div>
        </section>

        {/* Product mock */}
        <section className="mx-auto max-w-6xl px-6 pb-20" aria-label="Annotation screen preview">
          <ComparisonMock />
        </section>

        {/* Features */}
        <section className="border-t bg-muted/30">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="max-w-xl">
              <h2 className="text-2xl font-semibold tracking-tight">Quality control built in</h2>
              <p className="mt-2 text-muted-foreground">
                The parts of a human-eval pipeline that usually live in spreadsheets and one-off scripts.
              </p>
            </div>
            <div className="mt-10 grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <div key={title} className="bg-background p-6">
                  <div className="grid size-8 place-items-center rounded-md border bg-muted/50">
                    <Icon className="size-4 text-foreground" strokeWidth={1.75} />
                  </div>
                  <h3 className="mt-4 text-sm font-semibold">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-14 border-t">
          <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
              <p className="mt-2 text-muted-foreground">From raw prompts to preference pairs in four steps.</p>
              <ol className="mt-8 space-y-6">
                {STEPS.map((s) => (
                  <li key={s.n} className="flex gap-4">
                    <span className="tabular w-6 shrink-0 pt-0.5 font-mono text-xs text-muted-foreground">{s.n}</span>
                    <div>
                      <h3 className="text-sm font-semibold">{s.title}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="min-w-0 self-center">
              <div className="overflow-hidden rounded-lg border">
                <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2">
                  <span className="font-mono text-xs text-muted-foreground">export-dpo.jsonl</span>
                  <span className="text-xs text-muted-foreground">1 line per decided item</span>
                </div>
                <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-foreground">
                  {`{
  "prompt": "Explain the difference between a mutex and a semaphore.",
  "chosen": "A mutex is a lock with an owner...",
  "rejected": "Both are used for synchronization...",
  "chosen_model": "llama-3.3-70b-versatile",
  "rejected_model": "llama-3.1-8b-instant",
  "margin": 1.33,
  "votes": 3,
  "agreement": 1.0,
  "source": "human_majority",
  "item_id": "4f1c9e2a-…"
}`}
                </pre>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="border-t">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-6 py-16 md:flex-row md:items-center">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Start your first evaluation</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The first account becomes the workspace admin. Invite reviewers and contributors from there.
              </p>
            </div>
            <div className="flex gap-2">
              <Link href="/signup" className={buttonVariants({ size: "lg", className: "px-4" })}>
                Create an account
              </Link>
              <Link href="/login" className={buttonVariants({ size: "lg", variant: "outline", className: "px-4" })}>
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Logo className="text-foreground" />
            <span className="hidden sm:inline">Pairwise human evaluation for AI models.</span>
          </div>
          <nav className="flex gap-4">
            <Link href="/login" className="hover:text-foreground">
              Sign in
            </Link>
            <Link href="/signup" className="hover:text-foreground">
              Get started
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------ */
/* Static, faithful mock of the annotation screen. Pure markup; no interactivity.                   */
/* ------------------------------------------------------------------------------------------------ */

const SCALE = [
  { label: "Left much better", key: "1" },
  { label: "Left better", key: "2" },
  { label: "Tie", key: "3" },
  { label: "Right better", key: "4" },
  { label: "Right much better", key: "5" },
];

const CRITERIA = [
  { label: "Helpfulness", pick: 2 },
  { label: "Correctness", pick: 1 },
  { label: "Clarity", pick: 2 },
  { label: "Safety", pick: 1 },
];

function ComparisonMock() {
  return (
    <div className="overflow-hidden rounded-xl border bg-background shadow-xs" aria-hidden>
      {/* Window bar */}
      <div className="flex items-center justify-between gap-4 border-b bg-muted/40 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <span className="truncate font-medium">Support assistant · v3 vs v2</span>
          <span className="hidden h-5 items-center rounded-md border border-emerald-200 bg-emerald-50 px-1.5 text-xs font-medium text-emerald-700 sm:inline-flex">
            Active
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-4 text-xs text-muted-foreground">
          <span className="tabular hidden sm:inline">Task 37 · 163 remaining</span>
          <span className="tabular font-mono">00:42</span>
        </div>
      </div>

      <div className="space-y-4 p-4 md:p-6">
        {/* Prompt */}
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Prompt</div>
          <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm leading-relaxed">
            A customer writes: &ldquo;My order arrived with a cracked screen. It&rsquo;s been 34 days, so I know I&rsquo;m
            past the 30-day window, but I only opened the box this weekend.&rdquo; Draft a reply.
          </div>
        </div>

        {/* Responses */}
        <div className="grid gap-4 md:grid-cols-2">
          <MockResponse side="Left">
            <p>Hi there, thanks for reaching out.</p>
            <p>
              Unfortunately our return policy only covers 30 days from delivery, so we aren&rsquo;t able to process a
              refund for this order. You may want to check whether the manufacturer&rsquo;s warranty applies.
            </p>
            <p>Best regards, Support</p>
          </MockResponse>
          <MockResponse side="Right" selected>
            <p>I&rsquo;m sorry your screen arrived cracked. That&rsquo;s not the experience we want for you.</p>
            <p>
              Because the damage happened in transit, it&rsquo;s covered by our shipping guarantee rather than the
              30-day return window. Reply with a photo of the screen and the box, and I&rsquo;ll send a free
              replacement or a full refund, whichever you prefer.
            </p>
          </MockResponse>
        </div>

        {/* Scale */}
        <div className="rounded-lg border p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium">Which response is better overall?</span>
            <span className="hidden text-xs text-muted-foreground sm:inline">Press a number key</span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {SCALE.map((s, i) => {
              const active = i === 3;
              return (
                <div
                  key={s.key}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1.5 rounded-md border px-1 py-2.5 text-center text-xs font-medium",
                    active ? "border-foreground bg-foreground text-background" : "bg-background text-foreground",
                  )}
                >
                  <kbd className={cn(active && "border-background/30 bg-background/15 text-background")}>{s.key}</kbd>
                  <span className="hidden leading-tight sm:block">{s.label}</span>
                </div>
              );
            })}
          </div>

          <div className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {CRITERIA.map((c) => (
              <div key={c.label} className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">{c.label}</span>
                <div className="inline-flex rounded-md border p-0.5 text-xs">
                  {["Left", "Tie", "Right"].map((o, i) => (
                    <span
                      key={o}
                      className={cn(
                        "rounded-[5px] px-2 py-0.5",
                        i === c.pick ? "bg-muted font-medium text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {o}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-md border px-3 py-2 text-sm text-muted-foreground">
            Right correctly treats transit damage as separate from the return window and offers a concrete next step.
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <kbd>S</kbd> Skip
              </span>
              <span className="inline-flex items-center gap-1.5">
                <kbd>F</kbd> Flag
              </span>
            </div>
            <span className="inline-flex h-8 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">
              Submit <kbd className="border-primary-foreground/25 bg-primary-foreground/10 text-primary-foreground">Enter</kbd>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MockResponse({
  side,
  selected,
  children,
}: {
  side: string;
  selected?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col rounded-lg border", selected && "border-foreground/40")}>
      <div className="flex items-center justify-between border-b px-4 py-2">
        <span className="text-xs font-medium">{side}</span>
        <span className="font-mono text-[11px] text-muted-foreground">model hidden</span>
      </div>
      <div className="space-y-2.5 px-4 py-3 text-sm leading-relaxed">{children}</div>
    </div>
  );
}
