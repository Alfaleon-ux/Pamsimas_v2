import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as reportService from "../services/report.service.js";
import { getCurrentPeriod } from "../utils/helpers.js";

const router = Router();

// All report routes require admin role
router.use(requireAuth, requireRole("admin"));

/**
 * GET /api/reports/dashboard
 * Get dashboard KPI summary.
 */
router.get("/dashboard", async (req, res) => {
  try {
    const { month, year } = getCurrentPeriod();
    const m = Number(req.query.month) || month;
    const y = Number(req.query.year) || year;

    const kpis = await reportService.getDashboardKPIs(m, y);
    res.json({ data: kpis });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/reports/financial
 * Get annual financial report (12-month breakdown).
 */
router.get("/financial", async (req, res) => {
  try {
    const { year } = getCurrentPeriod();
    const y = Number(req.query.year) || year;

    const report = await reportService.getFinancialReport(y);
    res.json({ data: report });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/reports/chart
 * Get 6-month revenue chart data.
 */
router.get("/chart", async (req, res) => {
  try {
    const { month, year } = getCurrentPeriod();
    const m = Number(req.query.month) || month;
    const y = Number(req.query.year) || year;

    const chart = await reportService.getRevenueChart(m, y);
    res.json({ data: chart });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
