import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

let cachedClient: SupabaseClient | null | undefined;

export function getSupabaseServerClient(): SupabaseClient | null {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  if (!env.supabaseUrl) {
    cachedClient = null;
    return cachedClient;
  }

  const key =
    env.supabaseServiceRoleKey ||
    (process.env.NODE_ENV !== "production" ? env.supabasePublishableKey : "");

  if (!key) {
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = createClient(env.supabaseUrl, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return cachedClient;
}
