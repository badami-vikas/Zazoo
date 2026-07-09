import { createClient } from '@supabase/supabase-js';

// Publishable (anon) key — safe to ship to the client. Points at the live Bridge AI project.
// Override via .env (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY).
const url = import.meta.env.VITE_SUPABASE_URL || 'https://emtbimowmqqhixqlxhzb.supabase.co';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_rpk3zrm13cWu-PqqQMOvtg_I0Dk1FsW';

export const SUPABASE_CONFIGURED = Boolean(url && key);

// Logged-in users only: persist the session so canonical reads ride the authenticated role.
export const supabase = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
