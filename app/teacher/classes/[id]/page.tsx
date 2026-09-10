import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { loadTeacherCurrentWeek } from "@/lib/classroom-star-data";
import { curriculumTopic } from "@/lib/curriculum-weeks";
import { hasGoogleGmailSendPermission } from "@/lib/google-classroom";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import ClassAchievementManager, { type ManagerAssessment, type ManagerStudent, type ManagerWeek, type WeekAchievement, type WorkSummary } from "./class-achievement-manager";
import ClassManagerDialogs from "./class-manager-dialogs";
import ManageStudentCredentials from "./manage-student-credentials";
import styles from "./class-manager.module.css";

type Student = { id: string; full_name: string | null; email: string | null; grade_level: number | null };
type ClassroomWeek = { id: string; label: string; sort_order: number; title: string | null; focus: string | null };
type WorkItem = { id: string; week_id: string; kind: "homework" | "classwork" };
type WorkStatus = { work_item_id: string; student_id: string; status: string };
type Assessment = { id: string; title: string; kind: string; status: string; due_at: string | null };
type Attempt = { id: string; assignment_id: string; student_id: string; score: number | null; max_score: number | null; attempt_number: number };

function firstName(value: string) { return value.trim().split(/\s+/)[0] ?? value; }
function emptyWork(): WorkSummary { return { ok: 0, notOk: 0, late: 0, recorded: 0 }; }
function emptyWeek(): WeekAchievement { return { stars: 0, homework: emptyWork(), classwork: emptyWork() }; }
function addWork(target: WorkSummary, status: string) {
  if (!["ok", "done", "not_ok", "missing", "late"].includes(status)) return;
  target.recorded += 1;
  if (status === "ok" || status === "done") target.ok += 1;
  if (status === "not_ok" || status === "missing") target.notOk += 1;
  if (status === "late") target.late += 1;
}
function sumWork(target: WorkSummary, source: WorkSummary) { target.ok += source.ok; target.notOk += source.notOk; target.late += source.late; target.recorded += source.recorded; }
function percentage(ok: number, recorded: number) { return recorded ? `${Math.round(ok / recorded * 100)}%` : "—"; }

