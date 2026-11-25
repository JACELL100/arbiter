import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm, AuthFormSkeleton } from "@/components/auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthFormSkeleton />}>
      <AuthForm mode="login" />
    </Suspense>
  );
}
