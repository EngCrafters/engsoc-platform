import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function refreshAuthSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return response;
  // There is nothing to refresh for an anonymous request. Skipping the Auth
  // round-trip also keeps public login/recovery pages independent of Auth
  // availability until a session cookie actually exists.
  if (
    !request.cookies
      .getAll()
      .some((cookie) => cookie.name.includes("auth-token"))
  ) {
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // Keep this immediately after client construction. It verifies/refreshes
  // cookie state before Server Components use it.
  await supabase.auth.getClaims();
  return response;
}
