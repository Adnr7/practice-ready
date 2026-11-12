import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { configureAuthSecret, getSessionFromRequest } from "@/lib/auth";
import { requireStaff, workflowErrorResponse } from "@/lib/frontend-workflows";
import { hasColumn } from "@/lib/schema-capabilities";

export async function GET(request: Request) {
  try {
    configureAuthSecret(env.AUTH_SECRET);
    const session = await getSessionFromRequest(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    requireStaff({ userId: session.userId, role: session.role });
    const query = new URL(request.url).searchParams.get("query")?.trim() ?? "";
    const pattern = `%${query}%`;
    const db = getDb().$client;
    const hasDeletedAt = await hasColumn(db, "users", "deleted_at");
    const deletedSelect = hasDeletedAt
      ? `deleted_at AS deletedAt, deleted_by_user_id AS deletedByUserId, deletion_reason AS deletionReason,
        CASE WHEN deleted_at IS NOT NULL AND deleted_at != '' THEN 0 ELSE 1 END AS accountActive`
      : "NULL AS deletedAt, NULL AS deletedByUserId, NULL AS deletionReason, 1 AS accountActive";
    const students = await db.prepare(`
      SELECT id, email, full_name AS fullName, student_id AS studentId, phone, created_at AS createdAt,
        ${deletedSelect}
      FROM users WHERE role = 'student' AND is_active = 1 AND (full_name LIKE ? OR email LIKE ? OR COALESCE(student_id, '') LIKE ?)
      ORDER BY full_name LIMIT 100
    `).bind(pattern, pattern, pattern).all();
    return Response.json({ students: students.results });
  } catch (error) {
    return workflowErrorResponse(error);
  }
}
