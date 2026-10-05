"use client";

import { useEffect } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { RESET_PATH, readAuthHash } from "@/lib/auth/callback";

/**
 * Safety net for Auth emails that still deliver a session in the URL
 * fragment (`#access_token=...`), such as one sent from the Supabase
 * dashboard or from the default template. A fragment never reaches the server,
 * so this runs in the browser: it removes the fragment from the address bar
 * and history first, turns the tokens into the normal cookie session, and
 * sends the user to the password page. Fragments it does not recognise are
 * left alone. Renders nothing.
 */
export function AuthHashRelay() {
  useEffect(() => {
    const decision = readAuthHash(window.location.hash);
    if (decision.kind === "ignore") return;

    // Never leave tokens in the address bar or the back-button history.
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`
    );

    if (decision.kind === "error") {
      window.location.replace(`/admin/recovery?link=${decision.failure}`);
      return;
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      window.location.replace("/admin/recovery?link=invalid");
      return;
    }
    createBrowserClient(url, anonKey)
      .auth.setSession({
        access_token: decision.accessToken,
        refresh_token: decision.refreshToken,
      })
      .then(({ error }) => {
        window.location.replace(
          error ? "/admin/recovery?link=invalid" : RESET_PATH
        );
      })
      .catch(() => window.location.replace("/admin/recovery?link=invalid"));
  }, []);

  return null;
}
