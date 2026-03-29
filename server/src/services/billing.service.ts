import { db } from "../db/index.js";
import { meterReading, member, payment, installment, settings } from "../db/schema.js";
import { eq, and, ne } from "drizzle-orm";

/**
 * Get system settings (water rate + admin fee).
 */
async function getSystemSettings() {
  const rows = await db.select().from(settings);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    waterRate: Number(map.get("water_rate")) || 2100,
    adminFee: Number(map.get("admin_fee")) || 500,
  };
}

export interface BillItem {
  member: typeof member.$inferSelect;
  usage: typeof meterReading.$inferSelect | null;
  paymentRecord: typeof payment.$inferSelect | null;
  biayaAir: number;
  biayaBeban: number;
  biayaCicilan: number;
  total: number;
  isPaid: boolean;
  isBilled: boolean;
  cicilanInfo: {
    bulanKe: number;
    tenure: number;
  } | null;
}

/**
 * Get the full billing table for a given month/year.
 * Computes bills on-the-fly from meter readings + settings + installments.
 */
export async function getBillingTable(
  month: number,
  year: number
): Promise<BillItem[]> {
  const { waterRate, adminFee } = await getSystemSettings();

  // Get all active members
  const members = await db
    .select()
    .from(member)
    .where(ne(member.status, "nonaktif"))
    .orderBy(member.id);

  // Get all readings for this period
  const readings = await db
    .select()
    .from(meterReading)
    .where(
      and(eq(meterReading.month, month), eq(meterReading.year, year))
    );

  // Get all payments for this period
  const payments = await db
    .select()
    .from(payment)
    .where(and(eq(payment.month, month), eq(payment.year, year)));

  // Get active installments
  const installments = await db
    .select()
    .from(installment)
    .where(eq(installment.status, "active"));

  const readingMap = new Map(readings.map((r) => [r.memberId, r]));
  const paymentMap = new Map(payments.map((p) => [p.memberId, p]));
  const installmentMap = new Map(installments.map((i) => [i.memberId, i]));

  return members.map((m) => {
    const usage = readingMap.get(m.id) || null;
    const paymentRecord = paymentMap.get(m.id) || null;
    const activeInstallment = installmentMap.get(m.id);

    const isBilled = usage !== null;
    const biayaAir = isBilled ? usage!.volume * waterRate : 0;
    const biayaBeban = isBilled ? adminFee : 0;

    let biayaCicilan = 0;
    let cicilanInfo: BillItem["cicilanInfo"] = null;

    if (activeInstallment && isBilled) {
      const start = new Date(
        activeInstallment.startYear,
        activeInstallment.startMonth - 1,
        1
      );
      const current = new Date(year, month - 1, 1);
      const diffMonths =
        (current.getFullYear() - start.getFullYear()) * 12 +
        (current.getMonth() - start.getMonth());

      if (diffMonths >= 0 && diffMonths < activeInstallment.tenure) {
        biayaCicilan = activeInstallment.monthlyAmount;
        cicilanInfo = {
          bulanKe: diffMonths + 1,
          tenure: activeInstallment.tenure,
        };
      }
    }

    const total = biayaAir + biayaBeban + biayaCicilan;

    return {
      member: m,
      usage,
      paymentRecord,
      biayaAir,
      biayaBeban,
      biayaCicilan,
      total,
      isPaid: paymentRecord !== null,
      isBilled,
      cicilanInfo,
    };
  });
}

/**
 * Get a single member's bill for a given period.
 */
export async function getMemberBill(
  memberId: string,
  month: number,
  year: number
): Promise<BillItem | null> {
  const bills = await getBillingTable(month, year);
  return bills.find((b) => b.member.id === memberId) || null;
}
