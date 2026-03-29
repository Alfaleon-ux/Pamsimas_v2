import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as workOrderService from "../services/work-order.service.js";
import { logAction } from "../services/audit.service.js";

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/work-orders
 * List all work orders. Admin only.
 */
router.get("/", requireRole("admin"), async (_req, res) => {
  try {
    const orders = await workOrderService.getWorkOrders();
    res.json({ data: orders });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/work-orders
 * Create a new work order (SPK). Admin only.
 */
router.post("/", requireRole("admin"), async (req, res) => {
  try {
    const { memberId, fee, method, tenure } = req.body;

    if (!memberId || !fee || !method) {
      res.status(400).json({
        error: "memberId, fee, and method are required",
      });
      return;
    }

    const order = await workOrderService.createWorkOrder({
      memberId,
      fee: Number(fee),
      method,
      tenure: tenure ? Number(tenure) : undefined,
    });

    await logAction(
      req.user!.id,
      req.user!.username || req.user!.name,
      "buat_spk",
      `Menerbitkan SPK pemasangan untuk ${memberId}`
    );

    res.status(201).json({ data: order });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/work-orders/pending
 * Get pending work orders for field officers.
 */
router.get("/pending", async (_req, res) => {
  try {
    const orders = await workOrderService.getPendingOrders();
    res.json({ data: orders });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/work-orders/:id/complete
 * Mark a work order as installed. Petugas only.
 */
router.put("/:id/complete", async (req, res) => {
  try {
    const { serialNumber } = req.body;

    if (!serialNumber) {
      res.status(400).json({ error: "serialNumber is required" });
      return;
    }

    const updated = await workOrderService.completeWorkOrder(
      req.params.id,
      serialNumber,
      req.user!.id
    );

    if (!updated) {
      res.status(404).json({ error: "Work order not found" });
      return;
    }

    await logAction(
      req.user!.id,
      req.user!.username || req.user!.name,
      "pasang",
      `Menyelesaikan SPK ${req.params.id} (SN: ${serialNumber})`
    );

    res.json({ data: updated });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
