import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as memberService from "../services/member.service.js";
import { logAction } from "../services/audit.service.js";

const router = Router();

// All member routes require admin role
router.use(requireAuth, requireRole("admin"));

/**
 * GET /api/members
 * List all members with optional search & zone filter.
 */
router.get("/", async (req, res) => {
  try {
    const search = req.query.search as string | undefined;
    const zone = req.query.zone as string | undefined;
    const members = await memberService.listMembers(search, zone);
    res.json({ data: members });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/members/zones
 * Get distinct zones for filter dropdown.
 */
router.get("/zones", async (_req, res) => {
  try {
    const zones = await memberService.getZones();
    res.json({ data: zones });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/members/:id
 * Get a single member by ID.
 */
router.get("/:id", async (req, res) => {
  try {
    const member = await memberService.getMemberById(req.params.id);
    if (!member) {
      res.status(404).json({ error: "Member not found" });
      return;
    }
    res.json({ data: member });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/members
 * Create a new member.
 */
router.post("/", async (req, res) => {
  try {
    const { id, fullName, address, zone, phone, status } = req.body;

    if (!fullName || !address || !zone || !phone) {
      res.status(400).json({ error: "fullName, address, zone, and phone are required" });
      return;
    }

    const member = await memberService.createMember({
      id,
      fullName,
      address,
      zone,
      phone,
      status,
    });

    await logAction(
      req.user!.id,
      req.user!.username || req.user!.name,
      "tambah_warga",
      `Menambah warga baru: ${fullName} (${member.id})`
    );

    res.status(201).json({ data: member });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * PUT /api/members/:id
 * Update a member.
 */
router.put("/:id", async (req, res) => {
  try {
    const { fullName, address, zone, phone, status } = req.body;
    const updated = await memberService.updateMember(req.params.id, {
      fullName,
      address,
      zone,
      phone,
      status,
    });

    if (!updated) {
      res.status(404).json({ error: "Member not found" });
      return;
    }

    await logAction(
      req.user!.id,
      req.user!.username || req.user!.name,
      "edit_warga",
      `Mengedit warga ID: ${req.params.id}`
    );

    res.json({ data: updated });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * DELETE /api/members/:id
 * Delete a member.
 */
router.delete("/:id", async (req, res) => {
  try {
    const deleted = await memberService.deleteMember(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Member not found" });
      return;
    }

    await logAction(
      req.user!.id,
      req.user!.username || req.user!.name,
      "hapus_warga",
      `Menghapus warga ID: ${req.params.id}`
    );

    res.json({ data: deleted, message: "Member deleted" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
