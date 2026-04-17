import app from "./app.js";

const PORT = Number(process.env.PORT) || 3000;

// ---------------------
// Start server (local development only)
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
