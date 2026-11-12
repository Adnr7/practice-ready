import type { D1Database } from "@cloudflare/workers-types";
import { FrontendWorkflowError } from "./frontend-workflows.ts";
import { accessIssue } from "./ats-access.ts";

export type ParticipantStatus = "invited" | "accepted" | "declined" | "left";

export interface BookingParticipant {
  userId: number;
  email: string;
  name: string;
  status: ParticipantStatus;
  invitedAt: string;
  respondedAt: string | null;
}

export interface BookingParticipantsView {
  bookingId: number;
  ownerId: number | null;
  ownerEmail: string;
  ownerName: string;
  participants: BookingParticipant[];
}

export async function listBookingParticipants(
  db: D1Database,
  bookingId: number,
): Promise<BookingParticipantsView | null> {
  const booking = await db
    .prepare(
      `SELECT b.id, b.user_id AS userId, u.email AS ownerEmail, u.full_name AS ownerName
       FROM bookings b LEFT JOIN users u ON u.id = b.user_id
       WHERE b.id = ? LIMIT 1`,
    )
    .bind(bookingId)
    .first<{ id: number; userId: number | null; ownerEmail: string | null; ownerName: string | null }>();
  if (!booking) return null;

  const participants = await db
    .prepare(
      `SELECT p.user_id AS userId, u.email, u.full_name AS name, p.status, p.invited_at AS invitedAt, p.responded_at AS respondedAt
       FROM booking_participants p
       JOIN users u ON u.id = p.user_id
       WHERE p.booking_id = ?
       ORDER BY p.invited_at ASC, p.id ASC`,
    )
    .bind(bookingId)
    .all<{
      userId: number;
      email: string;
      name: string;
      status: ParticipantStatus;
      invitedAt: string;
      respondedAt: string | null;
    }>();

  return {
    bookingId,
    ownerId: booking.userId,
    ownerEmail: booking.ownerEmail ?? "",
    ownerName: booking.ownerName ?? "",
    participants: participants.results,
  };
}

/** True when the user owns or actively participates in another session overlapping this window. */
async function hasOverlappingSession(
  db: D1Database,
  bookingId: number,
  userId: number,
): Promise<boolean> {
  const own = await db
    .prepare(
      `SELECT date, COALESCE(end_date, date) AS endDate, start_time AS startTime, end_time AS endTime
       FROM bookings WHERE id = ? LIMIT 1`,
    )
    .bind(bookingId)
    .first<{ date: string; endDate: string; startTime: string; endTime: string }>();
  if (!own) return false;

  const rows = await db
    .prepare(
      `SELECT b.id, b.date, COALESCE(b.end_date, b.date) AS endDate, b.start_time AS startTime, b.end_time AS endTime
       FROM bookings b
       WHERE b.id <> ? AND b.status != 'cancelled'
         AND (b.user_id = ?
           OR EXISTS (SELECT 1 FROM booking_participants bp
             WHERE bp.booking_id = b.id AND bp.user_id = ? AND bp.status = 'accepted'))
         AND b.date <= ? AND COALESCE(b.end_date, b.date) >= ?`,
    )
    .bind(bookingId, userId, userId, own.endDate, own.date)
    .all<{ id: number; date: string; endDate: string; startTime: string; endTime: string }>();

  return rows.results.some((row) =>
    `${row.date}T${row.startTime}` < `${own.endDate}T${own.endTime}` &&
    `${row.endDate}T${row.endTime}` > `${own.date}T${own.startTime}`,
  );
}

export interface ParticipantActionInput {
  action: "invite" | "accept" | "decline" | "leave" | "remove";
  email: string;
}

