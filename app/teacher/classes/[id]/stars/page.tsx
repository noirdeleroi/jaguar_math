import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { loadClassroomStarState } from "@/lib/classroom-star-data";
import StarClassroom from "./star-classroom";

export default async function ClassStarsPage({ params }: { params: Promise<{ id: string }> }) {
  const teacher = await requireTeacher();
  const { id } = await params;
  const state = await loadClassroomStarState(id, teacher.id);
  if (!state) notFound();

  return <main className="teacher-main">
    <Link className="back-link" href={`/teacher/classes/${id}`}>← {state.classroom.name}</Link>
    <StarClassroom initialState={state} key={`${state.eventIds.length}:${state.workItems.length}:${state.weeks.length}`} />
  </main>;
}
