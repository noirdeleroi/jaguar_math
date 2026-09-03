"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createTemporaryPassword } from "@/lib/temporary-password";
import { GoogleClassroomError, getGoogleAccessToken, hasGoogleGmailSendPermission, sendGoogleCredentialEmail } from "@/lib/google-classroom";

const message = (path: string, key: "error" | "success", text: string) => `${path}?${key}=${encodeURIComponent(text)}`;
const gradeFrom = (value: FormDataEntryValue | null) => value === "11" || value === "12" ? Number(value) as 11 | 12 : null;
const textFrom = (value: FormDataEntryValue | null) => typeof value === "string" ? value.trim() : "";

export type ResetPasswordState = { error?: string; credential?: { fullName: string; emailAddress: string; temporaryPassword: string } };
export type BulkResetPasswordState = { error?: string; credentials?: Array<{ fullName: string; emailAddress: string; temporaryPassword: string; emailDelivery?: "sent" | "failed" }> };
export type AddStudentState = { error?: string; completed?: boolean; credential?: { fullName: string; emailAddress: string; temporaryPassword: string }; emailDelivery?: "sent" | "failed" };

export async function resetStudentPassword(_previous: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  try {
    const teacher = await requireTeacher(); const studentId = textFrom(formData.get("student_id")); if (!studentId) return { error: "Choose a student account." };
    const supabase = await createClient(); const { data: membership, error: membershipError } = await supabase.from("class_members").select("class_id, classes!inner(teacher_id)").eq("student_id", studentId).eq("classes.teacher_id", teacher.id).limit(1);
    if (membershipError || !membership?.length) return { error: "That student is not available in your classes." };
    const { data: student, error: studentError } = await supabase.from("profiles").select("id, full_name, email, must_change_password").eq("id", studentId).eq("role", "student").maybeSingle();
    if (studentError || !student?.email) return { error: "That student account is not available." };
    const temporaryPassword = createTemporaryPassword(); const admin = createAdminClient(); const { error: flagError } = await admin.from("profiles").update({ must_change_password: true }).eq("id", studentId).eq("role", "student");
    if (flagError) { console.error("[teacher] password-reset flag update failed", flagError.code); return { error: "We couldn’t prepare this password reset. Please try again." }; }
    const { error: authError } = await admin.auth.admin.updateUserById(studentId, { password: temporaryPassword });
    if (authError) { await admin.from("profiles").update({ must_change_password: student.must_change_password }).eq("id", studentId); console.error("[teacher] student password reset failed", authError.code); return { error: "We couldn’t reset this password. Please try again." }; }
    revalidatePath("/teacher/students"); revalidatePath(`/teacher/students/${studentId}`); return { credential: { fullName: student.full_name || "Student", emailAddress: student.email, temporaryPassword } };
  } catch { return { error: "We couldn’t reset this password. Please try again." }; }
}

