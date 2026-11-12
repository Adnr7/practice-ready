import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { FrontendWorkflowError } from "./frontend-workflows.ts";
import { hasAllColumns, hasTable } from "./schema-capabilities.ts";

export type IncidentKind = "no-show" | "unreported-damage" | "late-return";
export type RestrictionScope = "equipment" | "facilities";

export interface IncidentRow {
  id: number;
  userId: number;
  kind: IncidentKind;
  reference: string;
  description: string;
  explanation: string;
  decision: "confirmed" | "justified";
  review: string;
  recordedByUserId: number;
  createdAt: string;
}

export interface RestrictionRow {
  id: number;
  userId: number;
  scope: RestrictionScope;
  reason: string;
  startsAt: string;
  endsAt: string;
  createdByUserId: number;
  createdAt: string;
  liftedAt: string | null;
  liftedByUserId: number | null;
  liftReason: string | null;
}

export interface Incident extends IncidentRow {
  email: string;
  name: string;
  recordedBy: string;
}

export interface Restriction extends RestrictionRow {
  email: string;
  name: string;
  createdBy: string;
  liftedBy: string | null;
}

export function incidentLabel(kind: IncidentKind): string {
  return kind === "no-show"
    ? "No-show"
    : kind === "late-return"
      ? "Late equipment return"
      : "Unreported equipment damage";
}

export async function hasAtsAccessSchema(db: D1Database): Promise<boolean> {
  return (
    (await hasAllColumns(db, "users", [
      "deleted_at",
      "deleted_by_user_id",
      "deletion_reason",
    ])) &&
    (await hasTable(db, "student_incidents")) &&
    (await hasTable(db, "student_restrictions"))
  );
}

async function formatRestriction(
  db: D1Database,
  row: RestrictionRow,
): Promise<Restriction> {
  const user = await db
    .prepare("SELECT email, full_name AS name FROM users WHERE id = ? LIMIT 1")
    .bind(row.userId)
    .first<{ email: string; name: string }>();
  const createdBy = await db
    .prepare("SELECT full_name AS name FROM users WHERE id = ? LIMIT 1")
    .bind(row.createdByUserId)
    .first<{ name: string }>();
  let liftedBy: string | null = null;
  if (row.liftedByUserId) {
    const lb = await db
      .prepare("SELECT full_name AS name FROM users WHERE id = ? LIMIT 1")
      .bind(row.liftedByUserId)
      .first<{ name: string }>();
    liftedBy = lb?.name ?? null;
  }
  return {
    ...row,
    email: user?.email ?? "",
    name: user?.name ?? "",
    createdBy: createdBy?.name ?? "",
    liftedBy,
  };
}

async function formatIncident(
  db: D1Database,
  row: IncidentRow,
): Promise<Incident> {
  const user = await db
    .prepare("SELECT email, full_name AS name FROM users WHERE id = ? LIMIT 1")
    .bind(row.userId)
    .first<{ email: string; name: string }>();
  const recordedBy = await db
    .prepare("SELECT full_name AS name FROM users WHERE id = ? LIMIT 1")
    .bind(row.recordedByUserId)
    .first<{ name: string }>();
  return {
    ...row,
    email: user?.email ?? "",
    name: user?.name ?? "",
    recordedBy: recordedBy?.name ?? "",
  };
}

export async function findActiveStudentByEmail(
  db: D1Database,
  email: string,
): Promise<{ id: number; email: string; fullName: string } | null> {
  return db
    .prepare(
      `SELECT id, email, full_name AS fullName FROM users
       WHERE email = ? AND role = 'student' AND is_active = 1
         AND (deleted_at IS NULL OR deleted_at = '')
       LIMIT 1`,
    )
    .bind(email.toLowerCase().trim())
    .first<{ id: number; email: string; fullName: string }>();
}

export async function findStudentById(
  db: D1Database,
  userId: number,
): Promise<{ id: number; email: string; fullName: string; role: string; deletedAt: string | null } | null> {
  return db
    .prepare(
      `SELECT id, email, full_name AS fullName, role, deleted_at AS deletedAt
       FROM users WHERE id = ? LIMIT 1`,
    )
    .bind(userId)
    .first<{
      id: number;
      email: string;
      fullName: string;
      role: string;
      deletedAt: string | null;
    }>();
}

