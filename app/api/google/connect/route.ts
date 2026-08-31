import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { GOOGLE_CLASSROOM_SCOPES, googleOAuthConfig, setGoogleState } from "@/lib/google-classroom";

const classroomPage = (request: Request, error?: string) => new URL(`/teacher/google-classroom${error ? `?error=${encodeURIComponent(error)}` : ""}`, request.url);

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.redirect(new URL("/login", request.url));
  if (profile.role !== "teacher") return NextResponse.redirect(new URL("/student", request.url));
  const config = googleOAuthConfig();
  if (!config) return NextResponse.redirect(classroomPage(request, "configuration_missing"));
  const state = randomBytes(32).toString("base64url");
  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code", scope: GOOGLE_CLASSROOM_SCOPES.join(" "), state, access_type: "offline", prompt: "consent", include_granted_scopes: "true" }).toString();
  const response = NextResponse.redirect(authorization);
  setGoogleState(response, state, profile.id);
  return response;
}
