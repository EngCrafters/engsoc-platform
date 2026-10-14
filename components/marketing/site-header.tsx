"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SITE } from "@/content/site";
import { useI18n } from "./i18n-provider";
import { LanguageSwitch } from "./language-switch";
import { IconArrowRight, IconClose } from "./icons";

/**
 * The public navigation.
 *
 * Five destinations and one call to action. Activites, Projects and
 * Disciplines are sections of the landing page; Events and About are real
 * routes. The sign-in link goes to the platform's committee administration
 * area, which already exists — it is not a member account.
 */
const NAV = [
  { id: "events", href: "/events" },
  { id: "activities", href: "/#activities" },
  { id: "projects", href: "/#projects" },
  { id: "disciplines", href: "/#disciplines" },
  { id: "about", href: "/about" },
] as const;

export function SiteHeader() {
  const { t } = useI18n();
  const pathname = usePathname();
  // The panel is open only for the route it was opened on. Deriving it this way
  // means a navigation closes the panel as a consequence of the path changing,
  // with no state-synchronisation effect.
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const open = openedFor === pathname;
  const [scrolled, setScrolled] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Opening moves focus into the panel; closing returns it to the button.
  useEffect(() => {
    if (open) firstLinkRef.current?.focus();
  }, [open]);

  function close(returnFocus = false) {
    setOpenedFor(null);
    if (returnFocus) buttonRef.current?.focus();
  }

  // Lock the page behind the panel without losing the scroll position.
  useLayoutEffect(() => {
    if (!open) return;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previous;
    };
  }, [open]);

  // Escape closes; focus leaving the header entirely closes too.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function isCurrent(href: string) {
    return href === "/events"
      ? pathname.startsWith("/events")
      : pathname === href;
  }

  return (
    <header
      data-open={open}
      data-scrolled={scrolled}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          close();
      }}
      className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-4 sm:pt-4"
    >
      <div
        className="mx-auto flex h-[var(--m-nav-height)] max-w-[var(--m-content-max)] items-center gap-3 rounded-m-nav border border-m-border px-3 shadow-[0_1px_2px_rgb(19_35_60/0.04),0_8px_24px_-12px_rgb(19_35_60/0.12)] backdrop-blur-md data-[scrolled=true]:bg-[var(--m-nav-surface-solid)] sm:px-4"
        style={{ backgroundColor: "var(--m-nav-surface)" }}
      >
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <Image
            src="/brand/es-emblem.webp"
            alt=""
            width={36}
            height={36}
            priority
            className="size-9"
          />
          <span className="grid min-w-0 text-start leading-tight">
            <span className="truncate text-sm font-semibold">
              {t.site.name}
            </span>
            <span className="truncate text-xs text-m-ink-2">
              {t.site.affiliation}
            </span>
          </span>
        </Link>

        <nav
          aria-label={t.nav.sectionsLabel}
          className="ms-auto hidden lg:block"
        >
          <ul className="flex items-center gap-1">
            {NAV.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  aria-current={isCurrent(item.href) ? "page" : undefined}
                  className="inline-flex min-h-11 items-center rounded-full px-3 text-[0.9375rem] font-medium text-m-ink-2 transition-colors hover:bg-m-brand-soft hover:text-m-brand aria-current:bg-m-brand-soft aria-current:text-m-brand"
                >
                  {t.nav.links[item.id]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ms-auto flex items-center gap-1 lg:ms-2">
          {/* Always reachable. This is the only way a visitor can change the
              language, and hiding it below a breakpoint strands phone users. */}
          <LanguageSwitch />

          {SITE.signInUrl ? (
            <Link
              href={SITE.signInUrl}
              className="hidden min-h-11 items-center rounded-full px-3 text-[0.9375rem] font-medium text-m-ink-2 transition-colors hover:bg-m-brand-soft hover:text-m-brand xl:inline-flex"
            >
              {t.nav.signIn}
            </Link>
          ) : null}

          <Link
            href="/#join"
            className="hidden min-h-11 items-center gap-2 rounded-full bg-m-brand px-4 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-m-brand-hover sm:inline-flex"
          >
            {t.nav.join}
          </Link>

          <button
            ref={buttonRef}
            type="button"
            aria-expanded={open}
            aria-controls="site-menu"
            onClick={() => (open ? close(true) : setOpenedFor(pathname))}
            className="grid size-11 place-items-center rounded-full text-m-ink transition-colors hover:bg-m-brand-soft lg:hidden"
          >
            {open ? <IconClose className="size-5" /> : <MenuGlyph />}
            <span className="sr-only">
              {open ? t.nav.closeMenu : t.nav.openMenu}
            </span>
          </button>
        </div>
      </div>

      {/* Mobile panel. Kept in the DOM only while open so its links never
          pollute the tab order of the collapsed header. */}
      {open ? (
        <div
          id="site-menu"
          ref={panelRef}
          className="mx-auto mt-2 max-w-[var(--m-content-max)] overflow-hidden rounded-m-nav border border-m-border bg-m-surface p-2 shadow-[0_24px_64px_-24px_rgb(16_33_61/0.45)] lg:hidden"
        >
          <nav aria-label={t.nav.sectionsLabel}>
            <ul className="grid">
              {NAV.map((item, index) => (
                <li key={item.id}>
                  <Link
                    ref={index === 0 ? firstLinkRef : undefined}
                    href={item.href}
                    aria-current={isCurrent(item.href) ? "page" : undefined}
                    onClick={() => close()}
                    className="flex min-h-12 items-center justify-between rounded-m-button px-3 text-base font-medium text-m-ink hover:bg-m-brand-soft aria-current:text-m-brand"
                  >
                    {t.nav.links[item.id]}
                    <IconArrowRight className="size-4 text-m-ink-2" />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="mt-2 grid gap-2 border-t border-m-border pt-3">
            <Link
              href="/#join"
              onClick={() => close()}
              className="flex min-h-12 items-center justify-center rounded-m-button bg-m-brand px-4 font-semibold text-white"
            >
              {t.nav.join}
            </Link>
            {SITE.signInUrl ? (
              <Link
                href={SITE.signInUrl}
                onClick={() => close()}
                className="flex min-h-12 items-center justify-center rounded-m-button border border-m-border px-4 font-medium text-m-ink"
              >
                {t.nav.signIn}
              </Link>
            ) : null}
            <div className="flex justify-center pt-1 sm:hidden">
              <LanguageSwitch variant="panel" />
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function MenuGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
