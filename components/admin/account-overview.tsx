"use client";

import { AdminPageHeader } from "@/components/admin/page-header";
import {
  AccountPermissionsSection,
  AccountProfileSection,
  AccountSecuritySection,
} from "@/components/admin/account-sections";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function AccountOverview({
  email,
  userId,
  committees,
  logoutAction,
}: {
  email: string | null;
  userId: string;
  committees: ReadonlyArray<{ id: string; name: string }>;
  logoutAction: () => void | Promise<void>;
}) {
  return (
    <>
      <AdminPageHeader
        title="Account"
        headingId="account-title"
        description="Your sign-in identity, committee access and security options."
      />
      <Tabs defaultValue="profile" className="gap-6">
        <TabsList variant="line">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="max-w-3xl">
          <AccountProfileSection
            email={email}
            userId={userId}
            committees={committees}
          />
        </TabsContent>
        <TabsContent value="permissions" className="max-w-3xl">
          <AccountPermissionsSection />
        </TabsContent>
        <TabsContent value="security" className="max-w-3xl">
          <AccountSecuritySection logoutAction={logoutAction} />
        </TabsContent>
      </Tabs>
    </>
  );
}
