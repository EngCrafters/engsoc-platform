import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  RECOVERY_INTENT_COOKIE,
  callbackFailureDestination,
  classifyLinkFailure,
  parseOtpType,
  resolveCallbackDestination,
} from "@/lib/auth/callback";

/**
 * Landing point for every Supabase Auth email link. It accepts either a PKCE
 * `code` (the app's own recovery request) or a `token_hash` + `type` pair (the
 * recommended email template, which also works when the email is opened on a
 * different device than the one that requested it). The session is written to
 * cookies on the redirect response; tokens never appear in a URL we render.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const type = parseOtpType(params.get("type"));
  const destination = resolveCallbackDestination({
    next: params.get("next"),
    type,
    recoveryIntent: request.cookies.has(RECOVERY_INTENT_COOKIE),
  });
  const failed = (failure: "expired" | "invalid") =>
    NextResponse.redirect(
      new URL(callbackFailureDestination(destination, failure), request.url)
    );

  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return failed("invalid");
  if (!code && !(tokenHash && type)) {
    // Nothing to verify here. If the email delivered a session in the URL
    // fragment, the browser keeps the fragment across this redirect and the
    // global AuthHashRelay completes the sign-in; otherwise the destination
    // page shows its own signed-out state.
    return NextResponse.redirect(new URL(destination, request.url));
  }

  const response = NextResponse.redirect(new URL(destination, request.url));
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
    const { error } =
      tokenHash && type
        ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
        : await supabase.auth.exchangeCodeForSession(code as string);
    if (error) return failed(classifyLinkFailure(error));
  } catch {
    return failed("invalid");
  }
  response.cookies.delete(RECOVERY_INTENT_COOKIE);
  return response;
}