export async function resetClassStudentPasswords(_previous: BulkResetPasswordState, formData: FormData): Promise<BulkResetPasswordState> {
  const teacher = await requireTeacher();
  try {
    const classId = textFrom(formData.get("class_id"));
    const studentIds = [...new Set(formData.getAll("student_id").filter((value): value is string => typeof value === "string" && value.length > 0))];
    const emailCredentials = textFrom(formData.get("delivery")) === "email";
    if (!classId || !studentIds.length) return { error: "Select at least one student." };

    const supabase = await createClient();
    const { data: classroom, error: classroomError } = await supabase.from("classes").select("id").eq("id", classId).eq("teacher_id", teacher.id).maybeSingle();
    if (classroomError || !classroom) return { error: "That class is not available." };
    const { data: memberships, error: membershipError } = await supabase.from("class_members").select("student_id").eq("class_id", classId).in("student_id", studentIds);
    if (membershipError || memberships?.length !== studentIds.length) return { error: "One or more selected students are not in this class." };
    const { data: students, error: studentError } = await supabase.from("profiles").select("id, full_name, email, must_change_password").in("id", studentIds).eq("role", "student");
    if (studentError || students?.length !== studentIds.length || students.some((student) => !student.email)) return { error: "One or more selected student accounts are unavailable." };

    let googleAccessToken: string | null = null;
    if (emailCredentials) {
      if (!(await hasGoogleGmailSendPermission(teacher.id))) return { error: "Reconnect Google to enable email sending." };
      const connection = await getGoogleAccessToken(teacher.id);
      if (connection.status !== "connected" || !connection.token) return { error: "Reconnect Google to enable email sending." };
      googleAccessToken = connection.token;
    }

    const admin = createAdminClient();
    const { error: flagError } = await admin.from("profiles").update({ must_change_password: true }).in("id", studentIds).eq("role", "student");
    if (flagError) { console.error("[teacher] bulk password-reset flag update failed", flagError.code); return { error: "We couldn’t prepare these password resets. Please try again." }; }

    const usedPasswords = new Set<string>(); const credentials: NonNullable<BulkResetPasswordState["credentials"]> = []; let failed = 0; let emailFailed = 0;
    for (const student of students) {
      const temporaryPassword = createTemporaryPassword(usedPasswords); const { error: authError } = await admin.auth.admin.updateUserById(student.id, { password: temporaryPassword });
      if (authError) { failed += 1; await admin.from("profiles").update({ must_change_password: student.must_change_password }).eq("id", student.id).eq("role", "student"); console.error("[teacher] bulk student password reset failed", authError.code); continue; }
      const credential = { fullName: student.full_name || "Student", emailAddress: student.email!, temporaryPassword };
      if (googleAccessToken) {
        try { await sendGoogleCredentialEmail(googleAccessToken, credential); credentials.push({ ...credential, emailDelivery: "sent" }); }
        catch (cause) { emailFailed += 1; credentials.push({ ...credential, emailDelivery: "failed" }); console.error("[teacher] credential email failed", cause instanceof GoogleClassroomError ? cause.code : "server_error"); }
      } else credentials.push(credential);
    }
    revalidatePath(`/teacher/classes/${classId}`); revalidatePath("/teacher/students");
    const errors = [];
    if (failed) errors.push(`${failed} ${failed === 1 ? "student password could" : "student passwords could"} not be reset`);
    if (emailFailed) errors.push(`${emailFailed} ${emailFailed === 1 ? "email was" : "emails were"} not delivered; use the one-time credentials below to share them manually`);
    if (errors.length) return { credentials, error: `${errors.join(". ")}.` };
    return { credentials };
  } catch (error) { console.error("[teacher] bulk password reset failed", error instanceof Error ? error.name : "unknown"); return { error: "We couldn’t reset these passwords. Please try again." }; }
}

function nameFromEmail(email: string) {
  const localPart = email.split("@")[0] ?? "Student";
  return localPart.split(/[._-]+/).filter(Boolean).map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ") || "Student";
}

