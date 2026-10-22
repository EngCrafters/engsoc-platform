"use client";

import { useState } from "react";
import { Eye, ExternalLink, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The SQU ID card stays hidden until the reviewer asks for it: every view is
 * recorded in audit, so opening the page alone records nothing and the card is
 * not on screen by default.
 */
export function DocumentViewer({
  applicationId,
  mediaType,
  byteSize,
}: {
  applicationId: string;
  mediaType: string;
  byteSize: number;
}) {
  const [shown, setShown] = useState(false);
  const href = `/admin/membership/${applicationId}/document`;
  const size =
    byteSize >= 1024 * 1024
      ? `${(byteSize / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(byteSize / 1024))} KB`;
  const pdf = mediaType === "application/pdf";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {pdf ? "PDF" : mediaType.replace("image/", "").toUpperCase() + " image"}{" "}
        · {size}. Each view is recorded in the application&apos;s history.
      </p>
      {pdf ? (
        <Button asChild variant="outline" className="self-start">
          <a href={href} target="_blank" rel="noopener noreferrer">
            <FileText aria-hidden="true" data-icon="inline-start" />
            Open ID card (PDF)
            <ExternalLink aria-hidden="true" data-icon="inline-end" />
          </a>
        </Button>
      ) : shown ? (
        // eslint-disable-next-line @next/next/no-img-element -- an authenticated, uncached, audited document; never optimised or cached
        <img
          src={href}
          alt="Applicant's SQU student ID card"
          className="max-h-[32rem] w-full rounded-lg border object-contain"
          referrerPolicy="no-referrer"
        />
      ) : (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => setShown(true)}
        >
          <Eye aria-hidden="true" data-icon="inline-start" />
          Show ID card
        </Button>
      )}
    </div>
  );
}
