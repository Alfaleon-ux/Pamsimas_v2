import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as installmentService from "../services/installment.service.js";

const router = Router();

// All installment routes require admin role
router.use(requireAuth, requireRole("admin"));

/**
 * GET /api/installments
 * List all installments (optionally filtered by status).
 */
router.get("/", async (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const installments = await installmentService.getInstallments(status);
    res.json({ data: installments });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/installments/:memberId
 * Get installment for a specific member.
 */
router.get("/:memberId", async (req, res) => {
  try {
    const installment = await installmentService.getMemberInstallment(
      req.params.memberId
    );
    if (!installment) {
      res.status(404).json({ error: "No installment found for this member" });
      return;
    }
    res.json({ data: installment });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
