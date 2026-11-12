import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import {
  parseBody,
  requireStaff,
  workflowErrorResponse,
} from "@/lib/frontend-workflows";
import { IdempotencyError, prepareIdempotencyRequest, replayIdempotentResponse } from "@/lib/idempotency";
import { hasAtsAccessSchema, recordIncident, type IncidentKind } from "@/lib/ats-access";

export async function POST(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }
    requireStaff({ userId: session.userId, role: session.role });

    const db = getDb();
    if (!(await hasAtsAccessSchema(db.$client))) {
      return Response.json(
        { error: "ATS access schema migration required.", code: "SCHEMA_MIGRATION_REQUIRED" },
        { status: 503 },
      );
    }

    const body = parseBody(await request.json().catch(() => null));
    const idempotency = await prepareIdempotencyRequest(
      session.userId,
      "ats.incident.create",
      request.headers.get("Idempotency-Key"),
      body,
    );
    const replay = await replayIdempotentResponse(db.$client, idempotency);
    if (replay) return replay;

    const userId = typeof body.userId === "number" && Number.isSafeInteger(body.userId) && body.userId > 0
      ? (body.userId as number)
      : null;
    if (!userId) {
      return Response.json({ error: "userId is required." }, { status: 400 });
    }

    const kind = body.kind as IncidentKind;
    const reference = typeof body.reference === "string" ? body.reference.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const explanation = typeof body.explanation === "string" ? body.explanation.trim() : "";
    const decision = body.decision as "confirmed" | "justified";
    const review = typeof body.review === "string" ? body.review.trim() : "";
    const restrictionStartsAt = typeof body.restrictionStartsAt === "string" ? body.restrictionStartsAt : undefined;
    const restrictionEndsAt = typeof body.restrictionEndsAt === "string" ? body.restrictionEndsAt : undefined;

    const result = await recordIncident(db.$client, { userId: session.userId, role: session.role }, {
      userId,
      kind,
      reference,
      description,
      explanation,
      decision,
      review,
      restrictionStartsAt,
      restrictionEndsAt,
    });

    const responseBody = { incident: result.incident };
    if (result.restriction) {
      (responseBody as Record<string, unknown>).restriction = result.restriction;
    }
    return Response.json(responseBody, { status: 201 });
  } catch (error) {
    if (error instanceof IdempotencyError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return workflowErrorResponse(error);
  }
}
