import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { settings } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { logAction } from "../services/audit.service.js";

const router = Router();

// All settings routes require admin role
router.use(requireAuth, requireRole("admin"));

/**
 * GET /api/settings
 * Get all system settings.
 */
router.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(settings);
    const result: Record<string, string> = {};
    rows.forEach((r) => {
      result[r.key] = r.value;
    });
    res.json({ data: result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/settings
 * Update settings. Body: { water_rate?: string, admin_fee?: string }
 */
router.put("/", async (req, res) => {
  try {
    const updates: { key: string; value: string }[] = [];

    if (req.body.water_rate !== undefined) {
      const val = Number(req.body.water_rate);
      if (val < 0) {
        res.status(400).json({ error: "water_rate cannot be negative" });
        return;
      }
      updates.push({ key: "water_rate", value: String(val) });
    }

    if (req.body.admin_fee !== undefined) {
      const val = Number(req.body.admin_fee);
      if (val < 0) {
        res.status(400).json({ error: "admin_fee cannot be negative" });
        return;
      }
      updates.push({ key: "admin_fee", value: String(val) });
    }

    for (const { key, value } of updates) {
      await db
        .update(settings)
        .set({ value, updatedAt: new Date() })
        .where(eq(settings.key, key));
    }

    await logAction(
      req.user!.id,
      req.user!.username || req.user!.name,
      "setting",
      `Update pengaturan: ${updates.map((u) => `${u.key}=${u.value}`).join(", ")}`
    );

    // Return updated settings
    const rows = await db.select().from(settings);
    const result: Record<string, string> = {};
    rows.forEach((r) => {
      result[r.key] = r.value;
    });

    res.json({ data: result, message: "Settings updated" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