export default async function ClassDetailPage({ params, searchParams }: PageProps<"/teacher/classes/[id]">) {
  const teacher = await requireTeacher();
  const { id } = await params;
  const messages = await searchParams;
  const supabase = await createClient();
  const { data: classroom, error: classroomError } = await supabase.from("classes").select("id, name, grade_level, academic_year, teacher_id").eq("id", id).maybeSingle();
  if (classroomError || !classroom || classroom.teacher_id !== teacher.id) notFound();

  const admin = createAdminClient();
  const [{ data: members, error: memberError }, { data: allStudents, error: studentError }, { data: weekRows, error: weekError }, { data: starEvents, error: starError }, { data: workItemRows, error: workItemError }, { data: assignmentLinks, error: linkError }, currentWeekLabel, gmailSendEnabled, { data: googleCourse }] = await Promise.all([
    supabase.from("class_members").select("student_id").eq("class_id", id),
    supabase.from("profiles").select("id, full_name, email, grade_level").eq("role", "student"),
    supabase.from("classroom_weeks").select("id, label, sort_order, title, focus").eq("class_id", id).order("sort_order"),
    supabase.from("classroom_star_events").select("student_id, week_id, delta").eq("class_id", id),
    supabase.from("classroom_work_items").select("id, week_id, kind").eq("class_id", id),
    supabase.from("assignment_classes").select("assignment_id").eq("class_id", id),
    loadTeacherCurrentWeek(teacher.id),
    hasGoogleGmailSendPermission(teacher.id),
    admin.from("google_classroom_courses").select("google_course_id").eq("class_id", id).eq("teacher_id", teacher.id).maybeSingle(),
  ]);
  const dataError = memberError ?? studentError ?? weekError ?? starError ?? workItemError ?? linkError;
  if (dataError) throw dataError;

  const studentsById = new Map(((allStudents ?? []) as Student[]).map((student) => [student.id, student]));
  const memberIds = new Set((members ?? []).map(({ student_id }) => student_id));
  const enrolled = [...memberIds].map((studentId) => studentsById.get(studentId)).filter((student): student is Student => Boolean(student)).sort((a, b) => firstName(a.full_name || a.email || "Unnamed student").localeCompare(firstName(b.full_name || b.email || "Unnamed student"), undefined, { sensitivity: "base" }) || (a.full_name || "").localeCompare(b.full_name || "", undefined, { sensitivity: "base" }));
  const available = ((allStudents ?? []) as Student[]).filter((student) => !memberIds.has(student.id)).sort((a, b) => firstName(a.full_name || a.email || "").localeCompare(firstName(b.full_name || b.email || ""), undefined, { sensitivity: "base" }));
  const weeks = (weekRows ?? []) as ClassroomWeek[];
  const workItems = (workItemRows ?? []) as WorkItem[];
  const workItemIds = workItems.map((item) => item.id);
  const assignmentIds = (assignmentLinks ?? []).map((link) => link.assignment_id);
  const [{ data: statusRows, error: statusError }, { data: assessmentRows, error: assessmentError }] = await Promise.all([
    workItemIds.length ? supabase.from("classroom_work_statuses").select("work_item_id, student_id, status").in("work_item_id", workItemIds) : Promise.resolve({ data: [] as WorkStatus[], error: null }),
    assignmentIds.length ? supabase.from("assignments").select("id, title, kind, status, due_at").in("id", assignmentIds).eq("created_by", teacher.id).eq("include_in_class_manager", true).in("status", ["published", "closed"]).order("due_at", { ascending: true, nullsFirst: false }) : Promise.resolve({ data: [] as Assessment[], error: null }),
  ]);
  if (statusError || assessmentError) throw statusError ?? assessmentError;
  const assessmentIds = (assessmentRows ?? []).map((assessment) => assessment.id);
  const { data: attemptRows, error: attemptError } = assessmentIds.length && enrolled.length ? await supabase.from("attempts").select("id, assignment_id, student_id, score, max_score, attempt_number").in("assignment_id", assessmentIds).in("student_id", enrolled.map((student) => student.id)).eq("status", "submitted").order("attempt_number", { ascending: false }) : { data: [] as Attempt[], error: null };
  if (attemptError) throw attemptError;

  const weekById = new Map(weeks.map((week) => [week.id, week]));
  const workItemById = new Map(workItems.map((item) => [item.id, item]));
  const achievements = new Map<string, Record<string, WeekAchievement>>();
  function studentWeeks(studentId: string) {
    const existing = achievements.get(studentId);
    if (existing) return existing;
    const created = Object.fromEntries(weeks.map((week) => [week.label, emptyWeek()]));
    achievements.set(studentId, created);
    return created;
  }
  for (const event of starEvents ?? []) { const week = weekById.get(event.week_id); if (week && memberIds.has(event.student_id)) studentWeeks(event.student_id)[week.label].stars += Number(event.delta); }
  for (const status of (statusRows ?? []) as WorkStatus[]) {
    if (!memberIds.has(status.student_id)) continue;
    const item = workItemById.get(status.work_item_id); const week = item ? weekById.get(item.week_id) : null;
    if (!item || !week) continue;
    addWork(item.kind === "homework" ? studentWeeks(status.student_id)[week.label].homework : studentWeeks(status.student_id)[week.label].classwork, status.status);
  }

  const latestAttempt = new Map<string, Attempt>();
  for (const attempt of (attemptRows ?? []) as Attempt[]) { const key = `${attempt.student_id}|${attempt.assignment_id}`; if (!latestAttempt.has(key)) latestAttempt.set(key, attempt); }
  const managerStudents: ManagerStudent[] = enrolled.map((student) => {
    const studentAchievement = studentWeeks(student.id); const homework = emptyWork(); const classwork = emptyWork(); let totalStars = 0;
    for (const week of Object.values(studentAchievement)) { totalStars += week.stars; sumWork(homework, week.homework); sumWork(classwork, week.classwork); }
    const scores: ManagerStudent["scores"] = {};
    for (const assessment of assessmentRows ?? []) { const attempt = latestAttempt.get(`${student.id}|${assessment.id}`); if (!attempt || Number(attempt.max_score ?? 0) <= 0) continue; scores[assessment.id] = { attemptId: attempt.id, score: Number(attempt.score ?? 0), maxScore: Number(attempt.max_score), percent: Math.round(Number(attempt.score ?? 0) / Number(attempt.max_score) * 100) }; }
    const scoreValues = Object.values(scores).map((score) => score.percent);
    return { id: student.id, fullName: student.full_name || student.email || "Unnamed student", email: student.email, totalStars, homework, classwork, weeks: studentAchievement, scores, assessmentAverage: scoreValues.length ? Math.round(scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length) : null };
  });
  const managerWeeks: ManagerWeek[] = weeks.map((week) => { const curriculum = curriculumTopic(classroom.grade_level, week.label); return { id: week.id, label: week.label, sortOrder: week.sort_order, unit: week.title || curriculum?.unit || `Week ${week.label}`, topic: week.focus || curriculum?.topic || "Topic not set", homeworkItems: workItems.filter((item) => item.week_id === week.id && item.kind === "homework").length, classworkItems: workItems.filter((item) => item.week_id === week.id && item.kind === "classwork").length }; });
  const managerAssessments: ManagerAssessment[] = ((assessmentRows ?? []) as Assessment[]).map((assessment) => { const values = managerStudents.flatMap((student) => student.scores[assessment.id] ? [student.scores[assessment.id].percent] : []); return { id: assessment.id, title: assessment.title, kind: assessment.kind, status: assessment.status, average: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null }; });
  const currentCurriculum = curriculumTopic(classroom.grade_level, currentWeekLabel);
  const classStars = managerStudents.reduce((sum, student) => sum + student.totalStars, 0); const homework = emptyWork(); const classwork = emptyWork();
  managerStudents.forEach((student) => { sumWork(homework, student.homework); sumWork(classwork, student.classwork); });
  const submittedScores = managerStudents.flatMap((student) => student.assessmentAverage === null ? [] : [student.assessmentAverage]);
  const assessmentAverage = submittedScores.length ? `${Math.round(submittedScores.reduce((sum, score) => sum + score, 0) / submittedScores.length)}%` : "—";

  return <main className={`teacher-main ${styles.main}`}>
    <Link className="back-link" href="/teacher/classes">← All classes</Link>
    <section className={styles.hero}><div><p className="eyebrow">Grade {classroom.grade_level} · {classroom.academic_year}</p><h1>{classroom.name}</h1><p>{enrolled.length} {enrolled.length === 1 ? "student" : "students"} · Complete class achievement manager</p></div><div className={styles.heroActions}><Link href={`/teacher/classes/${id}/stars?week=${currentWeekLabel}`}>Open {currentWeekLabel} Stars →</Link><Link href={`/teacher/classes/${id}/sitting`}>Seating chart →</Link>{googleCourse ? <Link href={`/teacher/google-classroom?course=${encodeURIComponent(googleCourse.google_course_id)}`}>Google Classroom →</Link> : null}</div></section>
    {messages.error ? <p className="notice notice-error" role="alert">{messages.error}</p> : null}{messages.success ? <p className="notice notice-success">{messages.success}</p> : null}
    <section className={styles.managerBar}><div><strong className={styles.weekBadge}>{currentWeekLabel}</strong><div><strong>Current week · {currentCurriculum?.unit ?? "Curriculum"}</strong><span>{currentCurriculum?.topic ?? "Topic not set for this grade"}</span></div></div><div className={styles.managerControls}><ClassManagerDialogs classroom={{ id, name: classroom.name, gradeLevel: classroom.grade_level, academicYear: classroom.academic_year }} enrolled={enrolled.map((student) => ({ id: student.id, fullName: student.full_name || student.email || "Unnamed student", email: student.email, gradeLevel: student.grade_level }))} available={available.map((student) => ({ id: student.id, fullName: student.full_name || student.email || "Unnamed student", email: student.email, gradeLevel: student.grade_level }))} />{enrolled.length ? <ManageStudentCredentials classId={id} gmailSendEnabled={gmailSendEnabled} students={enrolled.map((student) => ({ id: student.id, fullName: student.full_name || "Unnamed student", emailAddress: student.email || "No email" }))} /> : null}</div></section>
    <section className={styles.kpis} aria-label="Class achievement summary"><article><span>Students</span><strong>{enrolled.length}</strong><small>Active roster</small></article><article><span>Total stars</span><strong>★ {classStars}</strong><small>All recorded weeks</small></article><article><span>Homework OK</span><strong>{percentage(homework.ok, homework.recorded)}</strong><small>{homework.ok} of {homework.recorded} records</small></article><article><span>Classwork OK</span><strong>{percentage(classwork.ok, classwork.recorded)}</strong><small>{classwork.ok} of {classwork.recorded} records</small></article><article><span>Assessment average</span><strong>{assessmentAverage}</strong><small>{managerAssessments.length} visible assessment{managerAssessments.length === 1 ? "" : "s"}</small></article></section>
    {enrolled.length ? <ClassAchievementManager assessments={managerAssessments} classId={id} currentWeekLabel={currentWeekLabel} students={managerStudents} weeks={managerWeeks} /> : <section className={styles.emptyGradebook}><strong>No students in this class yet.</strong><p>Use Add student to choose an existing Jaguar account.</p></section>}
  </main>;
}
