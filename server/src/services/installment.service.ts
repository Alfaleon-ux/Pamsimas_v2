import { db } from "../db/index.js";
import { installment } from "../db/schema.js";
import { eq } from "drizzle-orm";

/**
 * Get all installments, optionally filtered by status.
 */
export async function getInstallments(status?: string) {
  if (status) {
    return db.query.installment.findMany({
      where: eq(installment.status, status),
      with: { member: true },
    });
  }
  return db.query.installment.findMany({
    with: { member: true },
  });
}

/**
 * Get installment for a specific member.
 */
export async function getMemberInstallment(memberId: string) {
  return db.query.installment.findFirst({
    where: eq(installment.memberId, memberId),
    with: { member: true },
  });
}
