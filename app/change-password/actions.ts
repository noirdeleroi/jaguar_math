"use server";

import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth";
import { MIN_STUDENT_PASSWORD_LENGTH, passwordForAuthentication } from "@/lib/auth-password";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type PasswordChangeState = { error?: string; completed?: boolean };

export async function changeInitialPassword(_previous: PasswordChangeState, formData: FormData): Promise<PasswordChangeState> {
  const password = typeof formData.get("password") === "string" ? String(formData.get("password")) : ""; const confirmation = typeof formData.get("confirmation") === "string" ? String(formData.get("confirmation")) : "";
  if (password.length < MIN_STUDENT_PASSWORD_LENGTH) return { error: `Choose a password with at least ${MIN_STUDENT_PASSWORD_LENGTH} characters.` };
  if (password !== confirmation) return { error: "The password confirmation does not match." };
  try {
    const student = await getCurrentProfile();
    if (!student || student.role !== "student") return { error: "Your login has expired. Sign in again and retry." };
    if (!student.must_change_password) return { completed: true };
    const supabase = await createClient(); const { error: passwordError } = await supabase.auth.updateUser({ password: passwordForAuthentication(password) });
    if (passwordError) { console.error("[auth] initial password update failed", passwordError.code); return { error: "We couldn’t update your password. Sign in again and retry." }; }
    const admin = createAdminClient(); const { error: profileError } = await admin.from("profiles").update({ must_change_password: false }).eq("id", student.id).eq("role", "student");
    if (profileError) { console.error("[auth] password-change profile update failed", profileError.code); return { error: "Your password changed, but access could not be updated. Please contact your teacher." }; }
    revalidatePath("/auth/redirect"); revalidatePath("/change-password"); revalidatePath("/student"); return { completed: true };
  } catch (error) { console.error("[auth] initial password change failed", error instanceof Error ? error.message : "unknown_error"); return { error: "We couldn’t update your password. Sign in again and retry." }; }
}
