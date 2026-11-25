"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/logo";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

type Mode = "login" | "signup";

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/app";
  return raw;
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3.01c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.11A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.38-2.28V6.61H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.39l4.01-3.11z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.61l4.01 3.11C6.22 6.88 8.87 4.77 12 4.77z"
      />
    </svg>
  );
}

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 px-4 py-12">
      <Link href="/" className="mb-8" aria-label="Arbiter home">
        <Logo />
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

export function AuthFormSkeleton() {
  return (
    <AuthShell>
      <div className="space-y-4 rounded-lg border bg-background p-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    </AuthShell>
  );
}

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const isSignup = mode === "signup";

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("error") === "auth_callback" ? "We couldn't complete sign-in. The link may have expired; try again." : null,
  );
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);

  const callbackUrl = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function onGoogle() {
    setError(null);
    setGoogleLoading(true);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl() },
    });
    if (error) {
      setError(error.message);
      setGoogleLoading(false);
    }
    // On success the browser navigates away; keep the spinner.
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    const supabase = createClient();
    try {
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { full_name: fullName.trim() },
            emailRedirectTo: callbackUrl(),
          },
        });
        if (error) throw error;
        if (!data.session) {
          setConfirmEmail(email.trim());
          return;
        }
        router.replace("/app");
        router.refresh();
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        router.replace(next);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  if (confirmEmail) {
    return (
      <AuthShell>
        <div className="rounded-lg border bg-background p-6 text-center">
          <div className="mx-auto mb-4 grid size-10 place-items-center rounded-md border bg-muted/50">
            <MailCheck className="size-5 text-muted-foreground" strokeWidth={1.75} />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Check your email to confirm your account</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We sent a confirmation link to <span className="font-medium text-foreground">{confirmEmail}</span>. Open it
            on this device to finish signing up.
          </p>
          <Link href="/login" className={buttonVariants({ variant: "outline", className: "mt-6 w-full" })}>
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  const busy = loading || googleLoading;
  const nextQuery = next !== "/app" ? `?next=${encodeURIComponent(next)}` : "";

  return (
    <AuthShell>
      <div className="rounded-lg border bg-background p-6">
        <h1 className="text-lg font-semibold tracking-tight">{isSignup ? "Create your account" : "Sign in to Arbiter"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isSignup ? "Start running pairwise evaluations." : "Welcome back. Pick up where you left off."}
        </p>

        <Button type="button" variant="outline" size="lg" className="mt-6 w-full" onClick={onGoogle} disabled={busy}>
          {googleLoading ? <Loader2 className="animate-spin" /> : <GoogleIcon />}
          Continue with Google
        </Button>

        <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {isSignup && (
            <div className="space-y-1.5">
              <Label htmlFor="full_name">Full name</Label>
              <Input
                id="full_name"
                autoComplete="name"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Ada Lovelace"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@lab.ai"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              {isSignup && <span className="text-xs text-muted-foreground">At least 8 characters</span>}
            </div>
            <Input
              id="password"
              type="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              required
              minLength={isSignup ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {loading && <Loader2 className="animate-spin" />}
            {isSignup ? "Create account" : "Sign in"}
          </Button>
        </form>
      </div>

      <p className="mt-4 text-center text-sm text-muted-foreground">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link href={`/login${nextQuery}`} className="font-medium text-foreground underline-offset-4 hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New to Arbiter?{" "}
            <Link href={`/signup${nextQuery}`} className="font-medium text-foreground underline-offset-4 hover:underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </AuthShell>
  );
}
