import "dotenv/config";
import { db } from "./index.js";
import { settings } from "./schema.js";
import { auth } from "../auth/index.js";
import { sql } from "drizzle-orm";

/**
 * Seed script: Creates default admin user and system settings.
 * 
 * Run with: npm run db:seed
 */
async function seed() {
  console.log("🌱 Seeding database...\n");

  // 1. Seed default settings
  console.log("  → Seeding system settings...");
  await db
    .insert(settings)
    .values([
      { key: "water_rate", value: "2100" },
      { key: "admin_fee", value: "500" },
    ])
    .onConflictDoNothing();
  console.log("    ✅ Settings seeded (water_rate=2100, admin_fee=500)\n");

  // 2. Create default admin user via Better Auth
  console.log("  → Creating default admin user...");
  try {
    const existing = await auth.api.signInUsername({
      body: {
        username: "admin",
        password: "admin123",
      },
    });

    if (existing) {
      console.log("    ⚠️  Admin user already exists, skipping.\n");
    }
  } catch {
    // User doesn't exist, create it
    try {
      await auth.api.signUpEmail({
        body: {
          name: "Super Admin",
          email: "admin@pamsimas.local",
          password: "admin123",
          username: "admin",
          role: "admin",
        },
      });
      console.log("    ✅ Default admin created:");
      console.log("       Username: admin");
      console.log("       Password: admin123");
      console.log('       Role: admin\n');
    } catch (err: any) {
      if (err.message?.includes("already exists") || err.message?.includes("UNIQUE")) {
        console.log("    ⚠️  Admin user already exists, skipping.\n");
      } else {
        console.error("    ❌ Failed to create admin:", err.message);
      }
    }
  }

  console.log("🎉 Seeding complete!\n");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
