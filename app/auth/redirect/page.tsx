import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { safeReturnPath } from "@/lib/auth-return";

export default async function AuthRedirectPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const { returnTo } = await searchParams;
  const safeReturn = safeReturnPath(returnTo, profile.role);
  redirect(profile.role === "teacher" ? safeReturn ?? "/teacher" : profile.must_change_password ? "/change-password" : safeReturn ?? "/student");
}
