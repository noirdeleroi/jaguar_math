"use server";

import { revalidatePath } from "next/cache";
import { requireTeacher } from "@/lib/auth";
import { GoogleClassroomError, GoogleCourse, GoogleRosterStudent, GoogleSyncTarget, clearGoogleSyncPreview, getGoogleAccessToken, listCourseStudents, listTeacherCourses, readGoogleSyncPreview, setGoogleSyncPreview } from "@/lib/google-classroom";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTemporaryPassword } from "@/lib/temporary-password";

type Profile = { id: string; email: string | null; full_name: string | null; role: string };
type StudentMapping = { google_user_id: string; student_id: string; google_full_name: string | null };
type CourseMapping = { google_course_id: string; class_id: string; teacher_id: string };
export type SyncStudent = { userId: string; fullName: string; emailAddress: string; status: "Existing / linked" | "Existing / matched by email" | "New account" | "Needs review"; studentId?: string; note?: string };
export type RemovedStudent = { studentId: string; fullName: string; emailAddress: string };
export type SyncPreview = { course: GoogleCourse; target: GoogleSyncTarget; students: SyncStudent[]; removed: RemovedStudent[]; existingCount: number; newCount: number; canApply: boolean };
export type SyncActionState = { error?: string; preview?: SyncPreview; credentials?: { fullName: string; emailAddress: string; temporaryPassword: string }[]; completed?: boolean; removedCount?: number };

const text = (value: FormDataEntryValue | null) => typeof value === "string" ? value.trim() : "";
const normalizedEmail = (email: string) => email.trim().toLowerCase();
const rosterFingerprint = (students: GoogleRosterStudent[]) => students.map((student) => `${student.userId}\u0000${normalizedEmail(student.emailAddress)}`).sort().join("\n");

function actionError(cause: unknown) {
  if (cause instanceof GoogleClassroomError) {
    if (cause.code === "token_expired" || cause.code === "refresh_token_missing") return "Your Google connection needs to be renewed. Connect Google Classroom again.";
    if (cause.code === "missing_scopes") return "Google did not grant all required Classroom permissions. Reconnect and approve the requested scopes.";
    if (cause.code === "admin_restricted") return "Google Workspace has restricted this Classroom request. Ask your Workspace administrator to allow it.";
  }
  return "The Google Classroom sync could not be prepared. Please try again.";
}

async function loadGoogleCourse(teacherId: string, courseId: string) {
  const connection = await getGoogleAccessToken(teacherId);
  if (connection.status !== "connected" || !connection.token) throw new GoogleClassroomError(connection.status === "expired" ? "token_expired" : "refresh_token_missing");
  const courses = await listTeacherCourses(connection.token); const course = courses.find((item) => item.id === courseId);
  if (!course) throw new Error("Course is not available to this teacher.");
  return { course, students: await listCourseStudents(course.id, connection.token) };
}

async function resolveTarget(teacherId: string, courseId: string, formData: FormData): Promise<GoogleSyncTarget> {
  const admin = createAdminClient(); const { data: mappedCourse, error: mappingError } = await admin.from("google_classroom_courses").select("google_course_id, class_id, teacher_id").eq("google_course_id", courseId).maybeSingle<CourseMapping>();
  if (mappingError) throw mappingError;
  if (mappedCourse) {
    if (mappedCourse.teacher_id !== teacherId) throw new Error("Course mapping is unavailable.");
    return { kind: "existing", classId: mappedCourse.class_id };
  }
  if (text(formData.get("target_kind")) === "existing") {
    const classId = text(formData.get("class_id")); if (!classId) throw new Error("Choose a Jaguar Math class.");
    const { data: classroom, error } = await admin.from("classes").select("id").eq("id", classId).eq("teacher_id", teacherId).maybeSingle();
    if (error || !classroom) throw new Error("Class is not available.");
    const { data: alreadyMapped } = await admin.from("google_classroom_courses").select("google_course_id").eq("class_id", classId).maybeSingle();
    if (alreadyMapped) throw new Error("That Jaguar Math class is already linked to a Google course.");
    return { kind: "existing", classId };
  }
  const name = text(formData.get("class_name")); const academicYear = text(formData.get("academic_year")); const grade = text(formData.get("grade_level"));
  if (!name || !academicYear || (grade !== "11" && grade !== "12")) throw new Error("Enter a class name, grade, and academic year.");
  const { data: duplicate, error } = await admin.from("classes").select("id").eq("teacher_id", teacherId).eq("name", name).eq("academic_year", academicYear).maybeSingle();
  if (error) throw error;
  if (duplicate) throw new Error("A Jaguar Math class with that name and academic year already exists. Link this Google course to it instead.");
  return { kind: "create", name, academicYear, gradeLevel: Number(grade) as 11 | 12 };
}

