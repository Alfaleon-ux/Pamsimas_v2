import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as billingService from "../services/billing.service.js";
import { getCurrentPeriod } from "../utils/helpers.js";

const router = Router();

// All billing routes require admin role
router.use(requireAuth, requireRole("admin"));

/**
 * GET /api/billing
 * Get the full billing table for a given month/year.
 */
router.get("/", async (req, res) => {
  try {
    const { month, year } = getCurrentPeriod();
    const m = Number(req.query.month) || month;
    const y = Number(req.query.year) || year;

    const bills = await billingService.getBillingTable(m, y);

    // Summary stats
    const totalBilled = bills.filter((b) => b.isBilled).length;
    const totalPaid = bills.filter((b) => b.isPaid).length;
    const totalUnpaid = totalBilled - totalPaid;
    const totalRevenue = bills
      .filter((b) => b.isPaid)
      .reduce((sum, b) => sum + b.total, 0);
    const totalOutstanding = bills
      .filter((b) => b.isBilled && !b.isPaid)
      .reduce((sum, b) => sum + b.total, 0);

    res.json({
      data: bills,
      period: { month: m, year: y },
      summary: {
        totalMembers: bills.length,
        totalBilled,
        totalPaid,
        totalUnpaid,
        totalRevenue,
        totalOutstanding,
      },
    });
  } catch (error: any) {
    console.error("[Billing] GET /:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/billing/:memberId
 * Get a single member's bill for a given period.
 */
router.get("/:memberId", async (req, res) => {
  try {
    const { month, year } = getCurrentPeriod();
    const m = Number(req.query.month) || month;
    const y = Number(req.query.year) || year;

    const bill = await billingService.getMemberBill(
      req.params.memberId,
      m,
      y
    );

    if (!bill) {
      res.status(404).json({ error: "Member or bill not found" });
      return;
    }

    res.json({ data: bill });
  } catch (error: any) {
    console.error("[Billing] GET /:memberId:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