export async function createAndEmailStudent(_previous: AddStudentState, formData: FormData): Promise<AddStudentState> {
  void _previous;
  let createdUserId: string | null = null;
  try {
    const teacher = await requireTeacher(); const classId = textFrom(formData.get("class_id")); const emailAddress = textFrom(formData.get("email")).toLowerCase(); const fullName = textFrom(formData.get("full_name")) || nameFromEmail(emailAddress);
    if (!classId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress) || /[\r\n]/.test(emailAddress)) return { error: "Enter a valid student email address." };
    const supabase = await createClient(); const { data: classroom, error: classError } = await supabase.from("classes").select("id, grade_level").eq("id", classId).eq("teacher_id", teacher.id).maybeSingle();
    if (classError || !classroom) return { error: "Choose one of your classes." };
    if (!(await hasGoogleGmailSendPermission(teacher.id))) return { error: "Reconnect Google to enable credential email delivery." };
    const connection = await getGoogleAccessToken(teacher.id);
    if (connection.status !== "connected" || !connection.token) return { error: "Reconnect Google to enable credential email delivery." };

    const admin = createAdminClient(); const { data: existingProfile, error: profileLookupError } = await admin.from("profiles").select("id").eq("email", emailAddress).maybeSingle();
    if (profileLookupError) throw profileLookupError;
    if (existingProfile) return { error: "A Jaguar Math account already uses that email. Add the existing student from the class page instead." };

    const temporaryPassword = createTemporaryPassword(); const { data: authData, error: authError } = await admin.auth.admin.createUser({ email: emailAddress, password: temporaryPassword, email_confirm: true, user_metadata: { full_name: fullName } });
    if (authError || !authData.user) { console.error("[teacher] dashboard student creation failed", authError?.code ?? "server_error"); return { error: "We couldn’t create that student account. It may already exist." }; }
    createdUserId = authData.user.id;
    const { error: profileError } = await admin.from("profiles").update({ full_name: fullName, grade_level: classroom.grade_level, must_change_password: true }).eq("id", createdUserId).eq("role", "student");
    if (profileError) throw profileError;
    const { error: membershipError } = await admin.from("class_members").insert({ class_id: classId, student_id: createdUserId });
    if (membershipError) throw membershipError;

    const credential = { fullName, emailAddress, temporaryPassword };
    try {
      await sendGoogleCredentialEmail(connection.token, credential);
      revalidatePath("/teacher"); revalidatePath("/teacher/classes"); revalidatePath(`/teacher/classes/${classId}`); revalidatePath("/teacher/students");
      return { completed: true, credential, emailDelivery: "sent" };
    } catch (cause) {
      console.error("[teacher] dashboard credential email failed", cause instanceof GoogleClassroomError ? cause.code : "server_error");
      revalidatePath("/teacher"); revalidatePath("/teacher/classes"); revalidatePath(`/teacher/classes/${classId}`); revalidatePath("/teacher/students");
      return { completed: true, credential, emailDelivery: "failed", error: "The account and class enrollment were created, but email delivery failed. Share the one-time password below manually." };
    }
  } catch (cause) {
    if (createdUserId) {
      try { await createAdminClient().auth.admin.deleteUser(createdUserId); } catch { console.error("[teacher] dashboard student cleanup failed"); }
    }
    console.error("[teacher] dashboard student creation failed", cause instanceof Error ? cause.name : "unknown");
    return { error: "We couldn’t create and enroll that student. Please try again." };
  }
}

export async function createClass(formData: FormData) {
  const teacher = await requireTeacher(); const name = textFrom(formData.get("name")); const academicYear = textFrom(formData.get("academic_year")); const gradeLevel = gradeFrom(formData.get("grade_level"));
  if (!name || !academicYear || !gradeLevel) redirect(message("/teacher/classes", "error", "Enter a class name, grade, and academic year."));
  const supabase = await createClient(); const { error } = await supabase.from("classes").insert({ name, grade_level: gradeLevel, academic_year: academicYear, teacher_id: teacher.id });
  if (error) redirect(message("/teacher/classes", "error", error.code === "23505" ? "A class with that name already exists for this academic year." : "We couldn’t create that class. Please try again."));
  revalidatePath("/teacher"); revalidatePath("/teacher/classes"); redirect(message("/teacher/classes", "success", "Class created."));
}

export async function updateClass(formData: FormData) {
  const teacher = await requireTeacher(); const id = textFrom(formData.get("class_id")); const name = textFrom(formData.get("name")); const academicYear = textFrom(formData.get("academic_year")); const gradeLevel = gradeFrom(formData.get("grade_level")); const path = `/teacher/classes/${id}`;
  if (!id || !name || !academicYear || !gradeLevel) redirect(message(path, "error", "Enter a class name, grade, and academic year."));
  if (!(await teacherOwnsClass(id, teacher.id))) redirect(message("/teacher/classes", "error", "That class is not available."));
  const supabase = await createClient(); const { error } = await supabase.from("classes").update({ name, grade_level: gradeLevel, academic_year: academicYear }).eq("id", id);
  if (error) redirect(message(path, "error", error.code === "23505" ? "A class with that name already exists for this academic year." : "We couldn’t update that class."));
  revalidatePath("/teacher"); revalidatePath("/teacher/classes"); revalidatePath(path); redirect(message(path, "success", "Class updated."));
}

