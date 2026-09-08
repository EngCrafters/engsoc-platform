import { defineConfig } from "drizzle-kit";

// Migrations run against Supabase's connection pooler in production, and
// directly against the project's Postgres instance for local dev. Get the
// connection string from the Supabase dashboard, Project Settings > Database.
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
