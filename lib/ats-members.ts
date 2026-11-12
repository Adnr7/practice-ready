import type { D1Database } from "@cloudflare/workers-types";
import { hashPassword } from "./auth.ts";
import { FrontendWorkflowError } from "./frontend-workflows.ts";
import { hasAllColumns } from "./schema-capabilities.ts";

export const ATS_YEARS = [
  "1st Year",
  "2nd Year",
  "3rd Year",
  "4th Year",
  "5th Year",
  "Staff / Not applicable",
] as const;

export const ATS_AREAS = [
  "Studio & MP Labs",
  "Live Sound & MPRs",
] as const;

export interface AtsMember {
  id: number;
  email: string;
  fullName: string;
  phone: string | null;
  year: string | null;
  areas: string[];
  role: "technician" | "admin";
  createdAt: string;
}

function parseAreas(json: string): string[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function serializeAreas(areas: string[]): string {
  return JSON.stringify(areas);
}

export async function hasAtsMembersSchema(db: D1Database): Promise<boolean> {
  return hasAllColumns(db, "users", [
    "year_of_study",
    "responsibility_areas",
  ]);
}

export async function listAtsMembers(
  db: D1Database,
): Promise<AtsMember[]> {
  const rows = await db
    .prepare(
      `SELECT id, email, full_name AS fullName, phone, year_of_study AS year,
              responsibility_areas AS areas, role, created_at AS createdAt
       FROM users
       WHERE role IN ('technician', 'admin') AND is_active = 1
         AND (deleted_at IS NULL OR deleted_at = '')
       ORDER BY full_name`,
    )
    .all<{
      id: number;
      email: string;
      fullName: string;
      phone: string | null;
      year: string | null;
      areas: string;
      role: "technician" | "admin";
      createdAt: string;
    }>();
  return rows.results.map((r) => ({
    ...r,
    year: r.year ?? null,
    areas: parseAreas(r.areas),
  }));
}

export function validateAtsProfile(input: {
  name?: string;
  phone?: string;
  year?: string;
  areas?: string[];
}): {
  name: string;
  phone: string;
  year: string;
  areas: string[];
} {
  const name = input.name?.trim() ?? "";
  const phone = input.phone?.trim() ?? "";
  const year = input.year ?? "";
  const areas = Array.isArray(input.areas) ? input.areas : [];

  if (name.length < 2) {
    throw new FrontendWorkflowError("Enter the member's full name.", 400, "NAME_TOO_SHORT");
  }
  const digits = phone.replace(/\D/g, "");
  if (!/^[+\d\s()-]+$/.test(phone) || digits.length < 10 || digits.length > 15) {
    throw new FrontendWorkflowError(
      "Enter a phone number with 10–15 digits.",
      400,
      "INVALID_PHONE",
    );
  }
  if (!ATS_YEARS.includes(year as typeof ATS_YEARS[number])) {
    throw new FrontendWorkflowError("Choose a year of study or Staff / Not applicable.", 400, "INVALID_YEAR");
  }
  if (!areas.length || areas.some((a) => !ATS_AREAS.includes(a as typeof ATS_AREAS[number]))) {
    throw new FrontendWorkflowError("Choose at least one area of responsibility.", 400, "INVALID_AREAS");
  }
  return { name, phone, year, areas };
}

export async function updateAtsProfile(
  db: D1Database,
  actor: { userId: number; role: "student" | "technician" | "admin" },
  input: { name?: string; phone?: string; year?: string; areas?: string[] },
): Promise<AtsMember> {
  if (actor.role !== "technician" && actor.role !== "admin") {
    throw new FrontendWorkflowError("Only staff can update profiles.", 403, "FORBIDDEN");
  }
  const profile = validateAtsProfile(input);
  await db
    .prepare(
      `UPDATE users
       SET full_name = ?, phone = ?, year_of_study = ?, responsibility_areas = ?
       WHERE id = ? AND role IN ('technician', 'admin')
         AND (deleted_at IS NULL OR deleted_at = '')`,
    )
    .bind(profile.name, profile.phone, profile.year, serializeAreas(profile.areas), actor.userId)
    .run();

  const row = await db
    .prepare(
      `SELECT id, email, full_name AS fullName, phone, year_of_study AS year,
              responsibility_areas AS areas, role, created_at AS createdAt
       FROM users WHERE id = ? LIMIT 1`,
    )
    .bind(actor.userId)
    .first<{
      id: number;
      email: string;
      fullName: string;
      phone: string | null;
      year: string | null;
      areas: string;
      role: "technician" | "admin";
      createdAt: string;
    }>();
  if (!row) throw new FrontendWorkflowError("Profile not found.", 404, "NOT_FOUND");
  return {
    ...row,
    year: row.year ?? null,
    areas: parseAreas(row.areas),
  };
}

export interface AddAtsMemberInput {
  fullName: string;
  email: string;
  phone: string;
  year: string;
  areas: string[];
  password: string;
}

export async function addAtsMember(
  db: D1Database,
  actor: { userId: number; role: "student" | "technician" | "admin" },
  input: AddAtsMemberInput,
): Promise<AtsMember> {
  if (actor.role !== "technician" && actor.role !== "admin") {
    throw new FrontendWorkflowError("Only staff can add members.", 403, "FORBIDDEN");
  }
  const email = input.email.trim().toLowerCase();
  const profile = validateAtsProfile({
    name: input.fullName,
    phone: input.phone,
    year: input.year,
    areas: input.areas,
  });

  if (!/^[^\s@]+@vijaybhoomi\.edu\.in$/.test(email)) {
    throw new FrontendWorkflowError("Use a Vijaybhoomi university email.", 400, "INVALID_EMAIL");
  }
  if (input.password.length < 8) {
    throw new FrontendWorkflowError("Use a password with at least 8 characters.", 400, "PASSWORD_TOO_SHORT");
  }

  const existing = await db
    .prepare("SELECT id FROM users WHERE email = ? LIMIT 1")
    .bind(email)
    .first<{ id: number }>();
  if (existing) {
    throw new FrontendWorkflowError(
      "An account with this email already exists.",
      409,
      "EMAIL_EXISTS",
    );
  }

  const { hash, salt } = await hashPassword(input.password);
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `INSERT INTO users (email, password_hash, salt, full_name, phone, role, is_active,
                          year_of_study, responsibility_areas, created_at)
       VALUES (?, ?, ?, ?, ?, 'technician', 1, ?, ?, ?)`,
    )
    .bind(
      email,
      hash,
      salt,
      profile.name,
      profile.phone,
      profile.year,
      serializeAreas(profile.areas),
      now,
    )
    .run();
  if (result.meta.changes !== 1) {
    throw new FrontendWorkflowError("Failed to create account.", 500, "INSERT_FAILED");
  }

  const row = await db
    .prepare(
      `SELECT id, email, full_name AS fullName, phone, year_of_study AS year,
              responsibility_areas AS areas, role, created_at AS createdAt
       FROM users WHERE id = last_insert_rowid() LIMIT 1`,
    )
    .first<{
      id: number;
      email: string;
      fullName: string;
      phone: string | null;
      year: string | null;
      areas: string;
      role: "technician" | "admin";
      createdAt: string;
    }>();
  if (!row) throw new FrontendWorkflowError("Account not found after insert.", 500, "FETCH_FAILED");
  return {
    ...row,
    year: row.year ?? null,
    areas: parseAreas(row.areas),
  };
}
