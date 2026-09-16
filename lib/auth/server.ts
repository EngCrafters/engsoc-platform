import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function publicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Supabase public runtime configuration is missing.");
  }
  return { url, anonKey };
}

/**
 * A fresh client for the current request. It carries only the user's cookie
 * session, so its database queries remain subject to authenticated RLS.
 */
export async function createAuthServerClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = publicSupabaseConfig();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Server Components can read but cannot write cookies. `proxy.ts`
          // refreshes sessions before they reach a component.
        }
      },
    },
  });
}

export function authRedirectUrl() {
  const origin = process.env.AUTH_REDIRECT_ORIGIN;
  if (!origin) return null;

  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && process.env.NODE_ENV === "production") {
      return null;
    }
    return new URL("/auth/callback?next=/auth/reset", url).toString();
  } catch {
    return null;
  }
}
