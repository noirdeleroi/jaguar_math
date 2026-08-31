"use server";

import { revalidatePath } from "next/cache";
import { requireStudent } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type PasswordChangeState = { error?: string; completed?: boolean };

export async function changeInitialPassword(_previous: PasswordChangeState, formData: FormData): Promise<PasswordChangeState> {
  const password = typeof formData.get("password") === "string" ? String(formData.get("password")) : ""; const confirmation = typeof formData.get("confirmation") === "string" ? String(formData.get("confirmation")) : "";
  if (password.length < 12) return { error: "Choose a password with at least 12 characters." };
  if (password !== confirmation) return { error: "The password confirmation does not match." };
  try {
    const student = await requireStudent(); const supabase = await createClient(); const { error: passwordError } = await supabase.auth.updateUser({ password });
    if (passwordError) return { error: "We couldn’t update your password. Please try again." };
    const admin = createAdminClient(); const { error: profileError } = await admin.from("profiles").update({ must_change_password: false }).eq("id", student.id).eq("role", "student");
    if (profileError) return { error: "Your password changed, but access could not be updated. Please contact your teacher." };
    revalidatePath("/auth/redirect"); revalidatePath("/student"); return { completed: true };
  } catch { return { error: "We couldn’t update your password. Please try again." }; }
}
