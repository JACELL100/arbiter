"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Lock, Search, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { Role, UserRow } from "@/lib/types";
import { int, relativeTime } from "@/lib/format";
import { useProfile } from "@/components/profile-provider";
import { EmptyState, PageHeader, Pill } from "@/components/shared";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const ROLES: { value: Role; label: string; help: string }[] = [
  { value: "admin", label: "Admin", help: "Creates projects, uploads data, runs LLM jobs, manages people." },
  { value: "reviewer", label: "Reviewer", help: "Reads every project, its stats and contributors, and resolves the review queue." },
  { value: "contributor", label: "Contributor", help: "Annotates active projects. Sees only their own stats." },
];
const ROLE_ITEMS = Object.fromEntries(ROLES.map((r) => [r.value, r.label]));

function initials(u: UserRow) {
  const name = u.full_name || u.email?.split("@")[0] || "?";
  return name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function TeamPage() {
  const { profile, isAdmin, loading: profileLoading } = useProfile();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      setUsers(await api.users());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load users");
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const filtered = useMemo(() => {
    if (!users) return null;
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => (u.full_name ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q),
    );
  }, [users, query]);

  async function update(u: UserRow, body: { role?: Role; status?: "active" | "suspended" }) {
    setBusy(u.id);
    const prev = users;
    setUsers((us) => us?.map((x) => (x.id === u.id ? { ...x, ...body } : x)) ?? us);
    try {
      const saved = await api.updateUser(u.id, body);
      setUsers((us) => us?.map((x) => (x.id === u.id ? { ...x, ...saved } : x)) ?? us);
      const who = u.full_name || u.email || "User";
      toast.success(
        body.role
          ? `${who} is now ${ROLE_ITEMS[body.role].toLowerCase()}`
          : body.status === "suspended"
            ? `${who} suspended`
            : `${who} reactivated`,
      );
    } catch (e) {
      setUsers(prev);
      toast.error(e instanceof Error ? e.message : "Couldn't update user");
    } finally {
      setBusy(null);
    }
  }

  if (!profileLoading && !isAdmin) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-8">
        <EmptyState icon={Lock} title="You need admin access" description="Only admins can manage team members and roles." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <PageHeader
        title="Team"
        description="Everyone who has signed in to this workspace. New accounts start as contributors."
        className="mb-6"
      />

      <div className="mb-6 grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
        {ROLES.map((r) => (
          <div key={r.value} className="bg-background px-4 py-3">
            <div className="text-sm font-medium">{r.label}</div>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{r.help}</p>
          </div>
        ))}
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or email"
            className="pl-8"
            aria-label="Search users"
          />
        </div>
        {users && (
          <span className="tabular text-sm text-muted-foreground">
            {int(users.length)} {users.length === 1 ? "member" : "members"}
          </span>
        )}
      </div>

      {error && !users ? (
        <EmptyState title="Couldn't load the team" description={error} />
      ) : !filtered ? (
        <div className="overflow-hidden rounded-lg border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 border-b px-4 py-3 last:border-0">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-7 w-32" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Users} title={query ? "No matches" : "No users yet"} description={query ? "Try a different search." : undefined} />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4 text-xs font-medium text-muted-foreground">Member</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground">Role</TableHead>
                <TableHead className="text-xs font-medium text-muted-foreground">Status</TableHead>
                <TableHead className="text-right text-xs font-medium text-muted-foreground">Judgments</TableHead>
                <TableHead className="text-right text-xs font-medium text-muted-foreground">Last active</TableHead>
                <TableHead className="pr-4 text-right text-xs font-medium text-muted-foreground">Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((u) => {
                const isMe = u.id === profile?.id;
                const suspended = u.status === "suspended";
                return (
                  <TableRow key={u.id} className="hover:bg-muted/30">
                    <TableCell className="py-2.5 pl-4">
                      <div className="flex items-center gap-3">
                        {u.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={u.avatar_url} alt="" className="size-8 shrink-0 rounded-full border object-cover" />
                        ) : (
                          <span className="grid size-8 shrink-0 place-items-center rounded-full border bg-muted text-xs font-medium text-muted-foreground">
                            {initials(u)}
                          </span>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 font-medium">
                            <span className="truncate">{u.full_name || u.email?.split("@")[0] || "Unnamed"}</span>
                            {isMe && <Pill>You</Pill>}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">{u.email ?? "—"}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {isMe ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span className="inline-flex h-8 w-36 items-center rounded-lg border border-input bg-muted/40 px-2.5 text-sm text-muted-foreground" />
                            }
                          >
                            {ROLE_ITEMS[u.role]}
                          </TooltipTrigger>
                          <TooltipContent>You can&rsquo;t change your own role</TooltipContent>
                        </Tooltip>
                      ) : (
                        <Select
                          items={ROLE_ITEMS}
                          value={u.role}
                          disabled={busy === u.id}
                          onValueChange={(v) => v && v !== u.role && update(u, { role: v as Role })}
                        >
                          <SelectTrigger className="w-36" aria-label={`Role for ${u.email ?? "user"}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLES.map((r) => (
                              <SelectItem key={r.value} value={r.value}>
                                {r.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <Switch
                          checked={!suspended}
                          disabled={isMe || busy === u.id}
                          onCheckedChange={(checked) => update(u, { status: checked ? "active" : "suspended" })}
                          aria-label={suspended ? "Reactivate user" : "Suspend user"}
                        />
                        {suspended ? <Pill tone="bad">Suspended</Pill> : <span className="text-sm text-muted-foreground">Active</span>}
                      </div>
                    </TableCell>
                    <TableCell className="tabular text-right">{int(u.judgments_count)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{relativeTime(u.last_active_at)}</TableCell>
                    <TableCell className="pr-4 text-right text-muted-foreground">
                      {new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
