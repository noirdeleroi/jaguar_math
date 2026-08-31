import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { GOOGLE_CLASSROOM_SCOPES, GoogleClassroomError, clearGoogleState, googleOAuthConfig, persistGoogleRefreshToken, readGoogleState, setGoogleToken } from "@/lib/google-classroom";

const classroomPage = (request: Request, error?: string) => new URL(`/teacher/google-classroom${error ? `?error=${encodeURIComponent(error)}` : ""}`, request.url);
const sameValue = (left: string, right: string) => { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); };

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.redirect(new URL("/login", request.url));
  if (profile.role !== "teacher") return NextResponse.redirect(new URL("/student", request.url));
  const config = googleOAuthConfig(); const url = new URL(request.url); const state = url.searchParams.get("state"); const code = url.searchParams.get("code");
  if (!config) return NextResponse.redirect(classroomPage(request, "configuration_missing"));
  const storedState = await readGoogleState();
  if (url.searchParams.get("error")) { const response = NextResponse.redirect(classroomPage(request, "oauth_denied")); clearGoogleState(response); return response; }
  if (!state || !code || !storedState || storedState.teacherId !== profile.id || !sameValue(storedState.state, state)) { const response = NextResponse.redirect(classroomPage(request, "oauth_state")); clearGoogleState(response); return response; }
  let tokenResponse: Response;
  try { tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: "authorization_code" }), cache: "no-store" }); } catch { const response = NextResponse.redirect(classroomPage(request, "oauth_exchange")); clearGoogleState(response); return response; }
  const token = await tokenResponse.json().catch(() => null) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string } | null;
  if (!tokenResponse.ok || !token?.access_token) { const response = NextResponse.redirect(classroomPage(request, "oauth_exchange")); clearGoogleState(response); return response; }
  const scopes = token.scope?.split(/\s+/).filter(Boolean) ?? [];
  if (scopes.length && GOOGLE_CLASSROOM_SCOPES.some((scope) => !scopes.includes(scope))) { const response = NextResponse.redirect(classroomPage(request, "missing_scopes")); clearGoogleState(response); return response; }
  try { await persistGoogleRefreshToken(profile.id, token.refresh_token, scopes); } catch (cause) {
    const response = NextResponse.redirect(classroomPage(request, cause instanceof GoogleClassroomError && cause.code === "refresh_token_missing" ? "refresh_token_missing" : "server_configuration")); clearGoogleState(response); return response;
  }
  const response = NextResponse.redirect(classroomPage(request));
  clearGoogleState(response); setGoogleToken(response, profile.id, token.access_token, Number(token.expires_in), scopes);
  return response;
}