export async function deleteClass(formData: FormData) {
  const teacher = await requireTeacher(); const id = textFrom(formData.get("class_id"));
  if (!id || !(await teacherOwnsClass(id, teacher.id))) redirect(message("/teacher/classes", "error", "That class is not available."));
  const supabase = await createClient(); const { error } = await supabase.from("classes").delete().eq("id", id).eq("teacher_id", teacher.id);
  if (error) redirect(message(`/teacher/classes/${id}`, "error", "We couldn’t delete that class."));
  revalidatePath("/teacher"); revalidatePath("/teacher/classes"); revalidatePath(`/teacher/classes/${id}`); revalidatePath(`/teacher/classes/${id}/progress`); revalidatePath("/teacher/students"); redirect(message("/teacher/classes", "success", "Class deleted."));
}

async function teacherOwnsClass(classId: string, teacherId: string) {
  const supabase = await createClient(); const { data, error } = await supabase.from("classes").select("id, teacher_id").eq("id", classId).maybeSingle(); return !error && data?.teacher_id === teacherId;
}

export async function addStudentToClass(formData: FormData) {
  const teacher = await requireTeacher(); const classId = textFrom(formData.get("class_id")); const studentId = textFrom(formData.get("student_id")); const path = `/teacher/classes/${classId}`;
  if (!classId || !studentId || !(await teacherOwnsClass(classId, teacher.id))) redirect(message("/teacher/classes", "error", "That class is not available."));
  const supabase = await createClient(); const { data: student } = await supabase.from("profiles").select("id").eq("id", studentId).eq("role", "student").maybeSingle();
  if (!student) redirect(message(path, "error", "Choose an existing student account."));
  const { error } = await supabase.from("class_members").insert({ class_id: classId, student_id: studentId });
  if (error) redirect(message(path, "error", error.code === "23505" ? "That student is already in this class." : "We couldn’t add that student."));
  revalidatePath("/teacher"); revalidatePath("/teacher/classes"); revalidatePath(path); revalidatePath("/teacher/students"); redirect(message(path, "success", "Student added to class."));
}

export async function removeStudentFromClass(formData: FormData) {
  const teacher = await requireTeacher(); const classId = textFrom(formData.get("class_id")); const studentId = textFrom(formData.get("student_id")); const path = `/teacher/classes/${classId}`;
  if (!classId || !studentId || !(await teacherOwnsClass(classId, teacher.id))) redirect(message("/teacher/classes", "error", "That class is not available."));
  const supabase = await createClient(); const { error } = await supabase.from("class_members").delete().eq("class_id", classId).eq("student_id", studentId);
  if (error) redirect(message(path, "error", "We couldn’t remove that student."));
  revalidatePath("/teacher"); revalidatePath("/teacher/classes"); revalidatePath(path); revalidatePath("/teacher/students"); redirect(message(path, "success", "Student removed from class."));
}

export async function updateStudentProfile(formData: FormData) {
  await requireTeacher(); const studentId = textFrom(formData.get("student_id")); const fullName = textFrom(formData.get("full_name")); const gradeLevel = formData.get("grade_level") === "" ? null : gradeFrom(formData.get("grade_level"));
  if (!studentId || (formData.get("grade_level") !== "" && !gradeLevel)) redirect(message("/teacher/students", "error", "Choose Grade 11, Grade 12, or no grade."));
  const supabase = await createClient(); const { data, error } = await supabase.from("profiles").update({ full_name: fullName || null, grade_level: gradeLevel }).eq("id", studentId).eq("role", "student").select("id").maybeSingle();
  if (error || !data) redirect(message("/teacher/students", "error", "We couldn’t update that student profile."));
  revalidatePath("/teacher"); revalidatePath("/teacher/classes"); revalidatePath("/teacher/students"); redirect(message("/teacher/students", "success", "Student profile updated."));
}
