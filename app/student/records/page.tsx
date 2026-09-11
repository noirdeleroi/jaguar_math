import { requireStudent } from "@/lib/auth";
import { getStudentClassroomRecord } from "@/lib/student-classroom-record";
import StudentRecordsView from "./records-view";

export default async function StudentRecordsPage() {
  const student = await requireStudent();
  const record = await getStudentClassroomRecord(student.id);
  return <StudentRecordsView record={record} />;
}
