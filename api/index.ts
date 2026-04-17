import type { VercelRequest, VercelResponse } from "@vercel/node";
import app from "../server/src/app.js";

// Vercel Serverless Function: catch-all handler
// Routes all /api/* requests through the Express app
export default function handler(req: VercelRequest, res: VercelResponse) {
  // @ts-ignore — Express app is compatible with Node http handler
  return app(req, res);
}
