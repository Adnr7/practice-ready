import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import {
  parseBody,
  requireStaff,
  workflowErrorResponse,
} from "@/lib/frontend-workflows";
import { hasAtsAccessSchema, liftRestriction } from "@/lib/ats-access";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

    const restrictionId = Number((await params).id);
    if (!Number.isSafeInteger(restrictionId) || restrictionId <= 0) {
      return Response.json({ error: "Invalid restriction id." }, { status: 400 });
    }

    const body = parseBody(await request.json().catch(() => null));
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) {
      return Response.json({ error: "reason is required." }, { status: 400 });
    }

    const restriction = await liftRestriction(db.$client, { userId: session.userId, role: session.role }, restrictionId, reason);
    return Response.json({ restriction });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
