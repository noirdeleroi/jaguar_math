import "server-only";

import { curriculumTopic } from "@/lib/curriculum-weeks";
import { createAdminClient } from "@/lib/supabase/admin";

export type StudentRecordStatus = "ok" | "not_ok" | "late";
export type StudentWorkSummary = { ok: number; notOk: number; late: number; recorded: number; items: number };
export type StudentWorkRecord = { id: string; kind: "homework" | "classwork"; position: number; title: string; activityDate: string | null; status: StudentRecordStatus | null };
export type StudentWeekRecord = { id: string; label: string; sortOrder: number; unit: string; topic: string; stars: number; homework: StudentWorkSummary; classwork: StudentWorkSummary; work: StudentWorkRecord[]; hasActivity: boolean };
export type StudentClassRecord = { id: string; name: string; gradeLevel: number; academicYear: string; totalStars: number; homework: StudentWorkSummary; classwork: StudentWorkSummary; activeWeeks: number; weeks: StudentWeekRecord[] };
export type StudentClassroomRecord = { classes: StudentClassRecord[]; totalStars: number; homework: StudentWorkSummary; classwork: StudentWorkSummary; activeWeeks: number };

type MembershipRow = { class_id: string; classes: { id: string; name: string; grade_level: number; academic_year: string } | { id: string; name: string; grade_level: number; academic_year: string }[] };
type WeekRow = { id: string; class_id: string; label: string; sort_order: number; title: string | null; focus: string | null };
type StarRow = { class_id: string; week_id: string; delta: number };
type WorkItemRow = { id: string; class_id: string; week_id: string; kind: "homework" | "classwork"; position: number; title: string; activity_date: string | null };
type WorkStatusRow = { work_item_id: string; status: string };

function emptyWork(items = 0): StudentWorkSummary {
  return { ok: 0, notOk: 0, late: 0, recorded: 0, items };
}

function normalizedStatus(status: string | undefined): StudentRecordStatus | null {
  if (status === "ok" || status === "done") return "ok";
  if (status === "not_ok" || status === "missing") return "not_ok";
  return status === "late" ? "late" : null;
}

function addStatus(summary: StudentWorkSummary, status: StudentRecordStatus | null) {
  if (!status) return;
  summary.recorded += 1;
  if (status === "ok") summary.ok += 1;
  else if (status === "not_ok") summary.notOk += 1;
  else summary.late += 1;
}

function addSummary(target: StudentWorkSummary, source: StudentWorkSummary) {
  target.ok += source.ok;
  target.notOk += source.notOk;
  target.late += source.late;
  target.recorded += source.recorded;
  target.items += source.items;
}

export async function getStudentClassroomRecord(studentId: string): Promise<StudentClassroomRecord> {
  const admin = createAdminClient();
  const { data: membershipData, error: membershipError } = await admin.from("class_members").select("class_id, classes!inner(id, name, grade_level, academic_year)").eq("student_id", studentId);
  if (membershipError) throw membershipError;
  const memberships = (membershipData ?? []) as MembershipRow[];
  const classIds = memberships.map(({ class_id }) => class_id);
  if (!classIds.length) return { classes: [], totalStars: 0, homework: emptyWork(), classwork: emptyWork(), activeWeeks: 0 };

  const [{ data: weekData, error: weekError }, { data: starData, error: starError }, { data: workItemData, error: workItemError }] = await Promise.all([
    admin.from("classroom_weeks").select("id, class_id, label, sort_order, title, focus").in("class_id", classIds).order("sort_order"),
    admin.from("classroom_star_events").select("class_id, week_id, delta").eq("student_id", studentId).in("class_id", classIds),
    admin.from("classroom_work_items").select("id, class_id, week_id, kind, position, title, activity_date").in("class_id", classIds).order("position"),
  ]);
  const firstError = weekError ?? starError ?? workItemError;
  if (firstError) throw firstError;

  const weeks = (weekData ?? []) as WeekRow[];
  const starEvents = (starData ?? []) as StarRow[];
  const workItems = (workItemData ?? []) as WorkItemRow[];
  const workItemIds = workItems.map(({ id }) => id);
  const { data: statusData, error: statusError } = workItemIds.length
    ? await admin.from("classroom_work_statuses").select("work_item_id, status").eq("student_id", studentId).in("work_item_id", workItemIds)
    : { data: [] as WorkStatusRow[], error: null };
  if (statusError) throw statusError;

  const statusByItem = new Map(((statusData ?? []) as WorkStatusRow[]).map((status) => [status.work_item_id, normalizedStatus(status.status)]));
  const starsByWeek = new Map<string, number>();
  for (const event of starEvents) starsByWeek.set(event.week_id, (starsByWeek.get(event.week_id) ?? 0) + Number(event.delta));
  const workByWeek = new Map<string, StudentWorkRecord[]>();
  for (const item of workItems) {
    const record: StudentWorkRecord = { id: item.id, kind: item.kind, position: item.position, title: item.title, activityDate: item.activity_date, status: statusByItem.get(item.id) ?? null };
    workByWeek.set(item.week_id, [...(workByWeek.get(item.week_id) ?? []), record]);
  }

  const classes = memberships.flatMap((membership): StudentClassRecord[] => {
    const classroom = Array.isArray(membership.classes) ? membership.classes[0] : membership.classes;
    if (!classroom) return [];
    const homework = emptyWork();
    const classwork = emptyWork();
    let totalStars = 0;
    let activeWeeks = 0;
    const classWeeks = weeks.filter((week) => week.class_id === membership.class_id).sort((left, right) => left.sort_order - right.sort_order).map((week): StudentWeekRecord => {
      const curriculum = curriculumTopic(classroom.grade_level, week.label);
      const work = (workByWeek.get(week.id) ?? []).sort((left, right) => left.kind.localeCompare(right.kind) || left.position - right.position);
      const weekHomework = emptyWork(work.filter(({ kind }) => kind === "homework").length);
      const weekClasswork = emptyWork(work.filter(({ kind }) => kind === "classwork").length);
      for (const item of work) addStatus(item.kind === "homework" ? weekHomework : weekClasswork, item.status);
      const stars = starsByWeek.get(week.id) ?? 0;
      const hasActivity = stars !== 0 || work.length > 0;
      if (hasActivity) activeWeeks += 1;
      totalStars += stars;
      addSummary(homework, weekHomework);
      addSummary(classwork, weekClasswork);
      return { id: week.id, label: week.label, sortOrder: week.sort_order, unit: week.title || curriculum?.unit || `Week ${week.label}`, topic: week.focus || curriculum?.topic || "No topic recorded", stars, homework: weekHomework, classwork: weekClasswork, work, hasActivity };
    });
    return [{ id: classroom.id, name: classroom.name, gradeLevel: classroom.grade_level, academicYear: classroom.academic_year, totalStars, homework, classwork, activeWeeks, weeks: classWeeks }];
  }).sort((left, right) => left.name.localeCompare(right.name));

  const homework = emptyWork();
  const classwork = emptyWork();
  for (const classroom of classes) {
    addSummary(homework, classroom.homework);
    addSummary(classwork, classroom.classwork);
  }
  return { classes, totalStars: classes.reduce((sum, classroom) => sum + classroom.totalStars, 0), homework, classwork, activeWeeks: classes.reduce((sum, classroom) => sum + classroom.activeWeeks, 0) };
}
