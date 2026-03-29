import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { upload, uploadToStorage } from "../middleware/upload.js";
import * as meterReadingService from "../services/meter-reading.service.js";
import { logAction } from "../services/audit.service.js";
import { getCurrentPeriod } from "../utils/helpers.js";

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * GET /api/meter-readings
 * List readings for a period. Admin only.
 */
router.get("/", requireRole("admin"), async (req, res) => {
  try {
    const { month, year } = getCurrentPeriod();
    const m = Number(req.query.month) || month;
    const y = Number(req.query.year) || year;

    const readings = await meterReadingService.getReadings(m, y);
    res.json({ data: readings });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/meter-readings/tasks
 * Get task list for field officers (current month).
 */
router.get("/tasks", async (req, res) => {
  try {
    const { month, year } = getCurrentPeriod();
    const m = Number(req.query.month) || month;
    const y = Number(req.query.year) || year;

    const tasks = await meterReadingService.getTaskList(m, y);

    const doneCount = tasks.filter((t) => t.isDone).length;

    res.json({
      data: tasks,
      summary: {
        total: tasks.length,
        done: doneCount,
        remaining: tasks.length - doneCount,
        progress: tasks.length
          ? Math.round((doneCount / tasks.length) * 100)
          : 0,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/meter-readings
 * Submit a new meter reading (with optional photo).
 * Field officers and admins can submit.
 */
router.post("/", upload.single("photo"), async (req, res) => {
  try {
    const { memberId, currentReading } = req.body;
    const { month, year } = getCurrentPeriod();  
    const m = Number(req.body.month) || month;
    const y = Number(req.body.year) || year;

    if (!memberId || currentReading === undefined) {
      res.status(400).json({
        error: "memberId and currentReading are required",
      });
      return;
    }

    // Upload photo if present
    let photoUrl: string | undefined;
    if (req.file) {
      photoUrl = await uploadToStorage(
        req.file.buffer,
        req.file.originalname,
        `readings/${y}/${m}`
      );
    }

    const reading = await meterReadingService.submitReading(
      {
        memberId,
        year: y,
        month: m,
        currentReading: Number(currentReading),
        photoUrl,
      },
      req.user!.id
    );

    await logAction(
      req.user!.id,
      req.user!.username || req.user!.name,
      "catat",
      `Mencatat meteran ${memberId} (${reading.volume} m³)`
    );

    res.status(201).json({ data: reading });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
