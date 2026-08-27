import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Profile = { id: string; email: string | null; full_name: string | null; role: "student" | "teacher"; grade_level: 11 | 12 | null };

export async function getCurrentProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("id, email, full_name, role, grade_level").eq("id", user.id).maybeSingle();
  return profile as Profile | null;
}

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
  return profile;
}
