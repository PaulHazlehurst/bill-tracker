"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// One place that knows who you are.
//
// Before this existed, rendering the dashboard made SEVEN separate database
// round-trips just to answer "who is this and what team are they on": four
// independent supabase.auth.getUser() calls and three independent `profiles`
// selects, fired by the Sidebar, the dashboard, TopicsHero, ActivityMini and
// TrendingBills - each component politely fetching its own copy of identical
// data, moments apart. On Supabase's free tier that is a large share of the
// slowness, and it multiplies with every extra person using the app at once.
//
// Now it's fetched ONCE per session, here, and shared. Components call
// useSession() instead of querying. The profile and organization come back in
// a single joined query, so it's one round-trip total.
//
// Mounted in app/(app)/layout.tsx, which wraps every signed-in page, so this
// survives client-side navigation between pages without refetching.

export type SessionProfile = {
  organization_id: string | null;
  phone: string | null;
  email_notifications_enabled: boolean;
  topics: string[] | null;
};

export type SessionOrg = {
  id: string;
  name: string | null;
  logo_url: string | null;
  topics: string[] | null;
};

type SessionValue = {
  userId: string | null;
  email: string | null;
  profile: SessionProfile | null;
  org: SessionOrg | null;
  /** True until the first load resolves. Components should render skeletons, not empty states, while this is true. */
  loading: boolean;
  /** The topics that actually apply to this account: the org's if on a team, otherwise the user's own. */
  effectiveTopics: string[];
  /** Re-read the profile/org after something changes it (e.g. joining a team, editing topics). */
  refresh: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<SessionProfile | null>(null);
  const [org, setOrg] = useState<SessionOrg | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setUserId(null);
      setEmail(null);
      setProfile(null);
      setOrg(null);
      setLoading(false);
      return;
    }
    setUserId(user.id);
    setEmail(user.email ?? null);

    // One joined query for the profile AND its organization, instead of the
    // several separate profile selects this replaces.
    const { data } = await supabase
      .from("profiles")
      .select("organization_id, phone, email_notifications_enabled, topics, organizations(id, name, logo_url, topics)")
      .eq("id", user.id)
      .single();

    if (data) {
      setProfile({
        organization_id: data.organization_id ?? null,
        phone: data.phone ?? null,
        email_notifications_enabled: !!data.email_notifications_enabled,
        topics: (data.topics as string[] | null) ?? null,
      });
      // PostgREST returns an embedded row as either an object or a 1-element
      // array depending on how it infers the relationship - handle both.
      const o = Array.isArray(data.organizations) ? data.organizations[0] : data.organizations;
      setOrg((o as any) ?? null);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const effectiveTopics = (profile?.organization_id ? org?.topics : profile?.topics) ?? [];

  return (
    <SessionContext.Provider
      value={{ userId, email, profile, org, loading, effectiveTopics, refresh: load }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
