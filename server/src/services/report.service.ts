import { db } from "../db/index.js";
import {
  member,
  meterReading,
  payment,
  installment,
  settings,
} from "../db/schema.js";
import { eq, and, ne, count, sql } from "drizzle-orm";

/**
 * Get system settings values.
 */
async function getSettings() {
  const rows = await db.select().from(settings);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    waterRate: Number(map.get("water_rate")) || 2100,
    adminFee: Number(map.get("admin_fee")) || 500,
  };
}

/**
 * Dashboard KPIs for the admin panel.
 */
export async function getDashboardKPIs(month: number, year: number) {
  const { waterRate } = await getSettings();

  // Total revenue this month
  const revenueResult = await db
    .select({
      totalAir: sql<number>`COALESCE(SUM(${payment.amountAir}), 0)`,
      totalBeban: sql<number>`COALESCE(SUM(${payment.amountBeban}), 0)`,
      totalCicilan: sql<number>`COALESCE(SUM(${payment.amountCicilan}), 0)`,
      totalRevenue: sql<number>`COALESCE(SUM(${payment.total}), 0)`,
    })
    .from(payment)
    .where(and(eq(payment.year, year), eq(payment.month, month)));

  const revenue = revenueResult[0];

  // Active members count
  const [activeCount] = await db
    .select({ count: count() })
    .from(member)
    .where(ne(member.status, "nonaktif"));

  const [totalCount] = await db.select({ count: count() }).from(member);

  // Arrears rate (last month)
  const lastMonth = month === 1 ? 12 : month - 1;
  const lastMonthYear = month === 1 ? year - 1 : year;

  const [billedLastMonth] = await db
    .select({ count: count() })
    .from(meterReading)
    .where(
      and(
        eq(meterReading.year, lastMonthYear),
        eq(meterReading.month, lastMonth)
      )
    );

  const [paidLastMonth] = await db
    .select({ count: count() })
    .from(payment)
    .where(
      and(eq(payment.year, lastMonthYear), eq(payment.month, lastMonth))
    );

  const arrearsCount = billedLastMonth.count - paidLastMonth.count;
  const arrearsRate =
    billedLastMonth.count > 0
      ? ((arrearsCount / billedLastMonth.count) * 100).toFixed(1)
      : "0";

  // Recording rate this month
  const [recordedThisMonth] = await db
    .select({ count: count() })
    .from(meterReading)
    .where(
      and(eq(meterReading.year, year), eq(meterReading.month, month))
    );

  const recordingRate =
    activeCount.count > 0
      ? ((recordedThisMonth.count / activeCount.count) * 100).toFixed(1)
      : "0";

  // Active installments summary
  const activeInstallments = await db
    .select()
    .from(installment)
    .where(eq(installment.status, "active"));

  const installmentCount = activeInstallments.length;
  const totalOutstandingDebt = activeInstallments.reduce(
    (acc, i) => acc + (i.totalAmount - i.monthlyAmount * i.monthsPaid),
    0
  );

  return {
    revenue: {
      air: Number(revenue.totalAir),
      beban: Number(revenue.totalBeban),
      cicilan: Number(revenue.totalCicilan),
      total: Number(revenue.totalRevenue),
    },
    members: {
      active: activeCount.count,
      total: totalCount.count,
    },
    arrears: {
      rate: Number(arrearsRate),
      count: arrearsCount,
      billedCount: billedLastMonth.count,
    },
    recording: {
      rate: Number(recordingRate),
      recorded: recordedThisMonth.count,
      total: activeCount.count,
    },
    installments: {
      activeCount: installmentCount,
      outstandingDebt: totalOutstandingDebt,
    },
  };
}

/**
 * Annual financial report — 12-month breakdown.
 */
export async function getFinancialReport(year: number) {
  const { waterRate } = await getSettings();

  const monthly: Record<
    number,
    { air: number; beban: number; cicilan: number; piutang: number }
  > = {};

  for (let i = 1; i <= 12; i++) {
    monthly[i] = { air: 0, beban: 0, cicilan: 0, piutang: 0 };
  }

  // Get all payments for the year
  const payments = await db
    .select()
    .from(payment)
    .where(eq(payment.year, year));

  let totAir = 0,
    totBeban = 0,
    totCicilan = 0;

  payments.forEach((p) => {
    monthly[p.month].air += p.amountAir;
    monthly[p.month].beban += p.amountBeban;
    monthly[p.month].cicilan += p.amountCicilan;
    totAir += p.amountAir;
    totBeban += p.amountBeban;
    totCicilan += p.amountCicilan;
  });

  // Calculate arrears per month
  const usages = await db
    .select()
    .from(meterReading)
    .where(eq(meterReading.year, year));

  usages.forEach((u) => {
    const hasPaid = payments.find(
      (p) => p.memberId === u.memberId && p.month === u.month
    );
    if (!hasPaid) {
      monthly[u.month].piutang += u.volume * waterRate;
    }
  });

  return {
    monthly,
    totals: {
      air: totAir,
      beban: totBeban,
      cicilan: totCicilan,
      grandTotal: totAir + totBeban + totCicilan,
    },
  };
}

/**
 * Get revenue data for chart (last 6 months).
 */
export async function getRevenueChart(month: number, year: number) {
  const labels: string[] = [];
  const data: number[] = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(year, month - 1 - i, 1);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();

    labels.push(
      d.toLocaleString("id-ID", { month: "short" }) + " " + y
    );

    const [result] = await db
      .select({
        total: sql<number>`COALESCE(SUM(${payment.total}), 0)`,
      })
      .from(payment)
      .where(and(eq(payment.year, y), eq(payment.month, m)));

    data.push(Number(result.total));
  }

  return { labels, data };
}
