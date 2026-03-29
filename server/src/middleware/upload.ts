import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import crypto from "crypto";

// Multer: Store in memory → upload to Supabase Storage
const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (_req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".webp", ".heic"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} not allowed. Use: ${allowed.join(", ")}`));
    }
  },
});

// Supabase client for storage operations
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const bucketName = process.env.SUPABASE_STORAGE_BUCKET || "meter-photos";

let supabase: ReturnType<typeof createClient> | null = null;

function getSupabase() {
  if (!supabase) {
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
    }
    supabase = createClient(supabaseUrl, supabaseKey);
  }
  return supabase;
}

/**
 * Upload a file buffer to Supabase Storage.
 * Returns the public URL of the uploaded file.
 */
export async function uploadToStorage(
  buffer: Buffer,
  originalName: string,
  folder: string = "readings"
): Promise<string> {
  const client = getSupabase();
  const ext = path.extname(originalName).toLowerCase();
  const uniqueName = `${folder}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`;

  const { error } = await client.storage
    .from(bucketName)
    .upload(uniqueName, buffer, {
      contentType: getContentType(ext),
      upsert: false,
    });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  // Get public URL
  const {
    data: { publicUrl },
  } = client.storage.from(bucketName).getPublicUrl(uniqueName);

  return publicUrl;
}

function getContentType(ext: string): string {
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
  };
  return map[ext] || "application/octet-stream";
}
