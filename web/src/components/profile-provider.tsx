"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Profile } from "@/lib/types";

interface ProfileContextValue {
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  isAdmin: boolean;
  isStaff: boolean;
  refresh: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setProfile(await api.me());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your profile");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isAdmin = profile?.role === "admin";
  const isStaff = isAdmin || profile?.role === "reviewer";

  return (
    <ProfileContext.Provider value={{ profile, loading, error, isAdmin, isStaff, refresh }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used inside <ProfileProvider>");
  return ctx;
}
