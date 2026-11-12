import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { applyMigrationBatch, loadMigrations } from "../scripts/migration-tools.mjs";
import { hashPassword } from "../lib/auth.ts";
import { createStoredSession } from "../lib/session-store.ts";

const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare } = wranglerRequire("miniflare");
const { build } = wranglerRequire("esbuild");

const root = fileURLToPath(new URL("../", import.meta.url));

const worker = `
  import * as access from "./app/api/ats/access/route.ts";
  import * as incidents from "./app/api/ats/incidents/route.ts";
  import * as lateReturns from "./app/api/ats/late-returns/route.ts";
  import * as members from "./app/api/ats/members/route.ts";
  import * as profile from "./app/api/ats/profile/route.ts";
  import * as lift from "./app/api/ats/restrictions/[id]/lift/route.ts";
  import * as student from "./app/api/ats/students/[id]/route.ts";
  import * as bookings from "./app/api/bookings/route.ts";
  import * as participants from "./app/api/bookings/[id]/participants/route.ts";
  import * as login from "./app/api/auth/login/route.ts";
  import * as me from "./app/api/auth/me/route.ts";
  const atStudent = /^\\/api\\/ats\\/students\\/([^/]+)$/;
  const atLift = /^\\/api\\/ats\\/restrictions\\/([^/]+)\\/lift$/;
  const atParticipants = /^\\/api\\/bookings\\/([^/]+)\\/participants$/;
  export default { async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/api/ats/access") return access.GET(request);
    if (path === "/api/ats/incidents") return incidents.POST(request);
    if (path === "/api/ats/late-returns") return lateReturns.GET(request);
    if (path === "/api/ats/members") return members[request.method](request);
    if (path === "/api/ats/profile") return profile.PATCH(request);
    if (path === "/api/bookings") return bookings[request.method](request);
    if (path === "/api/auth/login") return login.POST(request);
    if (path === "/api/auth/me") return me.GET(request);
    const studentMatch = atStudent.exec(path);
    if (studentMatch) return student[request.method](request, { params: Promise.resolve({ id: studentMatch[1] }) });
    const liftMatch = atLift.exec(path);
    if (liftMatch) return lift.PATCH(request, { params: Promise.resolve({ id: liftMatch[1] }) });
    const participantMatch = atParticipants.exec(path);
    if (participantMatch) return participants[request.method](request, { params: Promise.resolve({ id: participantMatch[1] }) });
    return new Response("Not found", { status: 404 });
  } };
`;

let emulator;
let db;
const tokens = {};
const password = "PracticeMusic2026!";
const key = () => `key-${crypto.randomUUID()}`;

