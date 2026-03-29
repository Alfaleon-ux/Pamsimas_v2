import { db } from "../db/index.js";
import { meterReading, member } from "../db/schema.js";
import { eq, and, desc, ne } from "drizzle-orm";
import { generateReadingId } from "../utils/helpers.js";

export interface SubmitReadingInput {
  memberId: string;
  year: number;
  month: number;
  currentReading: number;
  photoUrl?: string;
}

/**
 * Get meter readings for a specific period.
 */
export async function getReadings(month: number, year: number) {
  return db.query.meterReading.findMany({
    where: and(
      eq(meterReading.month, month),
      eq(meterReading.year, year)
    ),
    with: {
      member: true,
      officer: {
        columns: { id: true, name: true, username: true },
      },
    },
    orderBy: [meterReading.memberId],
  });
}

/**
 * Submit a new meter reading.
 * Validates that currentReading >= prevReading.
 */
export async function submitReading(
  data: SubmitReadingInput,
  officerId: string
) {
  // Check if reading already exists for this period
  const existingId = generateReadingId(data.memberId, data.year, data.month);
  const existing = await db
    .select()
    .from(meterReading)
    .where(eq(meterReading.id, existingId));

  if (existing.length > 0) {
    throw new Error(
      `Reading already exists for ${data.memberId} in ${data.month}/${data.year}`
    );
  }

  // Get previous reading
  const prevReadings = await db
    .select()
    .from(meterReading)
    .where(eq(meterReading.memberId, data.memberId))
    .orderBy(desc(meterReading.year), desc(meterReading.month))
    .limit(1);

  const prevReading = prevReadings.length > 0 ? prevReadings[0].currentReading : 0;

  if (data.currentReading < prevReading) {
    throw new Error(
      `Current reading (${data.currentReading}) cannot be less than previous reading (${prevReading})`
    );
  }

  const volume = data.currentReading - prevReading;

  const [created] = await db
    .insert(meterReading)
    .values({
      id: existingId,
      memberId: data.memberId,
      year: data.year,
      month: data.month,
      prevReading,
      currentReading: data.currentReading,
      volume,
      photoUrl: data.photoUrl || null,
      officerId,
    })
    .returning();

  return created;
}

/**
 * Get task list for field officers.
 * Returns all active members with their completion status for the current month.
 */
export async function getTaskList(month: number, year: number) {
  const members = await db
    .select()
    .from(member)
    .where(ne(member.status, "nonaktif"))
    .orderBy(member.zone, member.id);

  const readings = await db
    .select()
    .from(meterReading)
    .where(
      and(eq(meterReading.month, month), eq(meterReading.year, year))
    );

  const readingMap = new Map(
    readings.map((r) => [r.memberId, r])
  );

  return members.map((m) => {
    const reading = readingMap.get(m.id);
    return {
      ...m,
      isDone: !!reading,
      readData: reading || null,
    };
  });
}
