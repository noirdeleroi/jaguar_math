import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";

export default async function AuthRedirectPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  redirect(profile.role === "teacher" ? "/teacher" : profile.must_change_password ? "/change-password" : "/student");
}