export async function accountDeletedMessage(
  db: D1Database,
  userId: number,
): Promise<string | null> {
  const user = await findStudentById(db, userId);
  if (!user) return null;
  if (
    user.deletedAt &&
    user.deletedAt.trim() !== "" &&
    user.deletedAt !== "NULL"
  ) {
    return "This account was deleted by ATS. Contact ATS for assistance.";
  }
  return null;
}

export async function confirmedIncidentCount(
  db: D1Database,
  userId: number,
  kind: IncidentKind,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT count(*) AS count FROM student_incidents
       WHERE user_id = ? AND kind = ? AND decision = 'confirmed'`,
    )
    .bind(userId, kind)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

function formatDateLocal(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export async function activeFacilitiesRestriction(
  db: D1Database,
  userId: number,
  nowMs: number,
): Promise<Restriction | null> {
  const now = new Date(nowMs).toISOString();
  const row = await db
    .prepare(
      `SELECT id, user_id AS userId, scope, reason, starts_at AS startsAt, ends_at AS endsAt,
              created_by_user_id AS createdByUserId, created_at AS createdAt,
              lifted_at AS liftedAt, lifted_by_user_id AS liftedByUserId, lift_reason AS liftReason
       FROM student_restrictions
       WHERE user_id = ? AND scope = 'facilities' AND lifted_at IS NULL
         AND starts_at <= ? AND ends_at > ?
       LIMIT 1`,
    )
    .bind(userId, now, now)
    .first<RestrictionRow>();
  if (!row) return null;
  return formatRestriction(db, row);
}

export async function activeEquipmentRestriction(
  db: D1Database,
  userId: number,
  nowMs: number,
): Promise<Restriction | null> {
  const now = new Date(nowMs).toISOString();
  const row = await db
    .prepare(
      `SELECT id, user_id AS userId, scope, reason, starts_at AS startsAt, ends_at AS endsAt,
              created_by_user_id AS createdByUserId, created_at AS createdAt,
              lifted_at AS liftedAt, lifted_by_user_id AS liftedByUserId, lift_reason AS liftReason
       FROM student_restrictions
       WHERE user_id = ? AND scope = 'equipment' AND lifted_at IS NULL
         AND starts_at <= ? AND ends_at > ?
       LIMIT 1`,
    )
    .bind(userId, now, now)
    .first<RestrictionRow>();
  if (!row) return null;
  return formatRestriction(db, row);
}

export async function accessIssue(
  db: D1Database,
  userId: number,
  nowMs: number,
): Promise<string | null> {
  if (!(await hasAtsAccessSchema(db))) return null;
  const deleted = await accountDeletedMessage(db, userId);
  if (deleted) return deleted;
  const restriction = await activeFacilitiesRestriction(db, userId, nowMs);
  if (restriction) {
    return `TSM facility access is restricted until ${formatDateLocal(restriction.endsAt)}. You can review the reason and contact ATS in Reports & Support.`;
  }
  return null;
}

export async function equipmentMoveIssue(
  db: D1Database,
  userId: number,
  nowMs: number,
): Promise<string | null> {
  if (!(await hasAtsAccessSchema(db))) return null;
  const issue = await accessIssue(db, userId, nowMs);
  if (issue) return issue;
  const restriction = await activeEquipmentRestriction(db, userId, nowMs);
  if (restriction) {
    return `New equipment moves are restricted until ${formatDateLocal(restriction.endsAt)}. Returns and room bookings remain available.`;
  }
  return null;
}

export interface LateReturnCandidate {
  userId?: number;
  reference: string;
  movementId: number;
  equipmentId: number;
  equipmentCode: string;
  deadline: string;
  returnedAt: string;
  lateMs: number;
  description: string;
}

export async function lateReturnCandidates(
  db: D1Database,
  userId: number,
): Promise<LateReturnCandidate[]> {
  const rows = await db
    .prepare(
      `SELECT m.id AS movementId, m.equipment_id AS equipmentId, e.equipment_id AS equipmentCode,
              m.expected_return_at AS expectedReturnAt, m.returned_at AS returnedAt
       FROM equipment_movements m
       JOIN equipment e ON e.id = m.equipment_id
       WHERE m.moved_by_user_id = ? AND m.status = 'returned'
         AND m.expected_return_at IS NOT NULL AND m.returned_at IS NOT NULL
         AND m.returned_at > m.expected_return_at
       ORDER BY m.moved_at ASC`,
    )
    .bind(userId)
    .all<{
      movementId: number;
      equipmentId: number;
      equipmentCode: string;
      expectedReturnAt: string;
      returnedAt: string;
    }>();

  const candidates: LateReturnCandidate[] = [];
  for (const row of rows.results) {
    const ref = `MOVE:${row.movementId}`;
    const existing = await db
      .prepare(
        `SELECT id FROM student_incidents WHERE user_id = ? AND kind = 'late-return' AND reference = ? LIMIT 1`,
      )
      .bind(userId, ref)
      .first();
    if (existing) continue;
    const lateMs = new Date(row.returnedAt).getTime() - new Date(row.expectedReturnAt).getTime();
    candidates.push({
      userId,
      reference: ref,
      movementId: row.movementId,
      equipmentId: row.equipmentId,
      equipmentCode: row.equipmentCode,
      deadline: row.expectedReturnAt,
      returnedAt: row.returnedAt,
      lateMs,
      description: `${row.equipmentCode}: return deadline ${formatDateLocal(row.expectedReturnAt)}; return recorded ${formatDateLocal(row.returnedAt)}. Move ${row.movementId}.`,
    });
  }
  return candidates;
}

export interface AccessData {
  incidents: Incident[];
  restrictions: Restriction[];
  lateReturns: LateReturnCandidate[];
}

export async function listStudentAccess(
  db: D1Database,
  userId: number,
): Promise<AccessData> {
  const incidentRows = await db
    .prepare(
      `SELECT id, user_id AS userId, kind, reference, description, explanation, decision, review,
              recorded_by_user_id AS recordedByUserId, created_at AS createdAt
       FROM student_incidents WHERE user_id = ? ORDER BY created_at DESC`,
    )
    .bind(userId)
    .all<IncidentRow>();

  const restrictionRows = await db
    .prepare(
      `SELECT id, user_id AS userId, scope, reason, starts_at AS startsAt, ends_at AS endsAt,
              created_by_user_id AS createdByUserId, created_at AS createdAt,
              lifted_at AS liftedAt, lifted_by_user_id AS liftedByUserId, lift_reason AS liftReason
       FROM student_restrictions WHERE user_id = ? ORDER BY created_at DESC`,
    )
    .bind(userId)
    .all<RestrictionRow>();

  const incidents = await Promise.all(incidentRows.results.map((r) => formatIncident(db, r)));
  const restrictions = await Promise.all(restrictionRows.results.map((r) => formatRestriction(db, r)));
  const lateReturns = await lateReturnCandidates(db, userId);
  return { incidents, restrictions, lateReturns };
}

export async function listAllAccess(db: D1Database): Promise<AccessData> {
  const incidentRows = await db
    .prepare(
      `SELECT id, user_id AS userId, kind, reference, description, explanation, decision, review,
              recorded_by_user_id AS recordedByUserId, created_at AS createdAt
       FROM student_incidents ORDER BY created_at DESC`,
    )
    .all<IncidentRow>();

  const restrictionRows = await db
    .prepare(
      `SELECT id, user_id AS userId, scope, reason, starts_at AS startsAt, ends_at AS endsAt,
              created_by_user_id AS createdByUserId, created_at AS createdAt,
              lifted_at AS liftedAt, lifted_by_user_id AS liftedByUserId, lift_reason AS liftReason
       FROM student_restrictions ORDER BY created_at DESC`,
    )
    .all<RestrictionRow>();

  const lateReturnRows = await db
    .prepare(
      `SELECT m.id AS movementId, m.moved_by_user_id AS userId, m.equipment_id AS equipmentId,
              e.equipment_id AS equipmentCode,
              m.expected_return_at AS expectedReturnAt, m.returned_at AS returnedAt
       FROM equipment_movements m
       JOIN equipment e ON e.id = m.equipment_id
       JOIN users u ON u.id = m.moved_by_user_id
       WHERE m.status = 'returned' AND u.role = 'student'
         AND m.expected_return_at IS NOT NULL AND m.returned_at IS NOT NULL
         AND m.returned_at > m.expected_return_at
       ORDER BY m.moved_at ASC`,
    )
    .all<{
      movementId: number;
      userId: number;
      equipmentId: number;
      equipmentCode: string;
      expectedReturnAt: string;
      returnedAt: string;
    }>();

  const reviewed = await db
    .prepare(
      `SELECT user_id AS userId, reference FROM student_incidents WHERE kind = 'late-return'`,
    )
    .all<{ userId: number; reference: string }>();
  const reviewedKeys = new Set(reviewed.results.map((r) => `${r.userId}:${r.reference}`));

  const incidents = await Promise.all(incidentRows.results.map((r) => formatIncident(db, r)));
  const restrictions = await Promise.all(restrictionRows.results.map((r) => formatRestriction(db, r)));
  const lateReturns = lateReturnRows.results
    .filter((row) => !reviewedKeys.has(`${row.userId}:MOVE:${row.movementId}`))
    .map((row) => ({
      userId: row.userId,
      reference: `MOVE:${row.movementId}`,
      movementId: row.movementId,
      equipmentId: row.equipmentId,
      equipmentCode: row.equipmentCode,
      deadline: row.expectedReturnAt,
      returnedAt: row.returnedAt,
      lateMs: new Date(row.returnedAt).getTime() - new Date(row.expectedReturnAt).getTime(),
      description: `${row.equipmentCode}: return deadline ${formatDateLocal(row.expectedReturnAt)}; return recorded ${formatDateLocal(row.returnedAt)}. Move ${row.movementId}.`,
    }));
  return { incidents, restrictions, lateReturns };
}

export interface RecordIncidentInput {
  userId: number;
  kind: IncidentKind;
  reference: string;
  description: string;
  explanation: string;
  decision: "confirmed" | "justified";
  review: string;
  restrictionStartsAt?: string;
  restrictionEndsAt?: string;
}

export async function recordIncident(
  db: D1Database,
  actor: { userId: number; role: "student" | "technician" | "admin" },
  input: RecordIncidentInput,
): Promise<{ incident: Incident; restriction?: Restriction }> {
  const { userId, kind, reference, description, explanation, decision, review, restrictionStartsAt, restrictionEndsAt } = input;

  const student = await findStudentById(db, userId);
  if (!student) throw new FrontendWorkflowError("Student account not found.", 404, "USER_NOT_FOUND");
  if (student.role !== "student") throw new FrontendWorkflowError("Only student accounts can have incidents recorded.", 400, "INVALID_USER_ROLE");
  if (student.deletedAt && student.deletedAt.trim() !== "" && student.deletedAt !== "NULL") {
    throw new FrontendWorkflowError("This account was deleted by ATS. Cannot record incidents.", 400, "ACCOUNT_DELETED");
  }

  for (const [label, val] of [
    ["Reference", reference],
    ["Description", description],
    ["Explanation", explanation],
    ["Review", review],
  ] as [string, string][]) {
    if (val.trim().length < 5) {
      throw new FrontendWorkflowError(`${label} must be at least 5 characters.`, 400, "FIELD_TOO_SHORT");
    }
  }

  if (!["no-show", "unreported-damage", "late-return"].includes(kind)) {
    throw new FrontendWorkflowError("Choose an incident category.", 400, "INVALID_INCIDENT_KIND");
  }
  if (!["confirmed", "justified"].includes(decision)) {
    throw new FrontendWorkflowError("Choose a review decision.", 400, "INVALID_DECISION");
  }

  const existingRef = await db
    .prepare(
      `SELECT id FROM student_incidents
       WHERE user_id = ? AND kind = ? AND lower(reference) = lower(?) LIMIT 1`,
    )
    .bind(userId, kind, reference.trim())
    .first();
  if (existingRef) {
    throw new FrontendWorkflowError(
      "This incident reference was already reviewed for this student and category.",
      409,
      "DUPLICATE_INCIDENT",
    );
  }

  if (kind === "late-return") {
    const candidates = await lateReturnCandidates(db, userId);
    if (!candidates.some((c) => c.reference === reference.trim())) {
      throw new FrontendWorkflowError(
        "Choose an unreviewed late equipment return.",
        400,
        "INVALID_LATE_RETURN_REFERENCE",
      );
    }
  }

  const now = new Date().toISOString();
  const nowMs = Date.now();

  // The restriction insert runs in the SAME D1 batch as the incident insert and
  // re-counts confirmed incidents inside the transaction, so a concurrent review
  // can never leave an orphaned restriction or skip a required one. The unique
  // (user, kind, reference) index makes a duplicate review roll the whole batch back.
  let restrictionInsert: D1PreparedStatement | null = null;
  let restrictionScope: RestrictionScope = "facilities";
  let restrictionReason = "";
  if (decision === "confirmed") {
    const count = await confirmedIncidentCount(db, userId, kind);
    if (count + 1 >= 3) {
      if (!restrictionStartsAt || !restrictionEndsAt) {
        throw new FrontendWorkflowError(
          "A restriction period is required for the third or later confirmed incident.",
          400,
          "RESTRICTION_PERIOD_REQUIRED",
        );
      }
      const startMs = Date.parse(restrictionStartsAt);
      const endMs = Date.parse(restrictionEndsAt);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        throw new FrontendWorkflowError("Choose a valid restriction period.", 400, "INVALID_DATES");
      }
      if (startMs < nowMs - 60_000) {
        throw new FrontendWorkflowError(
          "Choose a restriction start time that is now or later.",
          400,
          "RESTRICTION_START_IN_PAST",
        );
      }
      if (endMs <= Math.max(startMs, nowMs)) {
        throw new FrontendWorkflowError(
          "Choose an end time that is after the start and now.",
          400,
          "RESTRICTION_END_INVALID",
        );
      }
      restrictionScope = kind === "late-return" ? "equipment" : "facilities";
      restrictionReason = `${incidentLabel(kind)}: ${review.trim()}`;
      restrictionInsert = db
        .prepare(
          `INSERT INTO student_restrictions (user_id, scope, reason, starts_at, ends_at, created_by_user_id, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?
           WHERE (SELECT count(*) FROM student_incidents
                  WHERE user_id = ? AND kind = ? AND decision = 'confirmed') >= 3`,
        )
        .bind(userId, restrictionScope, restrictionReason, restrictionStartsAt, restrictionEndsAt, actor.userId, now, userId, kind);
    }
  }

  const incidentInsert = db
    .prepare(
      `INSERT INTO student_incidents (user_id, kind, reference, description, explanation, decision, review, recorded_by_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(userId, kind, reference.trim(), description.trim(), explanation.trim(), decision, review.trim(), actor.userId, now);
  const incidentAudit = db
    .prepare(
      `INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, reason, details)
       SELECT ?, 'created', 'incident', CAST((SELECT id FROM student_incidents
          WHERE user_id = ? AND kind = ? AND reference = ?) AS TEXT), ?, ?
        WHERE changes() = 1`,
    )
    .bind(actor.userId, userId, kind, reference.trim(), "ATS incident review recorded", JSON.stringify({ kind, decision }));
  const restrictionAudit = db
    .prepare(
      `INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, reason, details)
       SELECT ?, 'created', 'restriction', CAST((SELECT id FROM student_restrictions
          WHERE user_id = ? AND scope = ? AND starts_at = ? AND ends_at = ? AND lifted_at IS NULL
          ORDER BY id DESC LIMIT 1) AS TEXT), ?, ?
        WHERE changes() = 1`,
    )
    .bind(actor.userId, userId, restrictionScope, restrictionStartsAt ?? "", restrictionEndsAt ?? "", restrictionReason, JSON.stringify({ userId, scope: restrictionScope }));

  try {
    await db.batch(
      restrictionInsert
        ? [incidentInsert, incidentAudit, restrictionInsert, restrictionAudit]
        : [incidentInsert, incidentAudit],
    );
  } catch (error) {
    if (/UNIQUE constraint failed: student_incidents/i.test(error instanceof Error ? error.message : "")) {
      throw new FrontendWorkflowError(
        "This incident reference was already reviewed for this student and category.",
        409,
        "DUPLICATE_INCIDENT",
      );
    }
    throw error;
  }

  const row = await db
    .prepare(
      `SELECT id, user_id AS userId, kind, reference, description, explanation, decision, review,
              recorded_by_user_id AS recordedByUserId, created_at AS createdAt
       FROM student_incidents
       WHERE user_id = ? AND kind = ? AND reference = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .bind(userId, kind, reference.trim())
    .first<IncidentRow>();
  if (!row) throw new FrontendWorkflowError("Incident disappeared after insert.", 500, "FETCH_FAILED");
  const incident = await formatIncident(db, row);

  let restriction: Restriction | undefined;
  if (restrictionInsert && restrictionStartsAt && restrictionEndsAt) {
    const restrictionRow = await db
      .prepare(
        `SELECT id, user_id AS userId, scope, reason, starts_at AS startsAt, ends_at AS endsAt,
                created_by_user_id AS createdByUserId, created_at AS createdAt,
                lifted_at AS liftedAt, lifted_by_user_id AS liftedByUserId, lift_reason AS liftReason
         FROM student_restrictions
         WHERE user_id = ? AND starts_at = ? AND ends_at = ? AND created_by_user_id = ? AND lifted_at IS NULL
         ORDER BY id DESC LIMIT 1`,
      )
      .bind(userId, restrictionStartsAt, restrictionEndsAt, actor.userId)
      .first<RestrictionRow>();
    if (restrictionRow) restriction = await formatRestriction(db, restrictionRow);
  }

  return { incident, restriction };
}

export async function liftRestriction(
  db: D1Database,
  actor: { userId: number; role: "student" | "technician" | "admin" },
  restrictionId: number,
  reason: string,
): Promise<Restriction> {
  if (reason.trim().length < 5) {
    throw new FrontendWorkflowError("Explain why the restriction is being lifted.", 400, "REASON_TOO_SHORT");
  }
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE student_restrictions
       SET lifted_at = ?, lifted_by_user_id = ?, lift_reason = ?
       WHERE id = ? AND lifted_at IS NULL`,
    )
    .bind(now, actor.userId, reason.trim(), restrictionId)
    .run();
  if (result.meta.changes !== 1) {
    throw new FrontendWorkflowError(
      "Restriction not found or already lifted.",
      404,
      "RESTRICTION_NOT_FOUND",
    );
  }
  const row = await db
    .prepare(
      `SELECT id, user_id AS userId, scope, reason, starts_at AS startsAt, ends_at AS endsAt,
              created_by_user_id AS createdByUserId, created_at AS createdAt,
              lifted_at AS liftedAt, lifted_by_user_id AS liftedByUserId, lift_reason AS liftReason
       FROM student_restrictions WHERE id = ? LIMIT 1`,
    )
    .bind(restrictionId)
    .first<RestrictionRow>();
  if (!row) throw new FrontendWorkflowError("Restriction not found.", 404, "NOT_FOUND");
  return formatRestriction(db, row);
}

export interface DeleteStudentInput {
  userId: number;
  deletedByUserId: number;
  reason: string;
}

export async function deleteStudentAccount(
  db: D1Database,
  actor: { userId: number; role: "student" | "technician" | "admin" },
  input: DeleteStudentInput,
): Promise<void> {
  const { userId, deletedByUserId, reason } = input;
  if (reason.trim().length < 5) {
    throw new FrontendWorkflowError("Enter the reason for account deletion.", 400, "REASON_TOO_SHORT");
  }
  const student = await findStudentById(db, userId);
  if (!student) throw new FrontendWorkflowError("Student account not found.", 404, "USER_NOT_FOUND");
  if (student.role !== "student") throw new FrontendWorkflowError("Only student accounts can be deleted this way.", 400, "INVALID_ROLE");
  if (student.deletedAt && student.deletedAt.trim() !== "" && student.deletedAt !== "NULL") {
    throw new FrontendWorkflowError("This account is already deleted.", 400, "ALREADY_DELETED");
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const nowTime = now.toISOString().slice(11, 16);
  const upcoming = await db
    .prepare(
      `SELECT b.id FROM bookings b
       WHERE b.user_id = ? AND b.status != 'cancelled'
         AND (COALESCE(b.end_date, b.date) > ? OR (COALESCE(b.end_date, b.date) = ? AND b.end_time > ?))
       LIMIT 1`,
    )
    .bind(userId, today, today, nowTime)
    .first();
  if (upcoming) {
    throw new FrontendWorkflowError(
      "Cancel or end this student's upcoming and active reservations before deleting the account.",
      409,
      "RESERVATIONS_PENDING",
    );
  }
  const openMoves = await db
    .prepare(
      `SELECT id FROM equipment_movements WHERE moved_by_user_id = ? AND status = 'open' LIMIT 1`,
    )
    .bind(userId)
    .first();
  if (openMoves) {
    throw new FrontendWorkflowError(
      "Resolve this student's outstanding equipment moves before deleting the account.",
      409,
      "MOVES_PENDING",
    );
  }

  // One batch: the soft delete, its audit record and the participant demotion
  // commit together or not at all. The SQL guards re-check role/deletion state
  // so a concurrent deletion cannot double-write the audit trail.
  const delAt = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE users
         SET deleted_at = ?, deleted_by_user_id = ?, deletion_reason = ?
         WHERE id = ? AND role = 'student'
           AND (deleted_at IS NULL OR deleted_at = '')`,
      )
      .bind(delAt, deletedByUserId, reason.trim(), userId),
    db
      .prepare(
        `INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id, reason, details)
         SELECT ?, 'deleted', 'student', CAST(? AS TEXT), ?, '{}'
          WHERE changes() = 1`,
      )
      .bind(actor.userId, String(userId), reason.trim()),
    db
      .prepare(
        `UPDATE booking_participants
         SET status = 'left', responded_at = ?
         WHERE user_id = ? AND status IN ('invited', 'accepted')`,
      )
      .bind(delAt, userId),
  ]);
}