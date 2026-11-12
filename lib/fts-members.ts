"use client";

// API-backed ATS member directory. Member accounts are database users with
// staff roles; the member list, profile updates and account creation go
// through /api/ats endpoints. The built-in demo team remains available for
// the sample sign-in shortcuts.

import { fetchAtsMembers, addAtsMember as apiAddAtsMember, updateAtsProfile as apiUpdateAtsProfile, type AtsMemberData } from "@/lib/api-client";
import { students } from "@/lib/student-access";
import { appStorage } from "@/lib/preview-storage";

export type FtsMember = { name: string; email: string; phone: string; year?: string; areas?: string[] };

export const ftsTeam: FtsMember[] = [
  { name: "Vivaan Kanvinde", email: "vivaan.kanvinde@vijaybhoomi.edu.in", phone: "+91 96198 92882", year: "3rd Year" },
  { name: "Leo Dominic Savio Emprayil", email: "emprayil@vijaybhoomi.edu.in", phone: "+91 91751 18092", year: "2nd Year" },
  { name: "Aniket Sao", email: "aniket.sao@vijaybhoomi.edu.in", phone: "+91 91567 37924", year: "2nd Year" },
];

export const FTS_MEMBERS_EVENT = "practice-ready-fts-members-changed";

export const ftsYears = ["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year", "Staff / Not applicable"];
export const ftsAreas = ["Studio & MP Labs", "Live Sound & MPRs"];

function memberFromApi(value: AtsMemberData): FtsMember {
  return {
    name: value.fullName,
    email: value.email,
    phone: value.phone ?? "",
    ...(value.year ? { year: value.year } : {}),
    ...(value.areas.length ? { areas: value.areas } : {}),
  };
}

let cachedMembers: FtsMember[] = [];
let membersInFlight: Promise<void> | null = null;

/** Hydrates the member directory from the backend (staff only). */
export async function refreshFtsMembers(): Promise<void> {
  if (membersInFlight) return membersInFlight;
  membersInFlight = (async () => {
    try {
      const members = await fetchAtsMembers();
      if (!members) return;
      cachedMembers = members.map(memberFromApi);
      if (typeof window !== "undefined") window.dispatchEvent(new Event(FTS_MEMBERS_EVENT));
    } finally {
      membersInFlight = null;
    }
  })();
  return membersInFlight;
}

export function ftsMembers(): FtsMember[] {
  const custom = savedMembers();
  const known = new Set([...ftsTeam, ...custom].map((member) => member.email));
  const server = cachedMembers.filter((member) => !known.has(member.email));
  return [...ftsTeam, ...custom, ...server].map((member) => {
    const profile = profiles()[member.email];
    return profile ? { ...member, ...profile } : member;
  });
}

interface StoredMember extends FtsMember {
  auth: { salt: string; digest: string };
  createdAt: string;
  createdBy: string;
}

const key = "practice-ready-fts-members-v1";
function saved(): StoredMember[] {
  if (typeof appStorage() === "undefined") return [];
  const raw = appStorage().getItem(key);
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value) || value.some((m) => !m || typeof m.name !== "string" || typeof m.email !== "string" || typeof m.auth?.salt !== "string")) return [];
    return value as StoredMember[];
  } catch {
    return [];
  }
}

function savedMembers(): FtsMember[] {
  return saved().map(({ name, email, phone, year, areas }) => ({ name, email, phone, year, areas }));
}

const profileKey = "practice-ready-fts-profiles-v1";
function profiles(): Record<string, { name: string; phone: string; year: string; areas?: string[] }> {
  if (typeof appStorage() === "undefined") return {};
  try {
    return JSON.parse(appStorage().getItem(profileKey) || "{}");
  } catch {
    return {};
  }
}

export function validateFtsProfile(input: Pick<FtsMember, "name" | "phone" | "year" | "areas">) {
  const member = {
    name: input.name.trim(),
    phone: input.phone.trim(),
    year: input.year || "",
    areas: Array.from(new Set(input.areas || [])),
  };
  if (member.name.length < 2) throw Error("Enter the member's full name.");
  if (!/^[+\d\s()-]+$/.test(member.phone) || member.phone.replace(/\D/g, "").length < 10 || member.phone.replace(/\D/g, "").length > 15) {
    throw Error("Enter a phone number with 10–15 digits.");
  }
  if (!ftsYears.includes(member.year)) throw Error("Choose a year of study or Staff / Not applicable.");
  if (!member.areas.length || member.areas.some((area) => !ftsAreas.includes(area))) {
    throw Error("Choose at least one area of responsibility.");
  }
  return member;
}

/** Updates the signed-in staff member's own profile through the backend. */
export async function updateFtsProfile(input: Pick<FtsMember, "name" | "phone" | "year" | "areas">): Promise<FtsMember> {
  const email = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("practice-ready-fts-session-v1") : null;
  const actor = ftsMembers().find((member) => member.email === email);
  if (!actor) throw Error("Sign in as an ATS member to update your account.");
  const profile = validateFtsProfile(input);
  const result = await apiUpdateAtsProfile({ name: profile.name, phone: profile.phone, year: profile.year, areas: profile.areas });
  if (!result.success) throw Error(result.error);
  const updated = { ...actor, ...profile };
  appStorage().setItem(profileKey, JSON.stringify({ ...profiles(), [actor.email]: profile }));
  if (typeof window !== "undefined") window.dispatchEvent(new Event(FTS_MEMBERS_EVENT));
  return updated;
}

/**
 * Demo helper retained for the sample sign-in shortcuts: the demo team signs
 * in through the normal login route with the seeded shared password.
 */
export async function verifyFtsPassword(email: string, password: string): Promise<boolean> {
  email = email.trim().toLowerCase();
  if (ftsTeam.some((m) => m.email === email)) return password === "PracticeReadyFTS123";
  const member = saved().find((m) => m.email === email);
  if (!member) return false;
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new TextEncoder().encode(member.auth.salt), iterations: 100000, hash: "SHA-256" },
    material,
    256,
  );
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, "0")).join("") === member.auth.digest;
}

/** Creates a new ATS member account through the backend (staff only). */
export async function addFtsMember(input: FtsMember, password: string): Promise<FtsMember> {
  const actorEmail = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("practice-ready-fts-session-v1") : null;
  const actor = ftsMembers().find((m) => m.email === actorEmail);
  if (!actor) throw Error("Sign in as an ATS member to add an account.");
  const member = {
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    phone: input.phone.trim(),
    year: input.year,
    areas: input.areas,
  };
  const profile = validateFtsProfile(member);
  if (!/^[^\s@]+@vijaybhoomi\.edu\.in$/.test(member.email)) throw Error("Use a Vijaybhoomi university email.");
  if (password.length < 8) throw Error("Use a password with at least 8 characters.");
  if (ftsMembers().some((m) => m.email === member.email)) throw Error("An ATS account already uses this email.");
  if (students().some((s) => s.email.trim().toLowerCase() === member.email)) {
    throw Error("This email belongs to a student account. Use a separate ATS email.");
  }

  const result = await apiAddAtsMember({
    fullName: profile.name,
    email: member.email,
    phone: profile.phone,
    year: profile.year,
    areas: profile.areas,
    password,
  }, `ats-member-${member.email.replace(/[^a-z0-9]+/g, "-")}`);
  if (!result.success) throw Error(result.error);

  await refreshFtsMembers();
  return { name: profile.name, email: member.email, phone: profile.phone, year: profile.year, areas: profile.areas };
}
