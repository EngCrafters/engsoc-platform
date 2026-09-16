// Two clients, on purpose:
//
// - `supabaseBrowser`: uses the public anon key, safe to use in client
//   components, respects Row Level Security.
// - `supabaseServer`: uses the service role key, full access, only ever use
//   this on the server (route handlers, server actions), never in a client
//   component. This is what bypasses Row Level Security, so it's exactly
//   the kind of thing Hisham reviews carefully.

import { createClient } from "@supabase/supabase-js";

export function supabaseBrowser() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/** Public server reads retain the anon key and therefore enforce RLS. */
export function supabasePublicServer() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
}

export function supabaseServer() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
