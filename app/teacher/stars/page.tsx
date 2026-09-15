import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import StarsOverview from "./stars-overview";

export default async function TeacherStarsPage() {
  const teacher = await requireTeacher();
  const supabase = await createClient();
  const [{ data: classes, error: classError }, { data: memberships, error: membershipError }] = await Promise.all([
    supabase.from("classes").select("id, name, grade_level, academic_year").eq("teacher_id", teacher.id).order("grade_level").order("name"),
    supabase.from("class_members").select("class_id"),
  ]);
  if (classError || membershipError) throw classError ?? membershipError;
  const counts = new Map<string, number>();
  for (const membership of memberships ?? []) counts.set(membership.class_id, (counts.get(membership.class_id) ?? 0) + 1);
  const summaries = (classes ?? []).map((classroom) => ({ id: classroom.id, name: classroom.name, gradeLevel: classroom.grade_level, academicYear: classroom.academic_year, studentCount: counts.get(classroom.id) ?? 0, unit: "Topic 1", topic: "Algebra Foundations" }));

  return <StarsOverview classes={summaries} />;
}
