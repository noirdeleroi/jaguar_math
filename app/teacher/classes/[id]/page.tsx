import Link from "next/link";
import { notFound } from "next/navigation";
import { assignmentResultStatus } from "@/lib/assignment-completion";
import { requireTeacher } from "@/lib/auth";
import type { AvailableClassroomAssessment, ClassroomCwRecord, ClassroomGradeColumn, ClassroomHomeworkAssignment, ClassroomStarState, WorkStatus as ClassroomWorkStatus } from "@/lib/classroom-stars";
import { hasGoogleGmailSendPermission } from "@/lib/google-classroom";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import ClassManagerDialogs from "./class-manager-dialogs";
import ManageStudentCredentials from "./manage-student-credentials";
import StarClassroom from "./stars/star-classroom";
import styles from "./class-manager.module.css";

type Student = { id: string; full_name: string | null; email: string | null; grade_level: number | null };
type Member = { student_id: string; nickname: string; nickname_is_custom: boolean };
type EnrolledStudent = Student & { nickname: string; nicknameIsCustom: boolean };
type ClassroomWeek = { id: string; label: string; sort_order: number; title: string | null; focus: string | null; is_current: boolean; final_grade_formula: string | null; final_grade_max: number; summative_grade_column_id: string | null };
type WorkItem = { id: string; week_id: string; kind: "homework" | "classwork"; position: number; title: string; activity_date: string | null };
type WorkStatus = { work_item_id: string; student_id: string; status: string };
type StarEvent = { id: string; student_id: string; week_id: string; delta: number };
type SkullTotalRow = { student_id: string; week_label: string; skulls_today: number; skulls_total: number };
type Assessment = { id: string; title: string; kind: string; status: "published" | "closed"; due_at: string | null };
type Attempt = { id: string; assignment_id: string; student_id: string; status: "in_progress" | "submitted"; score: number | null; max_score: number | null; attempt_number: number; started_at: string; submitted_at: string | null };
type GradeColumnRow = { id: string; week_id: string; title: string; assessment_date: string; source: "assessment" | "manual"; assignment_id: string | null; max_score: number | null; created_at: string };
type ManualGradeRow = { column_id: string; student_id: string; score: number };
type FinalGradeOverrideRow = { week_id: string; student_id: string; score: number; comment: string };
type CwRecordRow = { id: string; week_id: string; student_id: string; record_date: string; reason: string };
type GradebookRosterRow = { gradebook_code: string; gradebook_name: string; sort_order: number; student_id: string | null };
type WorkSummary = { ok: number; notOk: number; late: number; recorded: number };
type WeekAchievement = { stars: number; homework: WorkSummary; classwork: WorkSummary };
type ManagerScore = { attemptId: string; score: number; maxScore: number; percent: number };
type ManagerStudent = { id: string; totalStars: number; homework: WorkSummary; classwork: WorkSummary; weeks: Record<string, WeekAchievement>; scores: Record<string, ManagerScore>; assessmentAverage: number | null };

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
function normalizeWorkStatus(status: string): ClassroomWorkStatus | null {
  if (status === "ok" || status === "done") return "ok";
  if (status === "not_ok" || status === "missing") return "not_ok";
  return status === "late" ? "late" : null;
}

