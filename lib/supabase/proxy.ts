import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authFailureRequiresLogin, hasSupabaseAuthCookie } from "@/lib/auth-check";

export async function updateSession(request: NextRequest) {
  const originalRequestHeaders = new Headers(request.headers);
  const hadAuthCookie = hasSupabaseAuthCookie(request.cookies.getAll());
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { cookies: { getAll: () => request.cookies.getAll(), setAll: (cookiesToSet) => { cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value)); response = NextResponse.next({ request }); cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options)); } } });
  const { data, error } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  if (!data?.claims.sub && (path.startsWith("/student") || path.startsWith("/teacher"))) {
    if (error && !authFailureRequiresLogin(error, hadAuthCookie)) {
      // A parallel request can consume an expiring refresh token first. Keep
      // the original cookie for the protected route's retry instead of
      // clearing it or turning a temporary refresh race into a forced logout.
      console.error(`[auth-proxy] session verification failed temporarily: name=${error.name}; status=${error.status ?? "unknown"}`);
      return NextResponse.next({ request: { headers: originalRequestHeaders } });
    }
    const url = request.nextUrl.clone(); url.pathname = "/login"; url.search = ""; url.searchParams.set("returnTo", `${path}${request.nextUrl.search}`); return NextResponse.redirect(url);
  }
  return response;
}
