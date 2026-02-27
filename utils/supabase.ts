import { processLock } from '@supabase/auth-js';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL environment variable.');
}

if (!supabaseKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (preferred) or EXPO_PUBLIC_SUPABASE_ANON_KEY (legacy).'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    lock: processLock,
  },
});

/**
 * Service-role client – bypasses RLS.
 * Use ONLY for server-side / registration operations that require elevated privileges.
 */
const serviceRoleKey = process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;
export const supabaseAdmin = serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : supabase; // fallback to regular client if no service role key

export default supabase;
