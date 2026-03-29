import { db } from "../db/index.js";
import { workOrder, installment } from "../db/schema.js";
import { eq } from "drizzle-orm";
import {
  generateSpkId,
  generateInstallmentId,
} from "../utils/helpers.js";

export interface CreateWorkOrderInput {
  memberId: string;
  fee: number;
  method: "cash" | "cicilan";
  tenure?: number; // Required if method === 'cicilan'
}

/**
 * Create a new work order (SPK).
 * If method is 'cicilan', also creates an installment record.
 */
export async function createWorkOrder(data: CreateWorkOrderInput) {
  const spkId = generateSpkId();

  // Create installment if cicilan
  if (data.method === "cicilan") {
    if (!data.tenure || data.tenure <= 0) {
      throw new Error("Tenure is required for installment method");
    }

    const now = new Date();
    const monthlyAmount = Math.ceil(data.fee / data.tenure);

    await db.insert(installment).values({
      id: generateInstallmentId(data.memberId),
      memberId: data.memberId,
      totalAmount: data.fee,
      tenure: data.tenure,
      monthlyAmount,
      monthsPaid: 0,
      startYear: now.getFullYear(),
      startMonth: now.getMonth() + 1,
      status: "active",
    });
  }

  // Create SPK
  const [created] = await db
    .insert(workOrder)
    .values({
      id: spkId,
      memberId: data.memberId,
      fee: data.fee,
      method: data.method,
      status: "pending",
    })
    .returning();

  return created;
}

/**
 * Get all work orders.
 */
export async function getWorkOrders() {
  return db.query.workOrder.findMany({
    with: {
      member: true,
      officer: {
        columns: { id: true, name: true, username: true },
      },
    },
    orderBy: (wo, { desc }) => [desc(wo.createdAt)],
  });
}

/**
 * Get pending work orders (for field officers).
 */
export async function getPendingOrders() {
  return db.query.workOrder.findMany({
    where: eq(workOrder.status, "pending"),
    with: {
      member: true,
    },
    orderBy: (wo, { desc }) => [desc(wo.createdAt)],
  });
}

/**
 * Complete a work order (mark as installed).
 */
export async function completeWorkOrder(
  spkId: string,
  serialNumber: string,
  officerId: string
) {
  if (!serialNumber.trim()) {
    throw new Error("Serial number is required");
  }

  const [updated] = await db
    .update(workOrder)
    .set({
      status: "installed",
      serialNumber: serialNumber.trim(),
      officerId,
      installedAt: new Date(),
    })
    .where(eq(workOrder.id, spkId))
    .returning();

  return updated || null;
}
