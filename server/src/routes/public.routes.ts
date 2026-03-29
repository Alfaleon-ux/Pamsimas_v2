import { Router } from "express";
import * as memberService from "../services/member.service.js";
import * as billingService from "../services/billing.service.js";
import { getCurrentPeriod } from "../utils/helpers.js";

const router = Router();

// All public routes: NO authentication required

/**
 * GET /api/public/lookup?id=P-001
 * GET /api/public/lookup?name=xxx
 * Lookup member by ID or name (for public portal).
 */
router.get("/lookup", async (req, res) => {
  try {
    const id = req.query.id as string | undefined;
    const name = req.query.name as string | undefined;

    if (!id && !name) {
      res.status(400).json({ error: "Provide ?id= or ?name= parameter" });
      return;
    }

    if (id) {
      const member = await memberService.getMemberById(id);
      if (!member) {
        res.status(404).json({ error: "Pelanggan tidak ditemukan" });
        return;
      }
      // Return limited data (no phone)
      res.json({
        data: [
          {
            id: member.id,
            fullName: member.fullName,
            zone: member.zone,
          },
        ],
      });
      return;
    }

    if (name) {
      const members = await memberService.listMembers(name);
      // Return limited data
      const limited = members.map((m) => ({
        id: m.id,
        fullName: m.fullName,
        zone: m.zone,
      }));

      if (limited.length === 0) {
        res.status(404).json({ error: "Data tidak ditemukan" });
        return;
      }

      res.json({ data: limited });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/public/bill/:memberId
 * Get current month's bill and payment status for a member (public portal).
 */
router.get("/bill/:memberId", async (req, res) => {
  try {
    const { month, year } = getCurrentPeriod();
    const bill = await billingService.getMemberBill(
      req.params.memberId,
      month,
      year
    );

    if (!bill) {
      res.status(404).json({ error: "Data tidak ditemukan" });
      return;
    }

    // Return public-safe bill data (no internal IDs, limited fields)
    res.json({
      data: {
        member: {
          id: bill.member.id,
          fullName: bill.member.fullName,
          zone: bill.member.zone,
        },
        period: { month, year },
        isBilled: bill.isBilled,
        isPaid: bill.isPaid,
        biayaAir: bill.biayaAir,
        biayaBeban: bill.biayaBeban,
        biayaCicilan: bill.biayaCicilan,
        total: bill.total,
        cicilanInfo: bill.cicilanInfo,
        usage: bill.usage
          ? {
              volume: bill.usage.volume,
              currentReading: bill.usage.currentReading,
              photoUrl: bill.usage.photoUrl,
            }
          : null,
        paidAt: bill.paymentRecord?.paidAt || null,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
