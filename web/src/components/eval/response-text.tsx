import { Fragment } from "react";
import { cn } from "@/lib/utils";

type Segment = { kind: "text"; value: string } | { kind: "code"; value: string; lang: string };

/** Splits text on ``` fences. An unterminated fence runs to the end of the text. */
function parseFences(text: string): Segment[] {
  const out: Segment[] = [];
  const parts = text.split("```");
  parts.forEach((part, i) => {
    if (i % 2 === 0) {
      if (part.length) out.push({ kind: "text", value: part });
      return;
    }
    // First line of a fenced block may be a language tag ("python", "ts", ...).
    const nl = part.indexOf("\n");
    const head = nl === -1 ? "" : part.slice(0, nl).trim();
    const isLang = head.length > 0 && head.length <= 20 && /^[\w+#.-]+$/.test(head);
    const body = isLang ? part.slice(nl + 1) : part.replace(/^\n/, "");
    out.push({ kind: "code", value: body.replace(/\n$/, ""), lang: isLang ? head : "" });
  });
  return out;
}

/** Renders `inline code` spans inside a text segment. */
function InlineText({ value }: { value: string }) {
  const pieces = value.split(/(`[^`\n]+`)/g);
  return (
    <>
      {pieces.map((p, i) =>
        p.length > 2 && p.startsWith("`") && p.endsWith("`") ? (
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {p.slice(1, -1)}
          </code>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * Safe plain-text renderer for model output: preserves whitespace and renders fenced code
 * blocks in a mono box. No HTML is ever injected.
 */
export function ResponseText({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text || !text.trim()) {
    return <p className={cn("text-sm italic text-muted-foreground", className)}>No content</p>;
  }
  const segments = parseFences(text);
  return (
    <div className={cn("space-y-3 text-[14.5px] leading-relaxed text-foreground", className)}>
      {segments.map((s, i) =>
        s.kind === "text" ? (
          s.value.trim() ? (
            <div key={i} className="whitespace-pre-wrap break-words">
              <InlineText value={s.value.replace(/^\n+|\n+$/g, "")} />
            </div>
          ) : null
        ) : (
          <div key={i} className="overflow-hidden rounded-md border bg-muted/40">
            {s.lang && (
              <div className="border-b px-3 py-1 font-mono text-[11px] text-muted-foreground">{s.lang}</div>
            )}
            <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[12.5px] leading-relaxed">
              <code>{s.value}</code>
            </pre>
          </div>
        ),
      )}
    </div>
  );
}
