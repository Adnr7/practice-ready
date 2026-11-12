import type { D1Database } from "@cloudflare/workers-types";
import { hasTable } from "./schema-capabilities.ts";

export const GUIDELINES_VERSION = "2026-11-04";
export const GUIDELINES_TITLE = "Booking & equipment guidelines";
export const GUIDELINES_AGREEMENT = "I have read and agree to follow the booking and equipment guidelines.";

export async function hasGuidelinesSchema(db: D1Database): Promise<boolean> {
  return hasTable(db, "guideline_acceptances");
}

export async function getGuidelineAcceptance(
  db: D1Database,
  userId: number,
  version = GUIDELINES_VERSION,
): Promise<{ id: number; userId: number; version: string; acceptedAt: string } | null> {
  return db
    .prepare(
      `SELECT id, user_id AS userId, version, accepted_at AS acceptedAt
       FROM guideline_acceptances WHERE user_id = ? AND version = ? LIMIT 1`,
    )
    .bind(userId, version)
    .first<{ id: number; userId: number; version: string; acceptedAt: string }>();
}

export async function acceptGuidelines(
  db: D1Database,
  userId: number,
  version = GUIDELINES_VERSION,
): Promise<{ id: number; userId: number; version: string; acceptedAt: string }> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO guideline_acceptances (user_id, version, accepted_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id, version) DO NOTHING`,
    )
    .bind(userId, version, now)
    .run();
  const row = await getGuidelineAcceptance(db, userId, version);
  if (!row) throw new Error("Failed to record guideline acceptance.");
  return row;
}
