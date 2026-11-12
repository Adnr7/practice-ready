import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import {
  FrontendWorkflowError,
  workflowErrorResponse,
} from "@/lib/frontend-workflows";
import { listBookingParticipants, updateBookingParticipant } from "@/lib/booking-participants";
import { getBookingRow, parseBookingId } from "@/lib/booking-lifecycle";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }

    const bookingId = parseBookingId((await params).id);
    const db = getDb();

    const booking = await getBookingRow(db.$client, bookingId);
    if (!booking) {
      return Response.json({ error: "Session not found." }, { status: 404 });
    }

    const isOwner = booking.userId === session.userId;
    const isStaff = session.role === "technician" || session.role === "admin";
    if (!isOwner && !isStaff) {
      return Response.json({ error: "You do not have access to this session." }, { status: 403 });
    }

    const participants = await listBookingParticipants(db.$client, bookingId);
    return Response.json(participants ?? { bookingId, ownerEmail: "", ownerName: "", ownerId: null, participants: [] });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }

    const bookingId = parseBookingId((await params).id);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ error: "Request body must be a JSON object." }, { status: 400 });
    }

    const action = typeof body.action === "string" ? body.action.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!["invite", "accept", "decline", "leave", "remove"].includes(action)) {
      return Response.json({ error: "action must be one of: invite, accept, decline, leave, remove." }, { status: 400 });
    }
    if (!email) {
      return Response.json({ error: "email is required." }, { status: 400 });
    }

    const result = await updateBookingParticipant(getDb().$client, bookingId, {
      userId: session.userId,
      role: session.role,
    }, {
      action: action as "invite" | "accept" | "decline" | "leave" | "remove",
      email,
    });

    return Response.json(result);
  } catch (error) {
    if (error instanceof FrontendWorkflowError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
