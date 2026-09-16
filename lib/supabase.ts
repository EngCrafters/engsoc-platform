// Public and privileged infrastructure clients, on purpose:
//
// - `supabaseBrowser`: uses the public anon key, safe to use in client
//   components, respects Row Level Security.
// - `supabaseServer`: uses the service role key. It is reserved for explicit
//   maintenance tooling. Normal application runtime access uses the restricted
//   `app_runtime` connection in `lib/db.ts`; logged-in admin requests use the
//   caller-scoped cookie client in `lib/auth/server.ts`.

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
