import { requireStudent } from "@/lib/auth";
import { getStudentSatProgress } from "@/lib/student-sat-progress";
import { getStudentAssignments } from "@/lib/student-assignments";
import { getStudentNotifications } from "@/lib/student-notifications";
import { getStudentCurrentTopic } from "@/lib/student-current-topic";
import StudentDashboard from "./student-dashboard";

export default async function StudentPage() {
  const student = await requireStudent();
  const [{ assignments, classes, classrooms }, satProgress, notificationState] = await Promise.all([getStudentAssignments(), getStudentSatProgress(student.id), getStudentNotifications()]);
  const classroom = classrooms.find((item) => item.gradeLevel === student.grade_level) ?? classrooms[0];
  const currentTopic = classroom ? await getStudentCurrentTopic(student.id, classroom.id) : null;
  return <StudentDashboard assignments={assignments} classes={classes} currentTopic={currentTopic} email={student.email} nickname={classroom?.nickname || student.full_name?.trim().split(/\s+/)[0] || "student"} notifications={notificationState.notifications} unreadNotificationCount={notificationState.unreadCount} satSummary={{ readiness: satProgress.readiness, assessedSkills: satProgress.assessedSkills, totalSkills: satProgress.totalSkills }} studentId={student.id} />;
}
