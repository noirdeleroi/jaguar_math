import { requireStudent } from "@/lib/auth";
import { getStudentSatProgress } from "@/lib/student-sat-progress";
import { getStudentAssignments } from "@/lib/student-assignments";
import StudentDashboard from "./student-dashboard";

export default async function StudentPage() {
  const student = await requireStudent();
  const [{ assignments, classes }, satProgress] = await Promise.all([getStudentAssignments(student.id), getStudentSatProgress(student.id)]);
  return <StudentDashboard assignments={assignments} classes={classes} email={student.email} firstName={student.full_name?.trim().split(/\s+/)[0] || "student"} satSummary={{ readiness: satProgress.readiness, assessedSkills: satProgress.assessedSkills, totalSkills: satProgress.totalSkills }} />;
}
