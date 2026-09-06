import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type Profile = { id: string; email: string | null; full_name: string | null; role: "student" | "teacher"; grade_level: 11 | 12 | null; must_change_password: boolean };

export const getCurrentProfile = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) return null;
  const { data: profile } = await supabase.from("profiles").select("id, email, full_name, role, grade_level, must_change_password").eq("id", userId).maybeSingle();
  return profile as Profile | null;
});

export async function requireTeacher() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "teacher") redirect("/student");
  return profile;
}

export async function requireStudent() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "teacher") redirect("/teacher");
  if (profile.must_change_password) redirect("/change-password");
  return profile;
}