async function buildPreview(teacherId: string, course: GoogleCourse, roster: GoogleRosterStudent[], target: GoogleSyncTarget): Promise<SyncPreview> {
  const admin = createAdminClient();
  const googleIds = roster.map((student) => student.userId); const rosterIds = new Set(googleIds); const emails = new Set(roster.map((student) => normalizedEmail(student.emailAddress)).filter((email) => email && email !== "no email address"));
  const [{ data: mappings, error: mappingsError }, { data: profiles, error: profilesError }] = await Promise.all([
    googleIds.length ? admin.from("google_classroom_students").select("google_user_id, student_id, google_full_name").in("google_user_id", googleIds) : Promise.resolve({ data: [] as StudentMapping[], error: null }),
    admin.from("profiles").select("id, email, full_name, role").eq("role", "student"),
  ]);
  if (mappingsError || profilesError) throw mappingsError ?? profilesError;
  const profileById = new Map((profiles as Profile[]).map((profile) => [profile.id, profile])); const profileByEmail = new Map((profiles as Profile[]).filter((profile) => profile.email).map((profile) => [normalizedEmail(profile.email!), profile])); const mappingByGoogleId = new Map((mappings as StudentMapping[]).map((mapping) => [mapping.google_user_id, mapping]));
  const usedStudentIds = new Set<string>(); let existingCount = 0; let newCount = 0; let canApply = true;
  let students = roster.map((student): SyncStudent => {
    const mapped = mappingByGoogleId.get(student.userId); const email = normalizedEmail(student.emailAddress); const byEmail = emails.has(email) ? profileByEmail.get(email) : undefined; const profile = mapped ? profileById.get(mapped.student_id) : byEmail;
    if (mapped && !profile) { canApply = false; return { ...student, status: "Needs review", note: "The stored Google link no longer points to a student account." }; }
    if (profile && usedStudentIds.has(profile.id)) { canApply = false; return { ...student, status: "Needs review", note: "Two Google roster entries resolve to the same Jaguar Math student." }; }
    if (profile) { usedStudentIds.add(profile.id); existingCount += 1; return { ...student, studentId: profile.id, status: mapped ? "Existing / linked" : "Existing / matched by email" }; }
    if (!emails.has(email)) { canApply = false; return { ...student, status: "Needs review", note: "Google Classroom did not provide a usable email address for account creation." }; }
    newCount += 1; return { ...student, status: "New account" };
  });
  const candidateStudentIds = students.flatMap((student) => student.studentId ? [student.studentId] : []);
  if (candidateStudentIds.length) {
    const { data: existingLinks, error } = await admin.from("google_classroom_students").select("google_user_id, student_id").in("student_id", candidateStudentIds);
    if (error) throw error;
    const linkedGoogleIdByStudentId = new Map((existingLinks ?? []).map((link) => [link.student_id, link.google_user_id]));
    students = students.map((student) => {
      const linkedGoogleId = student.studentId ? linkedGoogleIdByStudentId.get(student.studentId) : undefined;
      if (linkedGoogleId && linkedGoogleId !== student.userId) { existingCount -= 1; canApply = false; return { ...student, status: "Needs review", note: "This Jaguar Math student is already linked to a different Google user." }; }
      return student;
    });
  }
  let removed: RemovedStudent[] = [];
  if (target.kind === "existing") {
    const { data: members, error: membersError } = await admin.from("class_members").select("student_id").eq("class_id", target.classId);
    if (membersError) throw membersError;
    const memberIds = (members ?? []).map((member) => member.student_id);
    if (memberIds.length) {
      const { data: memberMappings, error } = await admin.from("google_classroom_students").select("google_user_id, student_id").in("student_id", memberIds);
      if (error) throw error;
      removed = (memberMappings ?? []).filter((mapping) => !rosterIds.has(mapping.google_user_id)).flatMap((mapping) => {
        const profile = profileById.get(mapping.student_id); return profile ? [{ studentId: profile.id, fullName: profile.full_name || "Unnamed student", emailAddress: profile.email || "No email address" }] : [];
      });
    }
  }
  return { course, target, students, removed, existingCount, newCount, canApply };
}

export async function previewGoogleClassroomSync(_previous: SyncActionState, formData: FormData): Promise<SyncActionState> {
  try {
    const teacher = await requireTeacher(); const courseId = text(formData.get("course_id")); if (!courseId) throw new Error("Choose a Google course.");
    const { course, students } = await loadGoogleCourse(teacher.id, courseId); const target = await resolveTarget(teacher.id, courseId, formData); const preview = await buildPreview(teacher.id, course, students, target);
    await setGoogleSyncPreview({ teacherId: teacher.id, courseId, target, rosterFingerprint: rosterFingerprint(students) });
    return { preview };
  } catch (cause) { console.error("[google-classroom] sync preview failed", cause instanceof GoogleClassroomError ? cause.code : "server_error"); return { error: actionError(cause) }; }
}

async function cleanupCreatedUsers(studentIds: string[]) {
  if (!studentIds.length) return;
  try {
    const admin = createAdminClient(); await admin.from("google_classroom_students").delete().in("student_id", studentIds);
    await Promise.all(studentIds.map((studentId) => admin.auth.admin.deleteUser(studentId)));
  } catch { console.error("[google-classroom] created-account cleanup failed"); }
}

