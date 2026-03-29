import { db } from "../db/index.js";
import { member } from "../db/schema.js";
import { eq, ilike, and, or, sql } from "drizzle-orm";
import { generateMemberId } from "../utils/helpers.js";

export interface CreateMemberInput {
  id?: string;
  fullName: string;
  address: string;
  zone: string;
  phone: string;
  status?: string;
}

export interface UpdateMemberInput {
  fullName?: string;
  address?: string;
  zone?: string;
  phone?: string;
  status?: string;
}

/**
 * List all members with optional search and zone filter.
 */
export async function listMembers(search?: string, zone?: string) {
  const conditions = [];

  if (zone) {
    conditions.push(eq(member.zone, zone));
  }

  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(
        ilike(member.id, pattern),
        ilike(member.fullName, pattern),
        ilike(member.address, pattern),
        ilike(member.phone, pattern)
      )!
    );
  }

  if (conditions.length > 0) {
    return db
      .select()
      .from(member)
      .where(and(...conditions))
      .orderBy(member.id);
  }

  return db.select().from(member).orderBy(member.id);
}

/**
 * Get a single member by ID.
 */
export async function getMemberById(id: string) {
  const result = await db.select().from(member).where(eq(member.id, id));
  return result[0] || null;
}

/**
 * Create a new member. Auto-generates ID if not provided.
 */
export async function createMember(data: CreateMemberInput) {
  let memberId = data.id;

  if (!memberId) {
    const existing = await db.select({ id: member.id }).from(member);
    memberId = generateMemberId(existing.map((m) => m.id));
  }

  // Check for duplicate ID
  const existing = await getMemberById(memberId);
  if (existing) {
    throw new Error(`Member ID ${memberId} already exists`);
  }

  const [created] = await db
    .insert(member)
    .values({
      id: memberId,
      fullName: data.fullName,
      address: data.address,
      zone: data.zone,
      phone: data.phone,
      status: data.status || "aktif",
    })
    .returning();

  return created;
}

/**
 * Update an existing member.
 */
export async function updateMember(id: string, data: UpdateMemberInput) {
  const [updated] = await db
    .update(member)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(member.id, id))
    .returning();

  return updated || null;
}

/**
 * Delete a member by ID.
 */
export async function deleteMember(id: string) {
  const [deleted] = await db
    .delete(member)
    .where(eq(member.id, id))
    .returning();
  return deleted || null;
}

/**
 * Get distinct zones for filtering.
 */
export async function getZones(): Promise<string[]> {
  const result = await db
    .selectDistinct({ zone: member.zone })
    .from(member)
    .orderBy(member.zone);
  return result.map((r) => r.zone);
}
