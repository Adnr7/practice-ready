import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import {
  parseBody,
  requireStaff,
  workflowErrorResponse,
} from "@/lib/frontend-workflows";
import { IdempotencyError, prepareIdempotencyRequest, replayIdempotentResponse } from "@/lib/idempotency";
import { addAtsMember, hasAtsMembersSchema, listAtsMembers } from "@/lib/ats-members";

export async function GET(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }
    requireStaff({ userId: session.userId, role: session.role });

    const db = getDb();
    if (!(await hasAtsMembersSchema(db.$client))) {
      return Response.json(
        { error: "ATS members schema migration required.", code: "SCHEMA_MIGRATION_REQUIRED" },
        { status: 503 },
      );
    }

    const members = await listAtsMembers(db.$client);
    return Response.json({ members });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }
    requireStaff({ userId: session.userId, role: session.role });

    const db = getDb();
    if (!(await hasAtsMembersSchema(db.$client))) {
      return Response.json(
        { error: "ATS members schema migration required.", code: "SCHEMA_MIGRATION_REQUIRED" },
        { status: 503 },
      );
    }

    const body = parseBody(await request.json().catch(() => null));
    const idempotency = await prepareIdempotencyRequest(
      session.userId,
      "ats.member.create",
      request.headers.get("Idempotency-Key"),
      body,
    );
    const replay = await replayIdempotentResponse(db.$client, idempotency);
    if (replay) return replay;

    const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const year = typeof body.year === "string" ? body.year : "";
    const areas = Array.isArray(body.areas) ? (body.areas as string[]) : [];
    const password = typeof body.password === "string" ? body.password : "";

    const member = await addAtsMember(db.$client, { userId: session.userId, role: session.role }, {
      fullName,
      email,
      phone,
      year,
      areas,
      password,
    });

    return Response.json({ member }, { status: 201 });
  } catch (error) {
    if (error instanceof IdempotencyError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return workflowErrorResponse(error);
  }
}