export async function applyGoogleClassroomSync(_previous: SyncActionState, formData: FormData): Promise<SyncActionState> {
  const createdUserIds: string[] = [];
  try {
    const teacher = await requireTeacher(); const confirmation = await readGoogleSyncPreview();
    if (!confirmation || confirmation.teacherId !== teacher.id) return { error: "Preview the Google Classroom changes again before confirming." };
    const { course, students } = await loadGoogleCourse(teacher.id, confirmation.courseId);
    if (rosterFingerprint(students) !== confirmation.rosterFingerprint) { await clearGoogleSyncPreview(); return { error: "The Google Classroom roster changed. Review the updated preview before syncing." }; }
    const preview = await buildPreview(teacher.id, course, students, confirmation.target);
    if (!preview.canApply) return { error: "Resolve the roster entries marked Needs review before syncing.", preview };
    const admin = createAdminClient(); let classId = confirmation.target.kind === "existing" ? confirmation.target.classId : "";
    if (confirmation.target.kind === "create") {
      const { data: classroom, error } = await admin.from("classes").insert({ name: confirmation.target.name, grade_level: confirmation.target.gradeLevel, academic_year: confirmation.target.academicYear, teacher_id: teacher.id }).select("id").single();
      if (error || !classroom) throw error ?? new Error("Class creation failed."); classId = classroom.id;
    }
    const { data: existingCourse } = await admin.from("google_classroom_courses").select("class_id, teacher_id").eq("google_course_id", course.id).maybeSingle();
    if (existingCourse && (existingCourse.teacher_id !== teacher.id || existingCourse.class_id !== classId)) throw new Error("Google course mapping changed.");
    const credentials: { fullName: string; emailAddress: string; temporaryPassword: string }[] = []; const usedPasswords = new Set<string>();
    const studentIdByGoogleId = new Map(preview.students.filter((student) => student.studentId).map((student) => [student.userId, student.studentId!]));
    for (const student of preview.students.filter((student) => student.status === "New account")) {
      const temporaryPassword = createTemporaryPassword(usedPasswords); const { data, error } = await admin.auth.admin.createUser({ email: student.emailAddress, password: temporaryPassword, email_confirm: true, user_metadata: { full_name: student.fullName } });
      if (error || !data.user) throw error ?? new Error("Student account creation failed.");
      const { error: flagError } = await admin.from("profiles").update({ must_change_password: true }).eq("id", data.user.id).eq("role", "student");
      if (flagError) throw flagError;
      createdUserIds.push(data.user.id); studentIdByGoogleId.set(student.userId, data.user.id); credentials.push({ fullName: student.fullName, emailAddress: student.emailAddress, temporaryPassword });
    }
    const { error: courseError } = await admin.from("google_classroom_courses").upsert({ google_course_id: course.id, class_id: classId, teacher_id: teacher.id, google_course_name: course.name || "Untitled course", google_course_section: course.section || null, google_course_state: course.courseState || null, last_synced_at: new Date().toISOString() }, { onConflict: "google_course_id" });
    if (courseError) throw courseError;
    for (const student of preview.students) {
      const studentId = studentIdByGoogleId.get(student.userId); if (!studentId) throw new Error("Student profile was unavailable after account creation.");
      const prior = student.status === "Existing / linked" ? student : undefined;
      if (!prior || student.fullName) {
        const { data: currentProfile } = await admin.from("profiles").select("full_name").eq("id", studentId).maybeSingle();
        if (!currentProfile?.full_name || (prior && currentProfile.full_name === (await admin.from("google_classroom_students").select("google_full_name").eq("google_user_id", student.userId).maybeSingle()).data?.google_full_name)) await admin.from("profiles").update({ full_name: student.fullName }).eq("id", studentId);
      }
      const rosterStudent = students.find((item) => item.userId === student.userId)!;
      const { error: mappingError } = await admin.from("google_classroom_students").upsert({ google_user_id: student.userId, student_id: studentId, normalized_email: normalizedEmail(student.emailAddress), google_full_name: student.fullName, google_photo_url: rosterStudent.photoUrl || null, last_seen_at: new Date().toISOString() }, { onConflict: "google_user_id" });
      if (mappingError) throw mappingError;
      const { error: membershipError } = await admin.from("class_members").upsert({ class_id: classId, student_id: studentId }, { onConflict: "class_id,student_id", ignoreDuplicates: true });
      if (membershipError) throw membershipError;
    }
    const removeMissing = formData.get("remove_missing") === "on";
    if (removeMissing && preview.removed.length) {
      const { error } = await admin.from("class_members").delete().eq("class_id", classId).in("student_id", preview.removed.map((student) => student.studentId)); if (error) throw error;
    }
    await clearGoogleSyncPreview(); revalidatePath("/teacher"); revalidatePath("/teacher/classes"); revalidatePath(`/teacher/classes/${classId}`); revalidatePath("/teacher/students"); revalidatePath("/teacher/google-classroom");
    return { completed: true, credentials, removedCount: removeMissing ? preview.removed.length : 0 };
  } catch (cause) {
    await cleanupCreatedUsers(createdUserIds); console.error("[google-classroom] sync failed", cause instanceof GoogleClassroomError ? cause.code : "server_error"); return { error: actionError(cause) };
  }
}
