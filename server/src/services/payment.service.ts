import { db } from "../db/index.js";
import { payment, installment } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";
import { generatePaymentId } from "../utils/helpers.js";

export interface RecordPaymentInput {
  memberId: string;
  year: number;
  month: number;
  amountAir: number;
  amountBeban: number;
  amountCicilan: number;
  total: number;
}

/**
 * Record a payment. Also updates installment progress if applicable.
 */
export async function recordPayment(
  data: RecordPaymentInput,
  receivedBy: string
) {
  // Check for duplicate payment
  const existing = await db
    .select()
    .from(payment)
    .where(
      and(
        eq(payment.memberId, data.memberId),
        eq(payment.year, data.year),
        eq(payment.month, data.month)
      )
    );

  if (existing.length > 0) {
    throw new Error(
      `Payment already recorded for ${data.memberId} in ${data.month}/${data.year}`
    );
  }

  const payId = generatePaymentId();

  const [created] = await db
    .insert(payment)
    .values({
      id: payId,
      memberId: data.memberId,
      year: data.year,
      month: data.month,
      amountAir: data.amountAir,
      amountBeban: data.amountBeban,
      amountCicilan: data.amountCicilan,
      total: data.total,
      receivedBy,
    })
    .returning();

  // Update installment progress if cicilan was included
  if (data.amountCicilan > 0) {
    const [activeInstallment] = await db
      .select()
      .from(installment)
      .where(
        and(
          eq(installment.memberId, data.memberId),
          eq(installment.status, "active")
        )
      );

    if (activeInstallment) {
      const newMonthsPaid = activeInstallment.monthsPaid + 1;
      const newStatus =
        newMonthsPaid >= activeInstallment.tenure ? "completed" : "active";

      await db
        .update(installment)
        .set({
          monthsPaid: newMonthsPaid,
          status: newStatus,
        })
        .where(eq(installment.id, activeInstallment.id));
    }
  }

  return created;
}

/**
 * Get payments for a given period.
 */
export async function getPayments(month: number, year: number) {
  return db.query.payment.findMany({
    where: and(eq(payment.month, month), eq(payment.year, year)),
    with: {
      member: true,
    },
    orderBy: [desc(payment.paidAt)],
  });
}

/**
 * Get a single payment receipt by ID.
 */
export async function getReceipt(paymentId: string) {
  return db.query.payment.findFirst({
    where: eq(payment.id, paymentId),
    with: {
      member: true,
    },
  });
}
