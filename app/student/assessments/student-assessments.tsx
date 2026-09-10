"use client";

import { useMemo, useState } from "react";
import { AssignmentCard } from "../student-dashboard";
import type { DashboardAssignment } from "@/lib/student-assignments";

type AssessmentFilter = "todo" | "in-progress" | "completed" | "all";

export default function StudentAssessments({ assignments, initialFilter }: { assignments: DashboardAssignment[]; initialFilter: AssessmentFilter }) {
  const [filter, setFilter] = useState<AssessmentFilter>(initialFilter);
  const actionable = assignments.filter((assignment) => assignment.actionable); const completed = assignments.filter((assignment) => assignment.completed);
  const shown = useMemo(() => filter === "todo" ? actionable.filter((assignment) => assignment.action === "start") : filter === "in-progress" ? actionable.filter((assignment) => assignment.action === "continue") : filter === "completed" ? completed : assignments, [actionable, assignments, completed, filter]);
  return <section className="dashboard-assignments"><div className="dashboard-section-heading"><div><p className="eyebrow">Assigned work</p><h2>Your assessments</h2></div><div className="dashboard-tabs" role="tablist" aria-label="Assessment filter">{(["todo", "in-progress", "completed", "all"] as const).map((option) => <button aria-selected={filter === option} className={filter === option ? "active" : ""} key={option} onClick={() => setFilter(option)} role="tab" type="button">{option === "todo" ? "To do" : option === "in-progress" ? "In progress" : option[0].toUpperCase() + option.slice(1)}</button>)}</div></div>{shown.length ? <div className="dashboard-assignment-list">{shown.map((assignment) => <AssignmentCard assignment={assignment} key={assignment.id} />)}</div> : <div className="dashboard-list-empty"><h3>{filter === "completed" ? "No completed assessments yet." : filter === "in-progress" ? "No assessments in progress." : filter === "todo" ? "Nothing needs your attention." : "No assessments available."}</h3><p>{filter === "todo" ? "You&apos;re up to date with your available work." : "Assessments shared by your teachers will appear here."}</p></div>}</section>;
}
