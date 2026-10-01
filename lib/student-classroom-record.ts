import "server-only";

import { calculateStudentTopicFinalGrade } from "@/lib/classroom-topic-grade";
import { curriculumTopic } from "@/lib/curriculum-weeks";
import { createAdminClient } from "@/lib/supabase/admin";

export type StudentTopicRecord = {
  id: string;
  label: string;
  sortOrder: number;
  title: string;
  gradingMode: "stars" | "classwork";
  stars: number;
  classworkGrade: number;
  finalGrade: number | null;
  finalGradeMax: number | null;
};

export type StudentClassRecord = {
  id: string;
  name: string;
  gradeLevel: number;
  academicYear: string;
  topics: StudentTopicRecord[];
};

export type StudentClassroomRecord = { classes: StudentClassRecord[] };

type MembershipRow = { class_id: string; classes: { id: string; name: string; grade_level: number; academic_year: string } | { id: string; name: string; grade_level: number; academic_year: string }[] };
type TopicRow = {
  id: string;
  class_id: string;
  label: string;
  sort_order: number;
  title: string | null;
  grading_mode: "stars" | "classwork";
  classwork_default_grade: number;
  final_grade_formula: string | null;
  final_grade_max: number;
  summative_grade_column_id: string | null;
};
type StarRow = { week_id: string; delta: number };
type SkullRow = { week_id: string; action: string };
type WorkItemRow = { id: string; week_id: string; kind: "homework" | "classwork" };
type WorkStatusRow = { work_item_id: string; status: string };
type ClassworkGradeRow = { week_id: string; grade: number };
type FinalGradeOverrideRow = { week_id: string; score: number };
type GradeColumnRow = { id: string; week_id: string; source: "assessment" | "manual"; assignment_id: string | null };
type ManualGradeRow = { column_id: string; score: number };
type AssignmentRow = { id: string; kind: string };
type AttemptRow = { assignment_id: string; score: number | null; attempt_number: number; started_at: string };

function topicTitle(topic: TopicRow, gradeLevel: number) {
  const curriculum = curriculumTopic(gradeLevel, topic.label);
  return topic.title || curriculum?.unit || curriculum?.topic || `Topic ${topic.sort_order}`;
}

function isCompletedHomework(status: string | undefined) {
  return status === "ok" || status === "done" || status === "late";
}

