import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import {
  parseBody,
  requireStaff,
  workflowErrorResponse,
} from "@/lib/frontend-workflows";
import { hasAtsMembersSchema, updateAtsProfile } from "@/lib/ats-members";

export async function PATCH(request: Request) {
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
    const name = typeof body.name === "string" ? body.name.trim() : undefined;
    const phone = typeof body.phone === "string" ? body.phone.trim() : undefined;
    const year = typeof body.year === "string" ? body.year : undefined;
    const areas = Array.isArray(body.areas) ? (body.areas as string[]) : undefined;

    const member = await updateAtsProfile(db.$client, { userId: session.userId, role: session.role }, {
      name,
      phone,
      year,
      areas,
    });
    return Response.json({ member });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
