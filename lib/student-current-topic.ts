import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type StudentCurrentTopic = {
  label: string;
  className: string;
  gradeLevel: number;
  topic: string;
  focus: string;
  gradingMode: "stars" | "classwork";
  stars: number;
  skulls: number;
  classworkGrade: number;
};

export async function getStudentCurrentTopic(studentId: string, classId: string): Promise<StudentCurrentTopic | null> {
  const admin = createAdminClient();
  const [{ data: member }, { data: classroom }] = await Promise.all([
    admin.from("class_members").select("student_id").eq("class_id", classId).eq("student_id", studentId).maybeSingle(),
    admin.from("classes").select("id, name, grade_level").eq("id", classId).maybeSingle(),
  ]);
  if (!member || !classroom) return null;

  const { data: topic, error: topicError } = await admin.from("classroom_weeks")
    .select("id, label, title, focus, grading_mode, classwork_default_grade")
    .eq("class_id", classId)
    .eq("is_current", true)
    .maybeSingle();
  if (topicError) throw topicError;
  if (!topic) return null;

  const [{ data: starRows, error: starError }, { data: skullRows, error: skullError }, { data: gradeRow, error: gradeError }] = await Promise.all([
    admin.from("classroom_star_events").select("delta").eq("class_id", classId).eq("week_id", topic.id).eq("student_id", studentId),
    admin.from("classroom_skull_events").select("action").eq("class_id", classId).eq("week_id", topic.id).eq("student_id", studentId),
    admin.from("classroom_topic_classwork_grades").select("grade").eq("week_id", topic.id).eq("student_id", studentId).maybeSingle(),
  ]);
  if (starError || skullError || gradeError) throw starError ?? skullError ?? gradeError;

  return {
    label: topic.label,
    className: classroom.name,
    gradeLevel: classroom.grade_level,
    topic: topic.title || `Topic ${topic.label.replace(/^T/i, "")}`,
    focus: topic.focus || "",
    gradingMode: topic.grading_mode as "stars" | "classwork",
    stars: (starRows ?? []).reduce((sum, row) => sum + Number(row.delta), 0),
    skulls: (skullRows ?? []).filter((row) => row.action === "add").length,
    classworkGrade: Number(gradeRow?.grade ?? topic.classwork_default_grade ?? 80),
  };
}
