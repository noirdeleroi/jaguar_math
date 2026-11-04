import Link from "next/link";
import { notFound } from "next/navigation";
import { loadClassroomProjects } from "@/lib/business-poster-project-data";
import { requireTeacher } from "@/lib/auth";
import { loadClassroomStarState } from "@/lib/classroom-star-data";
import StarClassroom from "./star-classroom";
import styles from "./stars.module.css";

export default async function ClassStarsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ week?: string | string[] }> }) {
  const teacher = await requireTeacher();
  const { id } = await params;
  const state = await loadClassroomStarState(id, teacher.id);
  if (!state) notFound();
  const projects = await loadClassroomProjects(id);
  const requested = await searchParams;
  const requestedWeek = typeof requested.week === "string" ? requested.week.trim().toUpperCase() : "";
  const preferredWeek = state.weeks.some((week) => week.label === requestedWeek) ? requestedWeek : state.weeks.find((week) => week.isCurrent)?.label ?? state.weeks.at(-1)?.label ?? "T1";

  return <main className={`teacher-main ${styles.main}`}>
    <Link className="back-link" href={`/teacher/classes/${id}`}>← {state.classroom.name}</Link>
    <StarClassroom initialProjects={projects} currentWeekLabel={preferredWeek} initialState={state} key={`${preferredWeek}:${state.eventIds.length}:${state.skullEventIds.length}:${state.workItems.length}:${state.weeks.length}`} />
  </main>;
}
