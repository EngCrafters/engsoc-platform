"use client";

import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Details and Lifecycle for one event. Both panels stay mounted (the inactive
 * one is only hidden) so unsaved form edits survive a tab switch.
 */
export function EventDetailTabs({
  details,
  lifecycle,
}: {
  details: ReactNode;
  lifecycle: ReactNode;
}) {
  return (
    <Tabs defaultValue="details" className="gap-6">
      <TabsList variant="line">
        <TabsTrigger value="details">Details</TabsTrigger>
        <TabsTrigger value="lifecycle">Lifecycle</TabsTrigger>
      </TabsList>
      <TabsContent
        value="details"
        forceMount
        className="data-[state=inactive]:hidden"
      >
        {details}
      </TabsContent>
      <TabsContent
        value="lifecycle"
        forceMount
        className="data-[state=inactive]:hidden"
      >
        {lifecycle}
      </TabsContent>
    </Tabs>
  );
}
