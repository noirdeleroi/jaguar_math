import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { loadClassroomStarState, loadTeacherCurrentWeek } from "@/lib/classroom-star-data";
import StarClassroom from "./star-classroom";
import styles from "./stars.module.css";

export default async function ClassStarsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ week?: string | string[] }> }) {
  const teacher = await requireTeacher();
  const { id } = await params;
  const [state, currentWeek] = await Promise.all([loadClassroomStarState(id, teacher.id), loadTeacherCurrentWeek(teacher.id)]);
  if (!state) notFound();
  const requested = await searchParams;
  const requestedWeek = typeof requested.week === "string" ? requested.week.trim().toUpperCase() : "";
  const preferredWeek = state.weeks.some((week) => week.label === requestedWeek) ? requestedWeek : currentWeek;

  return <main className={`teacher-main ${styles.main}`}>
    <Link className="back-link" href={`/teacher/classes/${id}`}>← {state.classroom.name}</Link>
    <StarClassroom currentWeekLabel={preferredWeek} initialState={state} key={`${preferredWeek}:${state.eventIds.length}:${state.workItems.length}:${state.weeks.length}`} />
  </main>;
}
