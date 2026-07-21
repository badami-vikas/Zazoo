import { createClient } from '@supabase/supabase-js';

const configuredUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const configuredKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const SUPABASE_CONFIGURED = Boolean(configuredUrl && configuredKey);
export const SUPABASE_CONFIGURATION_ERROR =
  Boolean(configuredUrl) !== Boolean(configuredKey)
    ? "VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be configured together"
    : null;

// Local/desktop mode still needs a client-shaped object for shared code, but it
// must never fall back to a live project. Loopback remains unreachable unless a
// developer intentionally runs a local Supabase instance.
export const supabase = createClient(
  SUPABASE_CONFIGURED ? configuredUrl! : "http://127.0.0.1:54321",
  SUPABASE_CONFIGURED ? configuredKey! : "bridge-unconfigured-publishable-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
