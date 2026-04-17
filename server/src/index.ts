import "dotenv/config";
import express from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth/index.js";
import { getRecentLogs } from "./services/audit.service.js";
import { requireAuth, requireRole } from "./middleware/auth.js";

// Route imports
import memberRoutes from "./routes/member.routes.js";
import meterReadingRoutes from "./routes/meter-reading.routes.js";
import billingRoutes from "./routes/billing.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import installmentRoutes from "./routes/installment.routes.js";
import workOrderRoutes from "./routes/work-order.routes.js";
import reportRoutes from "./routes/report.routes.js";
import settingsRoutes from "./routes/settings.routes.js";
import publicRoutes from "./routes/public.routes.js";
import officerRoutes from "./routes/officer.routes.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// ---------------------
// CORS
// ---------------------
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",")
  : ["http://localhost:5500", "http://127.0.0.1:5500"];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ---------------------
// Better Auth handler
// MUST be before express.json() middleware
// ---------------------
app.all("/api/auth/*splat", toNodeHandler(auth));

// ---------------------
// JSON body parser (after auth handler)
// ---------------------
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ---------------------
// API Routes
// ---------------------

// Public (no auth)
app.use("/api/public", publicRoutes);

// Admin routes
app.use("/api/members", memberRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/installments", installmentRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/settings", settingsRoutes);

// Mixed auth (per-endpoint role checks)
app.use("/api/meter-readings", meterReadingRoutes);
app.use("/api/work-orders", workOrderRoutes);

// Officer routes
app.use("/api/officer", officerRoutes);

// Audit logs (admin only, simple inline handler)
app.get(
  "/api/logs",
  requireAuth,
  requireRole("admin"),
  async (_req, res) => {
    try {
      const logs = await getRecentLogs(100);
      res.json({ data: logs });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
);

// ---------------------
// Health check
// ---------------------
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "Pamsimas API",
    timestamp: new Date().toISOString(),
  });
});

// ---------------------
// 404 handler
// ---------------------
app.use("/api/*splat", (_req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// ---------------------
// Global error handler
// ---------------------
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
);

// ---------------------
// Start server
// ---------------------
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   🚰 Pamsimas API Server                ║
  ║   Running on http://localhost:${PORT}       ║
  ║   Auth:     /api/auth/*                  ║
  ║   API:      /api/*                       ║
  ║   Health:   /api/health                  ║
  ╚══════════════════════════════════════════╝
  `);
});

export default app;