export async function updateBookingParticipant(
  db: D1Database,
  bookingId: number,
  actor: { userId: number; role: "student" | "technician" | "admin" },
  input: ParticipantActionInput,
): Promise<BookingParticipantsView> {
  const { action } = input;
  const targetEmail = input.email.trim().toLowerCase();

  const booking = await db
    .prepare(
      `SELECT id, user_id AS userId, status, date, COALESCE(end_date, date) AS endDate, end_time AS endTime
       FROM bookings WHERE id = ? LIMIT 1`,
    )
    .bind(bookingId)
    .first<{ id: number; userId: number | null; status: string; date: string; endDate: string; endTime: string }>();
  if (!booking) throw new FrontendWorkflowError("Session not found.", 404, "BOOKING_NOT_FOUND");
  if (booking.status !== "confirmed") {
    throw new FrontendWorkflowError(
      "This session is no longer available for participation.",
      409,
      booking.status === "cancelled" ? "SESSION_CANCELLED" : "SESSION_ENDED",
    );
  }
  if (Date.parse(`${booking.endDate}T${booking.endTime}:00Z`) <= Date.now()) {
    throw new FrontendWorkflowError("This session is no longer available for participation.", 409, "SESSION_ENDED");
  }

  const isOrganiser = booking.userId === actor.userId;
  const isStaff = actor.role === "technician" || actor.role === "admin";

  if (action === "invite" || action === "remove") {
    if (!isOrganiser && !isStaff) {
      throw new FrontendWorkflowError("Only the session organiser can manage invitations.", 403, "NOT_ORGANISER");
    }
  }

  const actorEmailRow = await db
    .prepare("SELECT email FROM users WHERE id = ? LIMIT 1")
    .bind(actor.userId)
    .first<{ email: string }>();

  if (action !== "invite" && action !== "remove") {
    if (targetEmail !== (actorEmailRow?.email ?? "").trim().toLowerCase()) {
      throw new FrontendWorkflowError("You can respond only to your own invitation.", 403, "WRONG_ACTOR");
    }
  }

  const target = await db
    .prepare(
      `SELECT id, email, full_name AS name, role FROM users
       WHERE email = ? AND is_active = 1 AND (deleted_at IS NULL OR deleted_at = '')
       LIMIT 1`,
    )
    .bind(targetEmail)
    .first<{ id: number; email: string; name: string; role: string }>();
  if (!target) throw new FrontendWorkflowError("Invite a student with a registered account.", 404, "USER_NOT_FOUND");
  if (target.role !== "student") {
    throw new FrontendWorkflowError("Only student accounts can join sessions.", 400, "INVALID_ROLE");
  }

  const existing = await db
    .prepare(
      `SELECT id, status FROM booking_participants WHERE booking_id = ? AND user_id = ? LIMIT 1`,
    )
    .bind(bookingId, target.id)
    .first<{ id: number; status: ParticipantStatus }>();

  const nowMs = Date.now();
  if (action === "invite") {
    if (target.id === booking.userId) {
      throw new FrontendWorkflowError("The organiser is already part of this session.", 400, "IS_ORGANISER");
    }
    const actorIssue = await accessIssue(db, actor.userId, nowMs);
    if (actorIssue) throw new FrontendWorkflowError(actorIssue, 403, "ACCESS_RESTRICTED");
    const targetIssue = await accessIssue(db, target.id, nowMs);
    if (targetIssue) throw new FrontendWorkflowError(targetIssue, 403, "TARGET_ACCESS_RESTRICTED");
    if (existing && (existing.status === "invited" || existing.status === "accepted")) {
      throw new FrontendWorkflowError("This student is already invited or participating.", 409, "ALREADY_INVITED");
    }
    const now = new Date(nowMs).toISOString();
    if (existing) {
      await db
        .prepare(
          `UPDATE booking_participants SET status = 'invited', invited_at = ?, responded_at = NULL, invited_by_user_id = ?
           WHERE booking_id = ? AND user_id = ?`,
        )
        .bind(now, actor.userId, bookingId, target.id)
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO booking_participants (booking_id, user_id, status, invited_by_user_id, invited_at)
           VALUES (?, ?, 'invited', ?, ?)`,
        )
        .bind(bookingId, target.id, actor.userId, now)
        .run();
    }
  } else if (action === "remove") {
    if (!existing) throw new FrontendWorkflowError("This student is not part of the session.", 404, "PARTICIPANT_NOT_FOUND");
    await db
      .prepare(`DELETE FROM booking_participants WHERE booking_id = ? AND user_id = ?`)
      .bind(bookingId, target.id)
      .run();
  } else if (!existing) {
    throw new FrontendWorkflowError("You can respond only to your own invitation.", 404, "NOT_FOUND");
  } else if (action === "accept") {
    if (existing.status !== "invited") {
      throw new FrontendWorkflowError("This invitation was already answered.", 409, "ALREADY_ANSWERED");
    }
    const issue = await accessIssue(db, actor.userId, nowMs);
    if (issue) throw new FrontendWorkflowError(issue, 403, "ACCESS_RESTRICTED");
    if (await hasOverlappingSession(db, bookingId, actor.userId)) {
      throw new FrontendWorkflowError("You already have an overlapping session.", 409, "SESSION_OVERLAP");
    }
    await db
      .prepare(`UPDATE booking_participants SET status = 'accepted', responded_at = ? WHERE id = ?`)
      .bind(new Date(nowMs).toISOString(), existing.id)
      .run();
  } else if (action === "decline") {
    if (existing.status !== "invited") {
      throw new FrontendWorkflowError("This invitation was already answered.", 409, "ALREADY_ANSWERED");
    }
    await db
      .prepare(`UPDATE booking_participants SET status = 'declined', responded_at = ? WHERE id = ?`)
      .bind(new Date(nowMs).toISOString(), existing.id)
      .run();
  } else {
    if (existing.status !== "accepted") {
      throw new FrontendWorkflowError("You are no longer a participant.", 409, "NOT_PARTICIPANT");
    }
    await db
      .prepare(`UPDATE booking_participants SET status = 'left', responded_at = ? WHERE id = ?`)
      .bind(new Date(nowMs).toISOString(), existing.id)
      .run();
  }

  const view = await listBookingParticipants(db, bookingId);
  if (!view) throw new FrontendWorkflowError("Session disappeared after update.", 500, "FETCH_FAILED");
  return view;
}
