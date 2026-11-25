"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FolderKanban, LogOut, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/components/profile-provider";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ROLE_LABEL = { admin: "Admin", reviewer: "Reviewer", contributor: "Contributor" } as const;

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, isAdmin } = useProfile();

  const nav = [
    { href: "/app", label: "Projects", icon: FolderKanban, active: pathname === "/app" || pathname.startsWith("/app/projects") },
    ...(isAdmin ? [{ href: "/app/team", label: "Team", icon: Users, active: pathname.startsWith("/app/team") }] : []),
  ];

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const name = profile?.full_name || profile?.email?.split("@")[0] || "Account";
  const initials = name
    .split(/[\s._-]+/)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <aside className="flex h-14 w-full shrink-0 items-center gap-2 border-b bg-sidebar px-3 md:h-screen md:w-56 md:flex-col md:items-stretch md:border-r md:border-b-0 md:px-3 md:py-4">
      <Link href="/app" className="flex items-center px-2 md:mb-6">
        <Logo />
      </Link>

      <nav className="flex flex-1 items-center gap-1 md:flex-col md:items-stretch">
        {nav.map(({ href, label, icon: Icon, active }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              active && "bg-accent font-medium text-foreground",
            )}
          >
            <Icon className="size-4" strokeWidth={1.75} />
            {label}
          </Link>
        ))}
      </nav>

      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
          {profile?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatar_url} alt="" className="size-7 rounded-full border" referrerPolicy="no-referrer" />
          ) : (
            <span className="grid size-7 place-items-center rounded-full border bg-muted text-[11px] font-medium">{initials}</span>
          )}
          <span className="hidden min-w-0 flex-1 md:block">
            <span className="block truncate text-sm font-medium leading-tight">{name}</span>
            <span className="block text-xs text-muted-foreground">{profile ? ROLE_LABEL[profile.role] : "…"}</span>
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="truncate text-sm font-medium">{name}</div>
            <div className="truncate text-xs text-muted-foreground">{profile?.email}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={signOut}>
            <LogOut className="size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </aside>
  );
}
