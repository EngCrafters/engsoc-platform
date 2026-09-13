CREATE TABLE "registration_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip_address" "inet" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "registration_attempts_ip_created_idx" ON "registration_attempts" USING btree ("ip_address","created_at");