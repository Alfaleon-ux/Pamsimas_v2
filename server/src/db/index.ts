import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}

// For query purposes (connection pool)
// Supabase requires SSL and uses connection pooler on port 6543
const queryClient = postgres(connectionString, {
  ssl: { rejectUnauthorized: false },
  max: 10, // Max connections in the pool
  idle_timeout: 20, // Close idle connections after 20s
  connect_timeout: 10, // Connection timeout 10s
  prepare: false, // Required for Supabase Transaction pooler mode
});

export const db = drizzle(queryClient, { schema });

export type Database = typeof db;
