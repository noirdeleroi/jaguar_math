import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

export const GOOGLE_CLASSROOM_SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/classroom.profile.emails",
  "https://www.googleapis.com/auth/classroom.profile.photos",
  "https://www.googleapis.com/auth/gmail.send",
] as const;
export const GOOGLE_GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

export const GOOGLE_OAUTH_STATE_COOKIE = "jaguar_google_oauth_state";
export const GOOGLE_TOKEN_COOKIE = "jaguar_google_access";
export const GOOGLE_SYNC_PREVIEW_COOKIE = "jaguar_google_sync_preview";

type GoogleTokenSession = { accessToken: string; expiresAt: number; scopes: string[]; teacherId: string };
type GoogleStateSession = { state: string; teacherId: string };
export type GoogleSyncTarget = { kind: "create"; name: string; gradeLevel: 11 | 12; academicYear: string } | { kind: "existing"; classId: string };
type GoogleSyncPreviewSession = { teacherId: string; courseId: string; target: GoogleSyncTarget; rosterFingerprint: string };
export type GoogleCourse = { id: string; name: string; section?: string; courseState?: string };
export type GoogleRosterStudent = { userId: string; fullName: string; emailAddress: string; photoUrl?: string };
export type GoogleClassroomErrorCode = "token_expired" | "missing_scopes" | "admin_restricted" | "classroom_error" | "refresh_token_missing" | "gmail_error";

export class GoogleClassroomError extends Error {
  constructor(public readonly code: GoogleClassroomErrorCode) { super(code); }
}

export function googleOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

function cookieOptions(maxAge: number) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge };
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function encode(value: GoogleTokenSession | GoogleStateSession | GoogleSyncPreviewSession, secret: string) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

function decode<T>(value: string | undefined, secret: string): T | null {
  if (!value) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return null;
  const expected = sign(payload, secret);
  const received = Buffer.from(signature); const expectedBuffer = Buffer.from(expected);
  if (received.length !== expectedBuffer.length || !timingSafeEqual(received, expectedBuffer)) return null;
  try { return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as T; } catch { return null; }
}

export async function readGoogleToken(teacherId: string) {
  const config = googleOAuthConfig();
  if (!config) return { status: "configuration_missing" as const, token: null };
  const cookieStore = await cookies(); const session = decode<GoogleTokenSession>(cookieStore.get(GOOGLE_TOKEN_COOKIE)?.value, config.clientSecret);
  if (!session || session.teacherId !== teacherId || !session.accessToken || !Number.isFinite(session.expiresAt)) return { status: "not_connected" as const, token: null };
  if (session.expiresAt <= Date.now() + 15_000) return { status: "expired" as const, token: null };
  return { status: "connected" as const, token: session.accessToken };
}

export function setGoogleState(response: Response, state: string, teacherId: string) {
  const config = googleOAuthConfig();
  if (!config) return;
  // NextResponse extends Response with the cookie API; keeping this helper typed
  // structurally avoids leaking framework details into the rest of this module.
  (response as Response & { cookies: { set: (name: string, value: string, options: ReturnType<typeof cookieOptions>) => void } }).cookies.set(GOOGLE_OAUTH_STATE_COOKIE, encode({ state, teacherId }, config.clientSecret), cookieOptions(10 * 60));
}

export async function readGoogleState() {
  const config = googleOAuthConfig();
  if (!config) return null;
  const cookieStore = await cookies();
  return decode<GoogleStateSession>(cookieStore.get(GOOGLE_OAUTH_STATE_COOKIE)?.value, config.clientSecret);
}

export async function setGoogleSyncPreview(value: GoogleSyncPreviewSession) {
  const config = googleOAuthConfig(); if (!config) return;
  const cookieStore = await cookies(); cookieStore.set(GOOGLE_SYNC_PREVIEW_COOKIE, encode(value, config.clientSecret), cookieOptions(10 * 60));
}

export async function readGoogleSyncPreview() {
  const config = googleOAuthConfig(); if (!config) return null;
  const cookieStore = await cookies(); return decode<GoogleSyncPreviewSession>(cookieStore.get(GOOGLE_SYNC_PREVIEW_COOKIE)?.value, config.clientSecret);
}

