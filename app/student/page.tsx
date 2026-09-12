import { requireStudent } from "@/lib/auth";
import { getStudentSatProgress } from "@/lib/student-sat-progress";
import { getStudentAssignments } from "@/lib/student-assignments";
import { curriculumTopic } from "@/lib/curriculum-weeks";
import { loadTeacherCurrentWeek } from "@/lib/classroom-star-data";
import StudentDashboard from "./student-dashboard";

export default async function StudentPage() {
  const student = await requireStudent();
  const [{ assignments, classes, classrooms }, satProgress] = await Promise.all([getStudentAssignments(), getStudentSatProgress(student.id)]);
  const classroom = classrooms.find((item) => item.gradeLevel === student.grade_level) ?? classrooms[0];
  const gradeLevel = student.grade_level ?? classroom?.gradeLevel ?? null;
  const weekLabel = classroom ? await loadTeacherCurrentWeek(classroom.teacherId) : null;
  const curriculum = gradeLevel && weekLabel ? curriculumTopic(gradeLevel, weekLabel) : null;
  const currentWeek = weekLabel && gradeLevel ? { label: weekLabel, gradeLevel, topic: curriculum?.topic ?? "Topic not set", unit: curriculum?.unit ?? "" } : null;
  return <StudentDashboard assignments={assignments} classes={classes} currentWeek={currentWeek} email={student.email} nickname={classroom?.nickname || student.full_name?.trim().split(/\s+/)[0] || "student"} satSummary={{ readiness: satProgress.readiness, assessedSkills: satProgress.assessedSkills, totalSkills: satProgress.totalSkills }} />;
}
