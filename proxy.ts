import { NextResponse, type NextRequest } from "next/server";
import { refreshAuthSession } from "@/lib/supabase/proxy";
import { checkHostRoute } from "@/lib/api/host-policy";

/**
 * Request boundary.
 *
 * /v1 is handled here so the host policy from lib/api/host-policy.ts has exactly
 * one entry point. The API needs no session refresh — registration is a public
 * POST with no cookie — so an /v1 request returns immediately instead of paying
 * for a Supabase round trip.
 *
 * Host enforcement is dormant unless CORE_API_HOST_ENFORCEMENT=true, which is
 * the correct state until api./admin.essqu.com are attached and tested.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/v1" || pathname.startsWith("/v1/")) {
    const verdict = checkHostRoute(request.headers.get("host"), pathname);
    // 404 rather than 403: a wrong host should not confirm that an API exists
    // on the other hostname.
    if (!verdict.ok) return new NextResponse(null, { status: 404 });
    return NextResponse.next();
  }

  return refreshAuthSession(request);
}

export const config = {
  matcher: ["/admin/:path*", "/auth/:path*", "/v1/:path*"],
};
