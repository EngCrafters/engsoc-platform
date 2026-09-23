import { Clock3, UsersRound } from "lucide-react";

export function RegistrationCounts({
  confirmedCount,
  waitlistedCount,
  className,
}: {
  confirmedCount: number;
  waitlistedCount: number;
  className?: string;
}) {
  return (
    <div
      className={className}
      aria-label={`${confirmedCount} confirmed, ${waitlistedCount} waitlisted`}
    >
      <span className="inline-flex items-center gap-1.5 text-sm text-foreground/85">
        <UsersRound
          aria-hidden="true"
          className="size-3.5 text-muted-foreground"
        />
        {confirmedCount} confirmed
      </span>
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Clock3 aria-hidden="true" className="size-3.5" />
        {waitlistedCount} waitlisted
      </span>
    </div>
  );
}