export async function clearGoogleSyncPreview() {
  const cookieStore = await cookies(); cookieStore.set(GOOGLE_SYNC_PREVIEW_COOKIE, "", cookieOptions(0));
}

export function clearGoogleState(response: Response) {
  (response as Response & { cookies: { set: (name: string, value: string, options: ReturnType<typeof cookieOptions>) => void } }).cookies.set(GOOGLE_OAUTH_STATE_COOKIE, "", cookieOptions(0));
}

export function setGoogleToken(response: Response, teacherId: string, accessToken: string, expiresIn: number, scopes: string[]) {
  const config = googleOAuthConfig();
  if (!config) return;
  const maxAge = Math.max(60, Math.min(Number.isFinite(expiresIn) ? Math.floor(expiresIn) : 3600, 3600));
  const session: GoogleTokenSession = { accessToken, expiresAt: Date.now() + maxAge * 1000, scopes, teacherId };
  (response as Response & { cookies: { set: (name: string, value: string, options: ReturnType<typeof cookieOptions>) => void } }).cookies.set(GOOGLE_TOKEN_COOKIE, encode(session, config.clientSecret), cookieOptions(maxAge));
}

export async function persistGoogleRefreshToken(teacherId: string, refreshToken: string | undefined, scopes: string[]) {
  const admin = createAdminClient();
  if (refreshToken) {
    const { error } = await admin.from("google_classroom_connections").upsert({ teacher_id: teacherId, refresh_token: refreshToken, scopes }, { onConflict: "teacher_id" });
    if (error) throw new GoogleClassroomError("classroom_error");
    return;
  }
  const { data, error } = await admin.from("google_classroom_connections").select("teacher_id").eq("teacher_id", teacherId).maybeSingle();
  if (error) throw new GoogleClassroomError("classroom_error");
  if (!data) throw new GoogleClassroomError("refresh_token_missing");
  const { error: updateError } = await admin.from("google_classroom_connections").update({ scopes }).eq("teacher_id", teacherId);
  if (updateError) throw new GoogleClassroomError("classroom_error");
}

export async function hasGoogleGmailSendPermission(teacherId: string) {
  try {
    const admin = createAdminClient(); const { data, error } = await admin.from("google_classroom_connections").select("scopes").eq("teacher_id", teacherId).maybeSingle();
    return !error && Boolean(data?.scopes?.includes(GOOGLE_GMAIL_SEND_SCOPE));
  } catch { return false; }
}

export async function getGoogleAccessToken(teacherId: string) {
  const temporary = await readGoogleToken(teacherId);
  if (temporary.status === "connected") return temporary;
  const config = googleOAuthConfig();
  if (!config) return { status: "configuration_missing" as const, token: null };
  let connection: { refresh_token: string } | null = null;
  try {
    const admin = createAdminClient(); const result = await admin.from("google_classroom_connections").select("refresh_token").eq("teacher_id", teacherId).maybeSingle();
    if (result.error) throw result.error; connection = result.data;
  } catch { return { status: "configuration_missing" as const, token: null }; }
  if (!connection?.refresh_token) return { status: "not_connected" as const, token: null };
  let response: Response;
  try { response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: connection.refresh_token, grant_type: "refresh_token" }), cache: "no-store" }); } catch { return { status: "expired" as const, token: null }; }
  const payload = await response.json().catch(() => null) as { access_token?: string } | null;
  if (!response.ok || !payload?.access_token) return { status: "expired" as const, token: null };
  return { status: "connected" as const, token: payload.access_token };
}

function classroomError(response: Response, body: unknown) {
  if (response.status === 401) return new GoogleClassroomError("token_expired");
  const message = typeof body === "object" && body && "error" in body ? JSON.stringify(body).toLowerCase() : "";
  if (response.status === 403 && (message.includes("scope") || message.includes("insufficient authentication"))) return new GoogleClassroomError("missing_scopes");
  if (response.status === 403 && (message.includes("admin") || message.includes("workspace") || message.includes("domain"))) return new GoogleClassroomError("admin_restricted");
  if (response.status === 403) return new GoogleClassroomError("admin_restricted");
  return new GoogleClassroomError("classroom_error");
}

