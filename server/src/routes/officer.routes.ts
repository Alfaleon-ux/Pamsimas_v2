import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { meterReading, workOrder } from "../db/schema.js";
import { eq, desc, count } from "drizzle-orm";

const router = Router();

// All officer routes require petugas role
router.use(requireAuth, requireRole("petugas"));

/**
 * GET /api/officer/history
 * Get own recording + installation history.
 */
router.get("/history", async (req, res) => {
  try {
    const userId = req.user!.id;

    const readings = await db.query.meterReading.findMany({
      where: eq(meterReading.officerId, userId),
      with: { member: true },
      orderBy: [desc(meterReading.recordedAt)],
      limit: 20,
    });

    const installations = await db.query.workOrder.findMany({
      where: eq(workOrder.officerId, userId),
      with: { member: true },
      orderBy: [desc(workOrder.installedAt)],
      limit: 10,
    });

    res.json({
      data: {
        readings,
        installations,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/officer/stats
 * Get own KPI stats.
 */
router.get("/stats", async (req, res) => {
  try {
    const userId = req.user!.id;

    const [readingCount] = await db
      .select({ count: count() })
      .from(meterReading)
      .where(eq(meterReading.officerId, userId));

    const [installCount] = await db
      .select({ count: count() })
      .from(workOrder)
      .where(eq(workOrder.officerId, userId));

    res.json({
      data: {
        totalReadings: readingCount.count,
        totalInstallations: installCount.count,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
