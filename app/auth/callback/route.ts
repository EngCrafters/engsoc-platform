import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeAdminReturnPath } from "@/lib/auth/paths";

export async function GET(request: NextRequest) {
  const next = request.nextUrl.searchParams.get("next");
  const destination =
    next === "/auth/reset" ? "/auth/reset" : safeAdminReturnPath(next);
  const failureDestination =
    destination === "/auth/reset"
      ? "/admin/recovery?link=invalid"
      : "/admin/login?auth=failed";
  const response = NextResponse.redirect(new URL(destination, request.url));
  const code = request.nextUrl.searchParams.get("code");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!code || !url || !anonKey) {
    return NextResponse.redirect(new URL(failureDestination, request.url));
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) =>
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        ),
    },
  });
  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return error
      ? NextResponse.redirect(new URL(failureDestination, request.url))
      : response;
  } catch {
    return NextResponse.redirect(new URL(failureDestination, request.url));
  }
}
