import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as paymentService from "../services/payment.service.js";
import { logAction } from "../services/audit.service.js";
import { getCurrentPeriod, formatRp } from "../utils/helpers.js";

const router = Router();

// All payment routes require admin role
router.use(requireAuth, requireRole("admin"));

/**
 * GET /api/payments
 * List payments for a given period.
 */
router.get("/", async (req, res) => {
  try {
    const { month, year } = getCurrentPeriod();
    const m = Number(req.query.month) || month;
    const y = Number(req.query.year) || year;

    const payments = await paymentService.getPayments(m, y);
    res.json({ data: payments });
  } catch (error: any) {
    console.error("[Payment] GET /:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/payments/:id
 * Get a single payment receipt.
 */
router.get("/:id", async (req, res) => {
  try {
    const receipt = await paymentService.getReceipt(req.params.id);
    if (!receipt) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }
    res.json({ data: receipt });
  } catch (error: any) {
    console.error("[Payment] GET /:id:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/payments
 * Record a new payment (terima bayar).
 */
router.post("/", async (req, res) => {
  try {
    const { memberId, year, month, amountAir, amountBeban, amountCicilan, total } =
      req.body;

    if (!memberId || !year || !month || total === undefined) {
      res.status(400).json({
        error: "memberId, year, month, and total are required",
      });
      return;
    }

    const payment = await paymentService.recordPayment(
      {
        memberId,
        year: Number(year),
        month: Number(month),
        amountAir: Number(amountAir) || 0,
        amountBeban: Number(amountBeban) || 0,
        amountCicilan: Number(amountCicilan) || 0,
        total: Number(total),
      },
      req.user!.id
    );

    await logAction(
      req.user!.id,
      req.user!.username || req.user!.name,
      "bayar",
      `Terima bayar tagihan ${memberId} (${formatRp(Number(total))})`
    );

    res.status(201).json({ data: payment });
  } catch (error: any) {
    console.error("[Payment] POST /:", error);
    res.status(400).json({ error: error.message });
  }
});

export default router;
