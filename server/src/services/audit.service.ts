import { db } from "../db/index.js";
import { auditLog } from "../db/schema.js";
import { desc } from "drizzle-orm";

/**
 * Log an auditable action to the database.
 */
export async function logAction(
  userId: string | null,
  username: string,
  action: string,
  details: string
): Promise<void> {
  await db.insert(auditLog).values({
    userId,
    username,
    action,
    details,
  });
}

/**
 * Get recent audit logs (last N entries).
 */
export async function getRecentLogs(limit: number = 100) {
  return db
    .select()
    .from(auditLog)
    .orderBy(desc(auditLog.timestamp))
    .limit(limit);
}
