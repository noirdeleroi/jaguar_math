import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { cookies: { getAll: () => request.cookies.getAll(), setAll: (cookiesToSet) => { cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value)); response = NextResponse.next({ request }); cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options)); } } });
  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  if (!user && (path.startsWith("/student") || path.startsWith("/teacher"))) { const url = request.nextUrl.clone(); url.pathname = "/login"; return NextResponse.redirect(url); }
  if (user && (path.startsWith("/student") || path.startsWith("/teacher"))) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (!profile) { const url = request.nextUrl.clone(); url.pathname = "/login"; return NextResponse.redirect(url); }
    if (path.startsWith("/teacher") && profile.role !== "teacher") { const url = request.nextUrl.clone(); url.pathname = "/student"; return NextResponse.redirect(url); }
    if (path.startsWith("/student") && profile.role === "teacher") { const url = request.nextUrl.clone(); url.pathname = "/teacher"; return NextResponse.redirect(url); }
  }
  return response;
}
