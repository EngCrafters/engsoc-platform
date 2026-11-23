"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Megaphone } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { verificationMessage } from "@/lib/verification/labels";
import { setLeadershipRequestsOpenAction } from "./verification-actions";

/**
 * Whether members may send new leadership requests (ADR 0026), at the top of
 * Membership → Leadership. Board Administration and Technical change it; the
 * routine re-checks and audits. Closing stops new requests only: pending
 * requests below stay decidable and appointments stay visible to members.
 */
export function LeadershipRequestsSwitch({
  open,
  editable,
}: {
  open: boolean;
  editable: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const change = (next: boolean) => {
    setError(null);
    startTransition(async () => {
      const form = new FormData();
      form.set("open", String(next));
      const result = await setLeadershipRequestsOpenAction(null, form);
      if (result?.code === "SUCCESS") {
        toast.success(
          next
            ? "Leadership requests are open. Members can request positions from their profile."
            : "Leadership requests are closed. Pending requests can still be decided."
        );
        router.refresh();
      } else if (result?.code !== "UNCHANGED")
        setError(verificationMessage(result?.code ?? "SERVER_ERROR"));
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Megaphone aria-hidden="true" className="size-4" />
          Leadership requests
          <Badge variant={open ? "default" : "secondary"}>
            {open ? "Open" : "Closed"}
          </Badge>
        </CardTitle>
        <CardDescription>
          {open
            ? "Members can request a Chief or Assistant Chief position for a committee, or for one of its teams, from their profile."
            : "Members cannot send new requests; their profile says requests are closed. Pending requests below can still be approved or rejected, and existing appointments stay visible."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Switch
            id={`${id}-open`}
            checked={open}
            onCheckedChange={change}
            disabled={!editable || pending}
            aria-describedby={`${id}-who`}
          />
          <Label htmlFor={`${id}-open`}>Accept new leadership requests</Label>
          {pending ? <Spinner aria-label="Saving" /> : null}
        </div>
        <p id={`${id}-who`} className="text-sm text-muted-foreground">
          {editable
            ? "Changes take effect immediately and are recorded in the audit history."
            : "Board Administration or the Technical Team can change this."}
        </p>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
