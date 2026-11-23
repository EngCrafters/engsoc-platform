"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { archiveTemplateAction } from "./actions";

export type TemplateRow = {
  id: string;
  name: string;
  subjectEn: string | null;
  subjectAr: string | null;
  bodyEn: string | null;
  bodyAr: string | null;
  revision: number;
  updatedAt: string;
};

export function TemplateList({ templates }: { templates: TemplateRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (templates.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        No templates yet. Save one from the message editor.
      </p>
    );
  return (
    <ul className="flex flex-col divide-y rounded-md border">
      {templates.map((t) => (
        <li
          key={t.id}
          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
        >
          <span className="min-w-0">
            <span className="block font-medium">{t.name}</span>
            <span
              className="block truncate text-xs text-muted-foreground"
              dir="auto"
            >
              {t.subjectEn || t.subjectAr || "No subject"}
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await archiveTemplateAction(t.id);
                if (result.code === "SUCCESS") toast.success(result.message);
                else toast.error(result.message);
                router.refresh();
              })
            }
          >
            Remove
          </Button>
        </li>
      ))}
    </ul>
  );
}
