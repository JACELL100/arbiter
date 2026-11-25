import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm, AuthFormSkeleton } from "@/components/auth-form";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <Suspense fallback={<AuthFormSkeleton />}>
      <AuthForm mode="signup" />
    </Suspense>
  );
}
