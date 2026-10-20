"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminErrorMessage } from "@/lib/admin-errors";
import type {
  AttendanceList,
  CheckinSession,
} from "@/lib/event-management/server";
import { attendanceListAction, checkinAction } from "./actions";
type Session = CheckinSession & { url: string; qr: string };
export function AttendanceManager({
  eventId,
  title,
  initialSession,
  initialList,
}: {
  eventId: string;
  title: string;
  initialSession: Session;
  initialList: AttendanceList;
}) {
  const [session, setSession] = useState(initialSession);
  const [list, setList] = useState(initialList);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const display = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const refreshVersion = useRef(0);
  const [history, setHistory] = useState<(string | null)[]>([null]);
  const after = history.at(-1) ?? null;
  const refresh = useCallback(async () => {
    if (busy.current) return;
    const version = ++refreshVersion.current;
    const data = await attendanceListAction(eventId, filter, search, after);
    if (version !== refreshVersion.current) return;
    if ("rows" in data && data.code === "SUCCESS") {
      setList(data);
      if (data.session.code === "SUCCESS")
        setSession((current) =>
          data.session.isOpen
            ? { ...current, isOpen: true, closesAt: data.session.closesAt }
            : {
                ...initialSession,
                isOpen: false,
                closesAt: data.session.closesAt,
                challenge: undefined,
              }
        );
    } else setError(adminErrorMessage(data.code));
  }, [eventId, filter, search, after, initialSession]);
  const operate = useCallback(
    async (operation: string) => {
      if (busy.current) return;
      ++refreshVersion.current;
      busy.current = true;
      setPending(true);
      setError("");
      try {
        const data = await checkinAction(eventId, operation, minutes);
        if ("qr" in data && data.qr) setSession(data as Session);
        else setError(adminErrorMessage(data.code));
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [eventId, minutes]
  );
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const id = setInterval(() => void refresh(), 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refresh]);
  useEffect(() => {
    if (!session.isOpen) return;
    const id = setInterval(() => void operate("rotate"), 75_000);
    return () => clearInterval(id);
  }, [session.isOpen, operate]);
  const format = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat("en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Asia/Muscat",
        }).format(new Date(value))
      : "—";
  const rows = list.rows.slice(0, 50);
  return (
    <>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive p-4 text-destructive"
        >
          {error}
        </p>
      )}
      <div className="grid gap-6 xl:grid-cols-[24rem_minmax(0,1fr)]">
        <div className="grid content-start gap-4 rounded-lg border p-5">
          <h2 className="font-semibold">Attendance QR</h2>
          <p role="status" className="text-sm">
            {session.isOpen
              ? `Check-in open until ${format(session.closesAt)} (Oman time)`
              : "Check-in closed"}
          </p>
          <div
            ref={display}
            role={fullscreen ? "dialog" : undefined}
            aria-modal={fullscreen ? true : undefined}
            aria-label={fullscreen ? `${title} attendance QR` : undefined}
            onKeyDown={(event) => {
              if (event.key === "Escape") setFullscreen(false);
            }}
            className={
              fullscreen
                ? "fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white p-6 text-black"
                : "grid gap-3"
            }
          >
            {fullscreen && (
              <h2 className="text-center text-2xl font-semibold">{title}</h2>
            )}
            {/* QR is generated server-side from this event's public attendance URL. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={session.qr}
              alt={`Attendance QR for ${title}`}
              className={fullscreen ? "w-full max-w-lg" : "w-full"}
            />
            {fullscreen && (
              <Button onClick={() => setFullscreen(false)}>
                Close display
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {session.challenge
              ? "Live QR expires after two minutes and rotates automatically while this page stays open. Printed/downloaded live codes expire too."
              : "This QR opens the attendance page. Open check-in and display a live QR for members to confirm."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setFullscreen(true)}>
              Display
            </Button>
            <Button variant="outline" asChild>
              <a href={session.qr} download={`attendance-${eventId}.png`}>
                Download
              </a>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const print = window.open("", "_blank", "width=800,height=900");
                if (!print) return;
                print.opener = null;
                const heading = print.document.createElement("h1");
                heading.textContent = title;
                const img = print.document.createElement("img");
                img.src = session.qr;
                img.style.width = "min(90vw,600px)";
                const note = print.document.createElement("p");
                note.textContent = session.challenge
                  ? "Live attendance code: expires within two minutes."
                  : "Scan to open the event attendance page.";
                print.document.body.append(heading, img, note);
                img.onload = () => {
                  print.focus();
                  print.print();
                };
              }}
            >
              Print
            </Button>
          </div>
          <Label htmlFor="checkin-duration">Check-in window (minutes)</Label>
          <Input
            id="checkin-duration"
            type="number"
            min={1}
            max={720}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending}
              onClick={() => void operate(session.isOpen ? "close" : "open")}
            >
              {session.isOpen ? "Close check-in" : "Open check-in"}
            </Button>
            {session.isOpen && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => void operate("rotate")}
              >
                Refresh live QR
              </Button>
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Registered", list.confirmed],
              ["Attended", list.attended],
              ["Not checked in", list.confirmed - list.attended],
              ["Waitlisted", list.waitlisted],
            ].map(([name, count]) => (
              <div key={name} className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">{name}</p>
                <p className="text-2xl font-semibold tabular-nums">{count}</p>
              </div>
            ))}
          </div>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setHistory([null]);
              void refresh();
            }}
          >
            <div className="grid flex-1 gap-1">
              <Label htmlFor="attendance-search">Search participants</Label>
              <Input
                id="attendance-search"
                value={search}
                maxLength={200}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setHistory([null]);
                }}
                placeholder="Name or email"
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="attendance-filter">Status</Label>
              <select
                id="attendance-filter"
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setHistory([null]);
                }}
              >
                <option value="all">All participants</option>
                <option value="attended">Attended</option>
                <option value="absent">Not checked in</option>
                <option value="waitlisted">Waitlisted</option>
              </select>
            </div>
            <Button type="submit" variant="outline">
              Refresh
            </Button>
          </form>
          <form
            method="post"
            action={`/admin/events/${eventId}/attendance/export`}
          >
            <input type="hidden" name="filter" value={filter} />
            <input type="hidden" name="search" value={search} />
            <Button type="submit" variant="outline">
              Export attendance CSV
            </Button>
          </form>
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {list.total} matching participants · updates every 15 seconds ·
            timestamps in Oman time
          </p>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  {[
                    "Name",
                    "Email",
                    "Registration",
                    "Attendance",
                    "Checked in",
                  ].map((x) => (
                    <th key={x} className="p-3 font-medium">
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="p-3" dir="auto">
                      {row.name}
                    </td>
                    <td className="p-3">{row.email}</td>
                    <td className="p-3">{row.status}</td>
                    <td className="p-3">
                      {row.attended ? "Attended" : "Not checked in"}
                    </td>
                    <td className="whitespace-nowrap p-3">
                      {format(row.checkedInAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <p className="p-4 text-sm text-muted-foreground">
                No participants match these filters.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={history.length < 2}
              onClick={() => setHistory((h) => h.slice(0, -1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={list.rows.length <= 50}
              onClick={() => setHistory((h) => [...h, rows.at(-1)?.id ?? null])}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
