"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function CoverInput({
  eventId,
  hasCover,
  disabled,
}: {
  eventId?: string;
  hasCover: boolean;
  disabled: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [removed, setRemoved] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview]
  );
  const src = file
    ? preview
    : !removed && hasCover && eventId
      ? `/admin/events/${eventId}/image`
      : null;
  return (
    <div className="grid gap-3">
      <Label htmlFor="event-cover">Cover image</Label>
      <Input
        ref={input}
        id="event-cover"
        name="cover"
        type="file"
        accept="image/jpeg,image/png"
        disabled={disabled}
        onChange={(e) => {
          const selected = e.target.files?.[0] ?? null;
          setError("");
          if (
            selected &&
            (selected.size > 3 * 1024 * 1024 ||
              !["image/jpeg", "image/png"].includes(selected.type))
          ) {
            e.target.value = "";
            setError("Choose a JPEG or PNG up to 3 MiB.");
            setFile(null);
            return;
          }
          setFile(selected);
          setPreview(selected ? URL.createObjectURL(selected) : null);
          setRemoved(false);
        }}
      />
      <input type="hidden" name="removeCover" value={removed ? "yes" : "no"} />
      <p className="text-xs text-muted-foreground">
        JPEG or PNG, up to 3 MiB and 20 megapixels. Upload, replace or remove
        the cover, then save the event.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {src && (
        <div className="grid gap-2">
          {/* Authenticated previews must use the browser's session cookies. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt="Event cover preview"
            className="max-h-64 w-full rounded-lg border object-contain"
          />
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              setFile(null);
              setPreview(null);
              setRemoved(true);
              if (input.current) input.current.value = "";
            }}
          >
            Remove image
          </Button>
        </div>
      )}
    </div>
  );
}
