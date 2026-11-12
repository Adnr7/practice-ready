import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { hasAtsAccessSchema, listAllAccess, listStudentAccess } from "@/lib/ats-access";
import { workflowErrorResponse } from "@/lib/frontend-workflows";

export async function GET(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }

    const db = getDb();
    if (!(await hasAtsAccessSchema(db.$client))) {
      return Response.json(
        { error: "ATS access schema migration required.", code: "SCHEMA_MIGRATION_REQUIRED" },
        { status: 503 },
      );
    }

    const { searchParams } = new URL(request.url);
    const targetUserId = searchParams.get("userId");
    const isStaff = session.role === "technician" || session.role === "admin";

    if (targetUserId) {
      if (!isStaff) {
        return Response.json({ error: "Only staff can view another student's access records." }, { status: 403 });
      }
      const userId = Number(targetUserId);
      if (!Number.isSafeInteger(userId) || userId <= 0) {
        return Response.json({ error: "Invalid userId." }, { status: 400 });
      }
      const data = await listStudentAccess(db.$client, userId);
      return Response.json({ userId, ...data });
    }

    // Staff without an explicit target see every student's records; students
    // always see only their own.
    if (isStaff) {
      const data = await listAllAccess(db.$client);
      return Response.json({ userId: null, ...data });
    }

    const data = await listStudentAccess(db.$client, session.userId);
    return Response.json({ userId: session.userId, ...data });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