async function classroomJson<T>(path: string, token: string): Promise<T> {
  let response: Response;
  try { response = await fetch(`https://classroom.googleapis.com/v1/${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }); } catch { throw new GoogleClassroomError("classroom_error"); }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw classroomError(response, body);
  return body as T;
}

function gmailError(response: Response, body: unknown) {
  if (response.status === 401) return new GoogleClassroomError("token_expired");
  const message = typeof body === "object" && body && "error" in body ? JSON.stringify(body).toLowerCase() : "";
  if (response.status === 403 && (message.includes("scope") || message.includes("permission") || message.includes("authentication"))) return new GoogleClassroomError("missing_scopes");
  if (response.status === 403 && (message.includes("admin") || message.includes("workspace") || message.includes("domain"))) return new GoogleClassroomError("admin_restricted");
  return new GoogleClassroomError("gmail_error");
}

export async function sendGoogleCredentialEmail(token: string, recipient: { fullName: string; emailAddress: string; temporaryPassword: string }) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.emailAddress) || /[\r\n]/.test(recipient.emailAddress)) throw new GoogleClassroomError("gmail_error");
  const firstName = recipient.fullName.trim().split(/\s+/)[0] || "there";
  const body = `Hi ${firstName},\n\nYour Jaguar Math account is ready.\n\nEmail:\n${recipient.emailAddress}\n\nTemporary password:\n${recipient.temporaryPassword}\n\nSign in to Jaguar Math using the credentials above.\nYou will be asked to create your own password after signing in.\n`;
  const message = `To: ${recipient.emailAddress}\r\nSubject: Jaguar Math — Your Login Credentials\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${body}`;
  let response: Response;
  try { response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw: Buffer.from(message).toString("base64url") }), cache: "no-store" }); } catch { throw new GoogleClassroomError("gmail_error"); }
  const result = await response.json().catch(() => null);
  if (!response.ok) throw gmailError(response, result);
}

export async function listTeacherCourses(token: string) {
  const courses: GoogleCourse[] = []; const seen = new Set<string>(); let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ teacherId: "me", pageSize: "100" }); if (pageToken) params.set("pageToken", pageToken);
    const page = await classroomJson<{ courses?: GoogleCourse[]; nextPageToken?: string }>(`courses?${params.toString()}`, token);
    courses.push(...(page.courses ?? []));
    if (!page.nextPageToken || seen.has(page.nextPageToken)) break;
    seen.add(page.nextPageToken); pageToken = page.nextPageToken;
  } while (pageToken);
  return courses;
}

export async function listCourseStudents(courseId: string, token: string) {
  const students: GoogleRosterStudent[] = []; const seen = new Set<string>(); let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ pageSize: "100" }); if (pageToken) params.set("pageToken", pageToken);
    const page = await classroomJson<{ students?: { userId: string; profile?: { name?: { fullName?: string }; emailAddress?: string; photoUrl?: string } }[]; nextPageToken?: string }>(`courses/${encodeURIComponent(courseId)}/students?${params.toString()}`, token);
    students.push(...(page.students ?? []).map((student) => ({ userId: student.userId, fullName: student.profile?.name?.fullName || "Unnamed student", emailAddress: student.profile?.emailAddress || "No email address", photoUrl: normalizeGooglePhotoUrl(student.profile?.photoUrl) })));
    if (!page.nextPageToken || seen.has(page.nextPageToken)) break;
    seen.add(page.nextPageToken); pageToken = page.nextPageToken;
  } while (pageToken);
  const photoHosts = [...new Set(students.flatMap((student) => { try { return student.photoUrl ? [new URL(student.photoUrl).hostname] : []; } catch { return []; } }))];
  console.info("[google-classroom] roster photo metadata", { courseId, studentCount: students.length, studentsWithPhotoUrl: students.filter((student) => Boolean(student.photoUrl)).length, photoHosts });
  return students;
}

export function normalizeGooglePhotoUrl(photoUrl: string | undefined) {
  const value = photoUrl?.trim(); if (!value) return undefined;
  const normalized = value.startsWith("//") ? `https:${value}` : value;
  try { const url = new URL(normalized); return url.protocol === "https:" ? url.toString() : undefined; } catch { return undefined; }
}