export async function getStudentClassroomRecord(studentId: string): Promise<StudentClassroomRecord> {
  const admin = createAdminClient();
  const { data: membershipData, error: membershipError } = await admin.from("class_members").select("class_id, classes!inner(id, name, grade_level, academic_year)").eq("student_id", studentId);
  if (membershipError) throw membershipError;
  const memberships = (membershipData ?? []) as MembershipRow[];
  const classIds = memberships.map(({ class_id }) => class_id);
  if (!classIds.length) return { classes: [] };

  const [
    { data: topicData, error: topicError },
    { data: starData, error: starError },
    { data: skullData, error: skullError },
    { data: workItemData, error: workItemError },
    { data: gradeColumnData, error: gradeColumnError },
  ] = await Promise.all([
    admin.from("classroom_weeks").select("id, class_id, label, sort_order, title, grading_mode, classwork_default_grade, final_grade_formula, final_grade_max, summative_grade_column_id").in("class_id", classIds).order("sort_order"),
    admin.from("classroom_star_events").select("week_id, delta").eq("student_id", studentId).in("class_id", classIds),
    admin.from("classroom_skull_events").select("week_id, action").eq("student_id", studentId).in("class_id", classIds),
    admin.from("classroom_work_items").select("id, week_id, kind").in("class_id", classIds),
    admin.from("classroom_grade_columns").select("id, week_id, source, assignment_id").in("class_id", classIds),
  ]);
  const firstError = topicError ?? starError ?? skullError ?? workItemError ?? gradeColumnError;
  if (firstError) throw firstError;

  const topics = (topicData ?? []) as TopicRow[];
  const topicIds = topics.map(({ id }) => id);
  const workItems = (workItemData ?? []) as WorkItemRow[];
  const workItemIds = workItems.map(({ id }) => id);
  const gradeColumns = (gradeColumnData ?? []) as GradeColumnRow[];
  const gradeColumnIds = gradeColumns.map(({ id }) => id);
  const assignmentIds = [...new Set(gradeColumns.flatMap(({ assignment_id }) => assignment_id ? [assignment_id] : []))];

  const [
    { data: statusData, error: statusError },
    { data: classworkGradeData, error: classworkGradeError },
    { data: finalGradeOverrideData, error: finalGradeOverrideError },
    { data: manualGradeData, error: manualGradeError },
    { data: assignmentData, error: assignmentError },
    { data: attemptData, error: attemptError },
  ] = await Promise.all([
    workItemIds.length ? admin.from("classroom_work_statuses").select("work_item_id, status").eq("student_id", studentId).in("work_item_id", workItemIds) : Promise.resolve({ data: [] as WorkStatusRow[], error: null }),
    topicIds.length ? admin.from("classroom_topic_classwork_grades").select("week_id, grade").eq("student_id", studentId).in("week_id", topicIds) : Promise.resolve({ data: [] as ClassworkGradeRow[], error: null }),
    topicIds.length ? admin.from("classroom_final_grade_overrides").select("week_id, score").eq("student_id", studentId).in("week_id", topicIds) : Promise.resolve({ data: [] as FinalGradeOverrideRow[], error: null }),
    gradeColumnIds.length ? admin.from("classroom_manual_grades").select("column_id, score").eq("student_id", studentId).in("column_id", gradeColumnIds) : Promise.resolve({ data: [] as ManualGradeRow[], error: null }),
    assignmentIds.length ? admin.from("assignments").select("id, kind").in("id", assignmentIds).in("status", ["published", "closed"]) : Promise.resolve({ data: [] as AssignmentRow[], error: null }),
    assignmentIds.length ? admin.from("attempts").select("assignment_id, score, attempt_number, started_at").eq("student_id", studentId).eq("status", "submitted").in("assignment_id", assignmentIds).order("attempt_number", { ascending: false }).order("started_at", { ascending: false }) : Promise.resolve({ data: [] as AttemptRow[], error: null }),
  ]);
  const relatedError = statusError ?? classworkGradeError ?? finalGradeOverrideError ?? manualGradeError ?? assignmentError ?? attemptError;
  if (relatedError) throw relatedError;

  const starsByTopic = new Map<string, number>();
  for (const event of (starData ?? []) as StarRow[]) starsByTopic.set(event.week_id, (starsByTopic.get(event.week_id) ?? 0) + Number(event.delta));

  const skullsByTopic = new Map<string, number>();
  for (const event of (skullData ?? []) as SkullRow[]) {
    if (event.action === "add") skullsByTopic.set(event.week_id, (skullsByTopic.get(event.week_id) ?? 0) + 1);
  }

  const statusByItem = new Map(((statusData ?? []) as WorkStatusRow[]).map((status) => [status.work_item_id, status.status]));
  const homeworkByTopic = new Map<string, { assigned: number; completed: number }>();
  for (const item of workItems) {
    if (item.kind !== "homework") continue;
    const summary = homeworkByTopic.get(item.week_id) ?? { assigned: 0, completed: 0 };
    summary.assigned += 1;
    if (isCompletedHomework(statusByItem.get(item.id))) summary.completed += 1;
    homeworkByTopic.set(item.week_id, summary);
  }

  const latestAttemptByAssignment = new Map<string, AttemptRow>();
  for (const attempt of (attemptData ?? []) as AttemptRow[]) {
    if (!latestAttemptByAssignment.has(attempt.assignment_id)) latestAttemptByAssignment.set(attempt.assignment_id, attempt);
  }
  const assignmentsById = new Map(((assignmentData ?? []) as AssignmentRow[]).map((assignment) => [assignment.id, assignment]));
  for (const column of gradeColumns) {
    if (!column.assignment_id || assignmentsById.get(column.assignment_id)?.kind !== "homework") continue;
    const summary = homeworkByTopic.get(column.week_id) ?? { assigned: 0, completed: 0 };
    summary.assigned += 1;
    if (latestAttemptByAssignment.has(column.assignment_id)) summary.completed += 1;
    homeworkByTopic.set(column.week_id, summary);
  }

  const classworkGradeByTopic = new Map(((classworkGradeData ?? []) as ClassworkGradeRow[]).map((grade) => [grade.week_id, Number(grade.grade)]));
  const finalOverrideByTopic = new Map(((finalGradeOverrideData ?? []) as FinalGradeOverrideRow[]).map((grade) => [grade.week_id, Number(grade.score)]));
  const manualGradeByColumn = new Map(((manualGradeData ?? []) as ManualGradeRow[]).map((grade) => [grade.column_id, Number(grade.score)]));
  const gradeColumnById = new Map(gradeColumns.map((column) => [column.id, column]));

  const classes = memberships.flatMap((membership): StudentClassRecord[] => {
    const classroom = Array.isArray(membership.classes) ? membership.classes[0] : membership.classes;
    if (!classroom) return [];
    const classTopics = topics
      .filter((topic) => topic.class_id === membership.class_id)
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((topic): StudentTopicRecord => {
        const stars = starsByTopic.get(topic.id) ?? 0;
        const summativeColumn = topic.summative_grade_column_id ? gradeColumnById.get(topic.summative_grade_column_id) : null;
        const summativeScore = summativeColumn?.source === "manual"
          ? manualGradeByColumn.get(summativeColumn.id) ?? null
          : summativeColumn?.assignment_id && assignmentsById.has(summativeColumn.assignment_id)
            ? latestAttemptByAssignment.get(summativeColumn.assignment_id)?.score ?? null
            : null;
        const homework = homeworkByTopic.get(topic.id) ?? { assigned: 0, completed: 0 };
        const finalGradeMax = Number(topic.final_grade_max ?? 20);
        const finalGrade = calculateStudentTopicFinalGrade({
          formula: topic.final_grade_formula,
          maximum: finalGradeMax,
          override: finalOverrideByTopic.get(topic.id) ?? null,
          summativeScore: summativeScore === null ? null : Number(summativeScore),
          stars,
          skulls: skullsByTopic.get(topic.id) ?? 0,
          completedHomework: homework.completed,
          assignedHomework: homework.assigned,
        });
        return {
          id: topic.id,
          label: topic.label,
          sortOrder: topic.sort_order,
          title: topicTitle(topic, classroom.grade_level),
          gradingMode: topic.grading_mode,
          stars,
          classworkGrade: classworkGradeByTopic.get(topic.id) ?? Number(topic.classwork_default_grade ?? 80),
          finalGrade,
          finalGradeMax: topic.final_grade_formula ? finalGradeMax : null,
        };
      });
    return [{ id: classroom.id, name: classroom.name, gradeLevel: classroom.grade_level, academicYear: classroom.academic_year, topics: classTopics }];
  }).sort((left, right) => left.name.localeCompare(right.name));

  return { classes };
}