export default async function ClassDetailPage({ params, searchParams }: PageProps<"/teacher/classes/[id]">) {
  const teacher = await requireTeacher();
  const { id } = await params;
  const messages = await searchParams;
  const supabase = await createClient();
  const { data: classroom, error: classroomError } = await supabase.from("classes").select("id, name, grade_level, academic_year, teacher_id").eq("id", id).maybeSingle();
  if (classroomError || !classroom || classroom.teacher_id !== teacher.id) notFound();

  const admin = createAdminClient();
  const [{ data: members, error: memberError }, { data: allStudents, error: studentError }, { data: gradebookRosterRows, error: gradebookRosterError }, { data: weekRows, error: weekError }, { data: starEvents, error: starError }, { data: skullRows, error: skullError }, { data: workItemRows, error: workItemError }, { data: cwRecordRows, error: cwRecordError }, { data: assignmentLinks, error: linkError }, { data: gradeColumnRows, error: gradeColumnError }, gmailSendEnabled, { data: googleCourse }] = await Promise.all([
    supabase.from("class_members").select("student_id, nickname, nickname_is_custom").eq("class_id", id),
    supabase.from("profiles").select("id, full_name, email, grade_level").eq("role", "student"),
    supabase.from("class_gradebook_students").select("gradebook_code, gradebook_name, sort_order, student_id").eq("class_id", id).order("sort_order"),
    supabase.from("classroom_weeks").select("id, label, sort_order, title, focus, is_current, final_grade_formula, final_grade_max, summative_grade_column_id").eq("class_id", id).order("sort_order"),
    supabase.from("classroom_star_events").select("id, student_id, week_id, delta").eq("class_id", id),
    supabase.rpc("get_classroom_skull_totals", { p_class_id: id }),
    supabase.from("classroom_work_items").select("id, week_id, kind, position, title, activity_date").eq("class_id", id),
    supabase.from("classroom_cw_records").select("id, week_id, student_id, record_date, reason").eq("class_id", id).order("record_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("assignment_classes").select("assignment_id").eq("class_id", id),
    supabase.from("classroom_grade_columns").select("id, week_id, title, assessment_date, source, assignment_id, max_score, created_at").eq("class_id", id).order("assessment_date").order("created_at"),
    hasGoogleGmailSendPermission(teacher.id),
    admin.from("google_classroom_courses").select("google_course_id").eq("class_id", id).eq("teacher_id", teacher.id).maybeSingle(),
  ]);
  const dataError = memberError ?? studentError ?? gradebookRosterError ?? weekError ?? starError ?? skullError ?? workItemError ?? cwRecordError ?? linkError ?? gradeColumnError;
  if (dataError) throw dataError;

  const studentsById = new Map(((allStudents ?? []) as Student[]).map((student) => [student.id, student]));
  const memberRows = (members ?? []) as Member[];
  const memberIds = new Set(memberRows.map(({ student_id }) => student_id));
  const enrolled = memberRows.flatMap((member): EnrolledStudent[] => { const student = studentsById.get(member.student_id); return student ? [{ ...student, nickname: member.nickname, nicknameIsCustom: member.nickname_is_custom }] : []; }).sort((a, b) => a.nickname.localeCompare(b.nickname, undefined, { sensitivity: "base" }));
  const available = ((allStudents ?? []) as Student[]).filter((student) => !memberIds.has(student.id)).sort((a, b) => firstName(a.full_name || a.email || "").localeCompare(firstName(b.full_name || b.email || ""), undefined, { sensitivity: "base" }));
  const weeks = (weekRows ?? []) as ClassroomWeek[];
  const activeTopic = weeks.find((topic) => topic.is_current) ?? weeks.at(-1) ?? { id: "", label: "T1", sort_order: 1, title: classroom.grade_level === 12 ? "Arithmetic Foundations" : "Algebra Foundations", focus: null, is_current: true, final_grade_formula: null, final_grade_max: 20, summative_grade_column_id: null };
  const workItems = (workItemRows ?? []) as WorkItem[];
  const workItemIds = workItems.map((item) => item.id);
  const assignmentIds = (assignmentLinks ?? []).map((link) => link.assignment_id);
  const gradeColumnIds = ((gradeColumnRows ?? []) as GradeColumnRow[]).map((column) => column.id);
  const [{ data: statusRows, error: statusError }, { data: assessmentRows, error: assessmentError }, { data: manualGradeRows, error: manualGradeError }, { data: finalGradeOverrideRows, error: finalGradeOverrideError }] = await Promise.all([
    workItemIds.length ? supabase.from("classroom_work_statuses").select("work_item_id, student_id, status").in("work_item_id", workItemIds) : Promise.resolve({ data: [] as WorkStatus[], error: null }),
    assignmentIds.length ? supabase.from("assignments").select("id, title, kind, status, due_at").in("id", assignmentIds).eq("created_by", teacher.id).in("status", ["published", "closed"]).order("due_at", { ascending: true, nullsFirst: false }) : Promise.resolve({ data: [] as Assessment[], error: null }),
    gradeColumnIds.length ? supabase.from("classroom_manual_grades").select("column_id, student_id, score").in("column_id", gradeColumnIds) : Promise.resolve({ data: [] as ManualGradeRow[], error: null }),
    weeks.length && enrolled.length ? supabase.from("classroom_final_grade_overrides").select("week_id, student_id, score, comment").in("week_id", weeks.map((week) => week.id)).in("student_id", enrolled.map((student) => student.id)) : Promise.resolve({ data: [] as FinalGradeOverrideRow[], error: null }),
  ]);
  if (statusError || assessmentError || manualGradeError || finalGradeOverrideError) throw statusError ?? assessmentError ?? manualGradeError ?? finalGradeOverrideError;
  const assessmentIds = (assessmentRows ?? []).map((assessment) => assessment.id);
  const { data: attemptRows, error: attemptError } = assessmentIds.length && enrolled.length ? await supabase.from("attempts").select("id, assignment_id, student_id, status, score, max_score, attempt_number, started_at, submitted_at").in("assignment_id", assessmentIds).in("student_id", enrolled.map((student) => student.id)).in("status", ["in_progress", "submitted"]).order("attempt_number", { ascending: false }).order("started_at", { ascending: false }) : { data: [] as Attempt[], error: null };
  if (attemptError) throw attemptError;

  const weekById = new Map(weeks.map((week) => [week.id, week]));
  const workItemById = new Map(workItems.map((item) => [item.id, item]));
  const statusesByItem = new Map<string, Record<string, ClassroomWorkStatus>>();
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
    const normalizedStatus = normalizeWorkStatus(status.status);
    if (normalizedStatus) {
      const itemStatuses = statusesByItem.get(status.work_item_id) ?? {};
      itemStatuses[status.student_id] = normalizedStatus;
      statusesByItem.set(status.work_item_id, itemStatuses);
    }
  }

  const latestActivity = new Map<string, Attempt>();
  const latestSubmitted = new Map<string, Attempt>();
  for (const attempt of (attemptRows ?? []) as Attempt[]) {
    const key = `${attempt.student_id}|${attempt.assignment_id}`;
    if (!latestActivity.has(key)) latestActivity.set(key, attempt);
    if (attempt.status === "submitted" && !latestSubmitted.has(key)) latestSubmitted.set(key, attempt);
  }
  const managerStudents: ManagerStudent[] = enrolled.map((student) => {
    const studentAchievement = studentWeeks(student.id); const homework = emptyWork(); const classwork = emptyWork(); let totalStars = 0;
    for (const week of Object.values(studentAchievement)) { totalStars += week.stars; sumWork(homework, week.homework); sumWork(classwork, week.classwork); }
    const scores: ManagerStudent["scores"] = {};
    for (const assessment of assessmentRows ?? []) { const attempt = latestSubmitted.get(`${student.id}|${assessment.id}`); if (!attempt || Number(attempt.max_score ?? 0) <= 0) continue; scores[assessment.id] = { attemptId: attempt.id, score: Number(attempt.score ?? 0), maxScore: Number(attempt.max_score), percent: Math.round(Number(attempt.score ?? 0) / Number(attempt.max_score) * 100) }; }
    const scoreValues = Object.values(scores).map((score) => score.percent);
    return { id: student.id, totalStars, homework, classwork, weeks: studentAchievement, scores, assessmentAverage: scoreValues.length ? Math.round(scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length) : null };
  });
  const manualGradesByColumn = new Map<string, ManualGradeRow[]>();
  for (const grade of (manualGradeRows ?? []) as ManualGradeRow[]) manualGradesByColumn.set(grade.column_id, [...(manualGradesByColumn.get(grade.column_id) ?? []), grade]);
  const gradeColumns: ClassroomGradeColumn[] = ((gradeColumnRows ?? []) as GradeColumnRow[]).flatMap((column) => {
    const week = weekById.get(column.week_id);
    if (!week) return [];
    const maxScore = column.max_score === null ? null : Number(column.max_score);
    const scores = column.source === "assessment" && column.assignment_id
      ? Object.fromEntries(managerStudents.flatMap((student) => student.scores[column.assignment_id!] ? [[student.id, student.scores[column.assignment_id!]]] : []))
      : Object.fromEntries((manualGradesByColumn.get(column.id) ?? []).flatMap((grade) => maxScore && maxScore > 0 ? [[grade.student_id, { attemptId: null, score: Number(grade.score), maxScore, percent: Math.round(Number(grade.score) / maxScore * 100) }]] : []));
    const percentages = Object.values(scores).map((score) => score.percent);
    return [{ id: column.id, weekLabel: week.label, title: column.title, assessmentDate: column.assessment_date, source: column.source, assignmentId: column.assignment_id, maxScore, average: percentages.length ? Math.round(percentages.reduce((sum, value) => sum + value, 0) / percentages.length) : null, scores }];
  });
  const representedAssessmentIds = new Set(gradeColumns.flatMap((column) => column.assignmentId ? [column.assignmentId] : []));
  const availableAssessments: AvailableClassroomAssessment[] = ((assessmentRows ?? []) as Assessment[]).filter((assessment) => !representedAssessmentIds.has(assessment.id)).map((assessment) => ({ id: assessment.id, title: assessment.title, kind: assessment.kind, status: assessment.status, dueAt: assessment.due_at }));
  const gradeWeekByAssignment = new Map(gradeColumns.flatMap((column) => column.assignmentId ? [[column.assignmentId, column.weekLabel]] : []));
  const classroomHomework: ClassroomHomeworkAssignment[] = ((assessmentRows ?? []) as Assessment[]).filter((assessment) => assessment.kind === "homework").map((assessment) => ({
    id: assessment.id,
    title: assessment.title,
    status: assessment.status,
    dueAt: assessment.due_at,
    weekLabel: gradeWeekByAssignment.get(assessment.id) ?? activeTopic.label,
    results: Object.fromEntries(enrolled.map((student) => {
      const key = `${student.id}|${assessment.id}`;
      const activity = latestActivity.get(key);
      const submitted = latestSubmitted.get(key);
      const maxScore = submitted?.max_score === null || submitted?.max_score === undefined ? null : Number(submitted.max_score);
      const score = submitted?.score === null || submitted?.score === undefined ? null : Number(submitted.score);
      return [student.id, { attemptId: submitted?.id ?? activity?.id ?? null, status: assignmentResultStatus(activity?.status, Boolean(submitted)), score, maxScore, percentage: score !== null && maxScore && maxScore > 0 ? Math.round(score / maxScore * 100) : null }];
    })),
  }));
  const cwRecords: ClassroomCwRecord[] = ((cwRecordRows ?? []) as CwRecordRow[]).flatMap((record) => {
    const week = weekById.get(record.week_id);
    return week && memberIds.has(record.student_id) ? [{ id: record.id, studentId: record.student_id, weekLabel: week.label, recordDate: record.record_date, reason: record.reason }] : [];
  });
  const skullsByStudent = new Map<string, Record<string, { today: number; total: number }>>();
  for (const row of (skullRows ?? []) as SkullTotalRow[]) {
    const values = skullsByStudent.get(row.student_id) ?? {};
    values[row.week_label] = { today: Number(row.skulls_today), total: Number(row.skulls_total) };
    skullsByStudent.set(row.student_id, values);
  }
  const finalGradeOverrides: ClassroomStarState["finalGradeOverrides"] = {};
  for (const row of (finalGradeOverrideRows ?? []) as FinalGradeOverrideRow[]) {
    const week = weekById.get(row.week_id);
    if (!week) continue;
    finalGradeOverrides[week.label] = {
      ...(finalGradeOverrides[week.label] ?? {}),
      [row.student_id]: { score: Number(row.score), comment: row.comment },
    };
  }
  const starState: ClassroomStarState = {
    classroom: { id: classroom.id, name: classroom.name, gradeLevel: classroom.grade_level, academicYear: classroom.academic_year },
    gradebookRoster: ((gradebookRosterRows ?? []) as GradebookRosterRow[]).map((student) => ({ gradebookCode: student.gradebook_code, gradebookName: student.gradebook_name, sortOrder: student.sort_order, studentId: student.student_id })),
    weeks: weeks.map((week) => ({ id: week.id, label: week.label, sortOrder: week.sort_order, title: week.title, focus: week.focus, isCurrent: week.is_current, finalGradeFormula: week.final_grade_formula, finalGradeMax: Number(week.final_grade_max ?? 20), summativeGradeColumnId: week.summative_grade_column_id })),
    students: enrolled.map((student) => ({ id: student.id, fullName: student.nickname, nickname: student.nickname, email: student.email, totals: Object.fromEntries(weeks.map((week) => [week.label, studentWeeks(student.id)[week.label].stars])), skulls: skullsByStudent.get(student.id) ?? {} })),
    workItems: workItems.flatMap((item) => { const week = weekById.get(item.week_id); return week ? [{ id: item.id, weekLabel: week.label, kind: item.kind, position: item.position, title: item.title, activityDate: item.activity_date, statuses: statusesByItem.get(item.id) ?? {} }] : []; }),
    finalGradeOverrides,
    eventIds: ((starEvents ?? []) as StarEvent[]).map((event) => event.id),
    skullEventIds: [],
  };
  const classTitle = /\bmath(?:ematics)?\b/i.test(classroom.name) ? classroom.name : `${classroom.name} Math`;

  return <main className={`teacher-main ${styles.main}`}>
    <header className={styles.hero}>
      <div className={styles.heroIdentity}>
        <Link className={styles.backToClasses} href="/teacher/classes">← Classes</Link>
        <div>
          <p className="eyebrow">Class manager · {classroom.academic_year}</p>
          <div className={styles.titleLine}><h1>{classTitle}</h1><span>Grade {classroom.grade_level} · {enrolled.length} {enrolled.length === 1 ? "student" : "students"}</span></div>
        </div>
      </div>
      <nav aria-label={`${classTitle} tools`} className={styles.heroActions}><a href="#topic-gradebook">Open record ↓</a><Link href={`/teacher/classes/${id}/randomizer`}>Name wheel →</Link><Link href={`/teacher/classes/${id}/sitting`}>Seating chart →</Link>{googleCourse ? <Link href={`/teacher/google-classroom?course=${encodeURIComponent(googleCourse.google_course_id)}`}>Google Classroom →</Link> : null}</nav>
    </header>
    {messages.error ? <p className="notice notice-error" role="alert">{messages.error}</p> : null}{messages.success ? <p className="notice notice-success">{messages.success}</p> : null}
    <section className={styles.managerBar}><div><strong className={styles.weekBadge}>{activeTopic.label}</strong><div><span>Current topic</span><strong>{activeTopic.title || `Topic ${activeTopic.sort_order}`}</strong></div></div><div className={styles.managerControls}><ClassManagerDialogs classroom={{ id, name: classroom.name, gradeLevel: classroom.grade_level, academicYear: classroom.academic_year }} enrolled={enrolled.map((student) => ({ id: student.id, fullName: student.full_name || student.email || "Unnamed student", nickname: student.nickname, nicknameIsCustom: student.nicknameIsCustom, email: student.email, gradeLevel: student.grade_level }))} available={available.map((student) => ({ id: student.id, fullName: student.full_name || student.email || "Unnamed student", email: student.email, gradeLevel: student.grade_level }))} />{enrolled.length ? <ManageStudentCredentials classId={id} gmailSendEnabled={gmailSendEnabled} students={enrolled.map((student) => ({ id: student.id, fullName: student.nickname, emailAddress: student.email || "No email" }))} /> : null}</div></section>
    <StarClassroom availableAssessments={availableAssessments} currentWeekLabel={activeTopic.label} embedded initialAssignments={classroomHomework} initialCwRecords={cwRecords} initialGradeColumns={gradeColumns} initialState={starState} key={`${activeTopic.label}:${starState.eventIds.length}:${starState.skullEventIds.length}:${starState.workItems.length}:${starState.weeks.length}:${gradeColumns.length}:${cwRecords.length}`} />
    {!enrolled.length ? <section className={styles.emptyGradebook}><strong>No students in this class yet.</strong><p>Use Add student to choose an existing Jaguar account.</p></section> : null}
  </main>;
}
