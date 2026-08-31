"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createTemporaryPassword } from "@/lib/temporary-password";

const message = (path: string, key: "error" | "success", text: string) => `${path}?${key}=${encodeURIComponent(text)}`;
const gradeFrom = (value: FormDataEntryValue | null) => value === "11" || value === "12" ? Number(value) as 11 | 12 : null;
const textFrom = (value: FormDataEntryValue | null) => typeof value === "string" ? value.trim() : "";

export type ResetPasswordState = { error?: string; credential?: { fullName: string; emailAddress: string; temporaryPassword: string } };

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