function call(path, method = "GET", body, user) {
  return emulator.dispatchFetch(`https://example.test${path}`, {
    method,
    headers: {
      ...(tokens[user] ? { cookie: `pr_session=${tokens[user]}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json", "Idempotency-Key": key() }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function book(user, roomId, date, startTime = "09:00", endTime = "10:00") {
  const response = await call("/api/bookings", "POST", { roomId, date, startTime, endTime }, user);
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function incident(actingUser, target, overrides = {}) {
  const response = await call("/api/ats/incidents", "POST", {
    userId: target,
    kind: "no-show",
    reference: `PR-${crypto.randomUUID()}`,
    description: "Student did not attend the booked session.",
    explanation: "Student replied that they forgot the session.",
    decision: "confirmed",
    review: "Confirmed after checking attendance records.",
    ...overrides,
  }, actingUser);
  return { status: response.status, body: await response.json().catch(() => null) };
}

before(async () => {
  process.env.AUTH_SECRET = "test-only-ats-access-secret";
  const bundled = await build({
    stdin: { contents: worker, resolveDir: root, sourcefile: "ats-access-worker.ts", loader: "ts" },
    absWorkingDir: root,
    tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)),
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    external: ["cloudflare:workers"],
    logLevel: "silent",
  });
  emulator = new Miniflare({ modules: true, script: bundled.outputFiles[0].text, compatibilityDate: "2026-05-15", d1Databases: ["DB"] });
  db = await emulator.getD1Database("DB");
  for (const migration of await loadMigrations()) await applyMigrationBatch(db, migration);

  const credentials = await hashPassword(password);
  await db.batch([
    db.prepare(`INSERT INTO users (id, email, password_hash, salt, full_name, role) VALUES
      (1, 'student1@example.test', ?, ?, 'Student One', 'student'),
      (2, 'student2@example.test', ?, ?, 'Student Two', 'student'),
      (3, 'student3@example.test', ?, ?, 'Student Three', 'student'),
      (4, 'tech@example.test', ?, ?, 'Technician', 'technician')`)
      .bind(credentials.hash, credentials.salt, credentials.hash, credentials.salt, credentials.hash, credentials.salt, credentials.hash, credentials.salt),
    db.prepare("INSERT INTO locations (id, code, name, type) VALUES (1, 'mpr-2', 'MPR 2', 'room'), (2, 'mpr-3', 'MPR 3', 'room')"),
    db.prepare("INSERT INTO rooms (id, name, code, capacity, description, location_id) VALUES (1, 'MPR 2', 'mpr-2', 6, 'Practice room', 1), (2, 'MPR 3', 'mpr-3', 8, 'Band room', 2)"),
    db.prepare("INSERT INTO equipment (id, equipment_id, name, type, current_location_id, default_location_id) VALUES (1, 'MIX-01', 'Mixer', 'mixer', 1, 1)"),
    // The default policy limits students to today/tomorrow; tests book far in
    // the future so they do not depend on the real clock.
    db.prepare("UPDATE booking_policies SET student_window = 0, advance_days = 100000 WHERE is_current = 1"),
  ]);
  for (const user of [1, 2, 3, 4]) tokens[user] = await createStoredSession(db, user);
});

after(async () => {
  await emulator?.dispose();
  delete process.env.AUTH_SECRET;
});

describe("ATS student access workflows", () => {
  it("gates every ATS mutation and directory behind staff roles", async () => {
    assert.equal((await call("/api/ats/access")).status, 401);
    assert.equal((await call("/api/ats/incidents", "POST", { userId: 2 }, 1)).status, 403);
    assert.equal((await call("/api/ats/members", "POST", {}, 1)).status, 403);
    assert.equal((await call("/api/ats/students/2", "DELETE", { reason: "student attempt" }, 1)).status, 403);
    assert.equal((await call("/api/ats/access?userId=2", "GET", undefined, 1)).status, 403);
  });

  it("scopes access reads: students see their own, staff see everyone", async () => {
    const own = await (await call("/api/ats/access", "GET", undefined, 1)).json();
    assert.equal(own.userId, 1);
    assert.deepEqual(own.incidents, []);
    assert.deepEqual(own.restrictions, []);

    const staffView = await (await call("/api/ats/access", "GET", undefined, 4)).json();
    assert.equal(staffView.userId, null);

    const targeted = await (await call("/api/ats/access?userId=1", "GET", undefined, 4)).json();
    assert.equal(targeted.userId, 1);
  });

  it("validates incident payloads and rejects duplicate references", async () => {
    const short = await incident(4, 1, { description: "hi" });
    assert.equal(short.status, 400);
    assert.equal(short.body.code, "FIELD_TOO_SHORT");

    const badKind = await incident(4, 1, { kind: "noise" });
    assert.equal(badKind.status, 400);
    assert.equal(badKind.body.code, "INVALID_INCIDENT_KIND");

    const first = await incident(4, 1, { reference: "PR-DUP-1", decision: "confirmed" });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const duplicate = await incident(4, 1, { reference: "PR-DUP-1" });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.code, "DUPLICATE_INCIDENT");
  });

  it("creates a facilities restriction on the third confirmed incident and blocks bookings", async () => {
    await incident(4, 1, { reference: "PR-NS-2", decision: "confirmed" });
    const counted = await (await call("/api/ats/access?userId=1", "GET", undefined, 4)).json();
    assert.equal(counted.incidents.filter((i) => i.decision === "confirmed").length, 2);

    const third = await incident(4, 1, {
      reference: "PR-NS-3",
      decision: "confirmed",
      restrictionStartsAt: new Date().toISOString(),
      restrictionEndsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    });
    assert.equal(third.status, 201, JSON.stringify(third.body));
    assert.ok(third.body.restriction, "the third confirmed incident must carry a restriction");
    assert.equal(third.body.restriction.scope, "facilities");
    const restrictionId = third.body.restriction.id;

    const restricted = await book(1, 1, "2099-02-01");
    assert.equal(restricted.status, 403, JSON.stringify(restricted.body));
    assert.equal(restricted.body.code, "ACCESS_RESTRICTED");

    const allowed = await book(2, 1, "2099-02-01");
    assert.equal(allowed.status, 201, JSON.stringify(allowed.body));
    assert.ok(allowed.body.booking.id, "an unrestricted student can still book");

    const lift = await call(`/api/ats/restrictions/${restrictionId}/lift`, "PATCH", { reason: "Student completed restorative actions." }, 4);
    assert.equal(lift.status, 200, JSON.stringify(await lift.json()));
    assert.ok((await (await call(`/api/ats/restrictions/${restrictionId}/lift`, "PATCH", { reason: "Lifting twice must fail." }, 4)).json()).code ?? true);
    assert.equal((await call(`/api/ats/restrictions/${restrictionId}/lift`, "PATCH", { reason: "Lifting twice must fail." }, 4)).status, 404);

    const afterLift = await book(1, 1, "2099-02-02");
    assert.equal(afterLift.status, 201, JSON.stringify(afterLift.body));
  });

  it("requires a restriction period on the third confirmed incident", async () => {
    const first = await incident(4, 3, { reference: "PR-S3-1", decision: "confirmed" });
    const second = await incident(4, 3, { reference: "PR-S3-2", decision: "confirmed" });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const missing = await incident(4, 3, { reference: "PR-S3-3", decision: "confirmed" });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.code, "RESTRICTION_PERIOD_REQUIRED");
  });

  it("derives unreviewed late returns from returned movements and consumes them once", async () => {
    await db.batch([
      db.prepare(`INSERT INTO equipment_movements (id, equipment_id, moved_by_user_id, from_location_id, to_location_id, status, expected_return_at, returned_at, moved_at)
        VALUES (1, 1, 2, 1, 2, 'returned', '2099-01-01T10:00:00.000Z', '2099-01-01T12:00:00.000Z', '2099-01-01T09:00:00.000Z'),
               (2, 1, 2, 1, 2, 'returned', '2099-01-05T10:00:00.000Z', '2099-01-05T15:00:00.000Z', '2099-01-05T09:00:00.000Z'),
               (3, 1, 2, 1, 2, 'returned', '2099-01-09T10:00:00.000Z', '2099-01-09T18:00:00.000Z', '2099-01-09T09:00:00.000Z')`),
    ]);

    const candidates = await (await call("/api/ats/late-returns?userId=2", "GET", undefined, 4)).json();
    assert.deepEqual(candidates.candidates.map((c) => c.reference), ["MOVE:1", "MOVE:2", "MOVE:3"]);

    const bogus = await incident(4, 2, { kind: "late-return", reference: "MOVE:999", decision: "confirmed" });
    assert.equal(bogus.status, 400);
    assert.equal(bogus.body.code, "INVALID_LATE_RETURN_REFERENCE");

    for (const reference of ["MOVE:1", "MOVE:2"]) {
      const review = await incident(4, 2, { kind: "late-return", reference, decision: "confirmed" });
      assert.equal(review.status, 201, JSON.stringify(review.body));
      assert.equal(review.body.restriction, undefined, "only the third late return restricts");
    }
    const third = await incident(4, 2, {
      kind: "late-return",
      reference: "MOVE:3",
      decision: "confirmed",
      restrictionStartsAt: new Date().toISOString(),
      restrictionEndsAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    });
    assert.equal(third.status, 201, JSON.stringify(third.body));
    assert.equal(third.body.restriction?.scope, "equipment", "late returns restrict equipment moves only");

    const remaining = await (await call("/api/ats/late-returns?userId=2", "GET", undefined, 4)).json();
    assert.deepEqual(remaining.candidates, []);
  });

  it("manages joint-practice invitations with organiser-only control and overlap checks", async () => {
    const organised = await book(1, 1, "2099-03-01");
    assert.equal(organised.status, 201, JSON.stringify(organised.body));
    const bookingId = organised.body.booking.id;

    const notOrganiser = await call(`/api/bookings/${bookingId}/participants`, "POST", { action: "invite", email: "student2@example.test" }, 2);
    assert.equal(notOrganiser.status, 403);
    assert.equal((await notOrganiser.json()).code, "NOT_ORGANISER");

    const invite = await call(`/api/bookings/${bookingId}/participants`, "POST", { action: "invite", email: "student2@example.test" }, 1);
    assert.equal(invite.status, 200);
    assert.equal((await invite.json()).participants[0].status, "invited");

    const inviteeList = await (await call("/api/bookings", "GET", undefined, 2)).json();
    const seen = inviteeList.bookings.find((b) => b.id === bookingId);
    assert.ok(seen, "an invitee must see the invitation in their reservation list");
    assert.equal(seen.participants[0].status, "invited");

    const wrongActor = await call(`/api/bookings/${bookingId}/participants`, "POST", { action: "accept", email: "student2@example.test" }, 3);
    assert.equal(wrongActor.status, 403);
    assert.equal((await wrongActor.json()).code, "WRONG_ACTOR");

    const accept = await call(`/api/bookings/${bookingId}/participants`, "POST", { action: "accept", email: "student2@example.test" }, 2);
    assert.equal(accept.status, 200);
    assert.equal((await accept.json()).participants[0].status, "accepted");

    const secondAnswer = await call(`/api/bookings/${bookingId}/participants`, "POST", { action: "decline", email: "student2@example.test" }, 2);
    assert.equal(secondAnswer.status, 409);
    assert.equal((await secondAnswer.json()).code, "ALREADY_ANSWERED");

    const otherSession = await book(3, 2, "2099-03-01");
    assert.equal(otherSession.status, 201, JSON.stringify(otherSession.body));

    const overlappingInvite = await call(`/api/bookings/${bookingId}/participants`, "POST", { action: "invite", email: "student3@example.test" }, 1);
    assert.equal(overlappingInvite.status, 200);
    const overlap = await call(`/api/bookings/${bookingId}/participants`, "POST", { action: "accept", email: "student3@example.test" }, 3);
    assert.equal(overlap.status, 409);
    assert.equal((await overlap.json()).code, "SESSION_OVERLAP");

    await db.prepare("DELETE FROM booking_participants WHERE booking_id = ? AND user_id = 3").bind(bookingId).run();
  });

  it("manages ATS member accounts and profiles through staff-only routes", async () => {
    const memberBody = {
      fullName: "New Technician",
      email: "new.tech@vijaybhoomi.edu.in",
      phone: "+91 91234 56789",
      year: "2nd Year",
      areas: ["Studio & MP Labs"],
      password,
    };
    const created = await call("/api/ats/members", "POST", memberBody, 4);
    const createdBody = await created.json().catch(() => null);
    assert.equal(created.status, 201, JSON.stringify(createdBody));
    assert.equal(createdBody.member.role, "technician");

    const duplicate = await call("/api/ats/members", "POST", memberBody, 4);
    assert.equal(duplicate.status, 409);

    const listed = await (await call("/api/ats/members", "GET", undefined, 4)).json();
    assert.ok(listed.members.some((m) => m.email === "new.tech@vijaybhoomi.edu.in"));

    const profileUpdate = await call("/api/ats/profile", "PATCH", { name: "Technician Lead", phone: "+91 91234 56789", year: "3rd Year", areas: ["Live Sound & MPRs"] }, 4);
    assert.equal(profileUpdate.status, 200);
    assert.equal((await profileUpdate.json()).member.fullName, "Technician Lead");

    const studentProfile = await call("/api/ats/profile", "PATCH", { name: "Sneaky", phone: "+91 91234 56789", year: "1st Year", areas: ["Studio & MP Labs"] }, 1);
    assert.equal(studentProfile.status, 403);
  });

  it("soft-deletes an account only after reservations and moves are resolved", async () => {
    const blocked = await call("/api/ats/students/2", "DELETE", { reason: "Repeated violations documented." }, 4);
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).code, "RESERVATIONS_PENDING");

    const detail = await (await call("/api/ats/students/2", "GET", undefined, 4)).json();
    assert.equal(detail.user.id, 2);
    assert.ok(detail.access.restrictions.length >= 1, "access history stays visible to staff");

    await db.prepare("UPDATE bookings SET status = 'cancelled' WHERE user_id = 2 AND status = 'confirmed'").run();
    const deleted = await call("/api/ats/students/2", "DELETE", { reason: "Repeated violations documented." }, 4);
    assert.equal(deleted.status, 200, JSON.stringify(await deleted.json()));
    assert.equal((await call("/api/ats/students/2", "DELETE", { reason: "Deleting twice must fail." }, 4)).status, 400);

    const login = await call("/api/auth/login", "POST", { email: "student2@example.test", password });
    assert.equal(login.status, 403);
    assert.match((await login.json()).error, /deleted by ATS/i);
    const staleSession = await call("/api/auth/me", "GET", undefined, 2);
    assert.equal((await staleSession.json()).user, null, "a pre-deletion session stops resolving");

    const retained = await (await call("/api/ats/access?userId=2", "GET", undefined, 4)).json();
    assert.ok(retained.incidents.length >= 3, "incident history is retained after deletion");
  });

  it("records audit events for incidents, restrictions and deletion", async () => {
    const events = (await db.prepare("SELECT action, entity_type FROM audit_events ORDER BY id").all()).results;
    const kinds = events.map((e) => `${e.action}:${e.entity_type}`);
    assert.ok(kinds.includes("created:incident"), "incident reviews are audited");
    assert.ok(kinds.includes("created:restriction"), "restriction creation is audited");
    assert.ok(kinds.includes("deleted:student"), "account deletion is audited");
  });
});
