import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import {
  parseBody,
  requireStaff,
  workflowErrorResponse,
} from "@/lib/frontend-workflows";
import { deleteStudentAccount, hasAtsAccessSchema, listStudentAccess } from "@/lib/ats-access";

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
    requireStaff({ userId: session.userId, role: session.role });

    const db = getDb();
    if (!(await hasAtsAccessSchema(db.$client))) {
      return Response.json(
        { error: "ATS access schema migration required.", code: "SCHEMA_MIGRATION_REQUIRED" },
        { status: 503 },
      );
    }

    const userId = Number((await params).id);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return Response.json({ error: "Invalid user id." }, { status: 400 });
    }

    const user = await db.$client
      .prepare(
        `SELECT id, email, full_name AS fullName, student_id AS studentId, phone, role,
                deleted_at AS deletedAt, deletion_reason AS deletionReason,
                created_at AS createdAt
         FROM users WHERE id = ? LIMIT 1`,
      )
      .bind(userId)
      .first<{
        id: number;
        email: string;
        fullName: string;
        studentId: string | null;
        phone: string | null;
        role: string;
        deletedAt: string | null;
        deletionReason: string | null;
        createdAt: string;
      }>();
    if (!user) {
      return Response.json({ error: "Student not found." }, { status: 404 });
    }

    const access = await listStudentAccess(db.$client, userId);
    return Response.json({ user, access });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}

export async function DELETE(
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

    const userId = Number((await params).id);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return Response.json({ error: "Invalid user id." }, { status: 400 });
    }

    const body = parseBody(await request.json().catch(() => null));
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) {
      return Response.json({ error: "reason is required." }, { status: 400 });
    }

    await deleteStudentAccount(db.$client, { userId: session.userId, role: session.role }, {
      userId,
      deletedByUserId: session.userId,
      reason,
    });
    return Response.json({ deleted: true });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
