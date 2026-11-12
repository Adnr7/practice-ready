import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { requireStaff, workflowErrorResponse } from "@/lib/frontend-workflows";
import { hasAtsAccessSchema, lateReturnCandidates } from "@/lib/ats-access";

export async function GET(request: Request) {
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

    const userId = new URL(request.url).searchParams.get("userId");
    if (!userId || !Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) {
      return Response.json({ error: "userId query parameter is required." }, { status: 400 });
    }

    const candidates = await lateReturnCandidates(db.$client, Number(userId));
    return Response.json({ userId: Number(userId), candidates });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
