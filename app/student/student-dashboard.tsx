"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import StartAssignmentButton from "./assignments/start-assignment-button";
import LogoutButton from "./logout-button";

export type DashboardAssignment = { id: string; title: string; description: string | null; kind: string; dueAt: string | null; classNames: string[]; status: "Not started" | "In progress" | "Submitted" | "Completed" | "Overdue" | "Closed"; questionCount: number; answeredCount: number; score: number | null; maxScore: number | null; showScore: boolean; submittedAt: string | null; action: "start" | "continue" | "review" | "view" | null; actionable: boolean; completed: boolean; overdue: boolean };

type Props = { firstName: string; email: string | null; classes: string[]; assignments: DashboardAssignment[] };

const greeting = () => { const hour = new Date().getHours(); return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"; };
const scorePercent = (assignment: DashboardAssignment) => assignment.maxScore && assignment.maxScore > 0 && assignment.score !== null ? Math.round((assignment.score / assignment.maxScore) * 100) : null;

function DueLabel({ assignment, compact = false }: { assignment: DashboardAssignment; compact?: boolean }) {
  if (!assignment.dueAt) return <span className="dashboard-due">No due date</span>;
  const due = new Date(assignment.dueAt); const value = Number.isNaN(due.getTime()) ? "No due date" : `${assignment.overdue ? "Overdue" : "Due"}: ${due.toLocaleString(undefined, { dateStyle: compact ? "medium" : "full", timeStyle: "short" })}`;
  return <span className={`dashboard-due ${assignment.overdue ? "is-overdue" : ""}`} suppressHydrationWarning>{value}</span>;
}

function Progress({ assignment }: { assignment: DashboardAssignment }) {
  if (!assignment.questionCount || (assignment.status !== "In progress" && !(assignment.overdue && assignment.action === "continue"))) return null;
  const percent = Math.round((assignment.answeredCount / assignment.questionCount) * 100);
  return <div className="dashboard-progress"><div><span>{assignment.answeredCount} of {assignment.questionCount} questions answered</span><b>{percent}%</b></div><i><em style={{ width: `${percent}%` }} /></i></div>;
}

function AssignmentAction({ assignment }: { assignment: DashboardAssignment }) {
  if (assignment.action === "start") return <StartAssignmentButton assignmentId={assignment.id} label="Start" />;
  if (assignment.action === "continue") return <Link className="dashboard-action" href={`/student/assignments/${assignment.id}`}>Continue <span>→</span></Link>;
  if (assignment.action === "review") return <Link className="dashboard-action dashboard-action-quiet" href={`/student/assignments/${assignment.id}`}>Review <span>→</span></Link>;
  if (assignment.action === "view") return <Link className="dashboard-action dashboard-action-quiet" href={`/student/assignments/${assignment.id}`}>View <span>→</span></Link>;
  return null;
}

function AssignmentCard({ assignment }: { assignment: DashboardAssignment }) {
  const score = scorePercent(assignment);
  return <article className="dashboard-assignment-card"><div className="dashboard-card-main"><div className="dashboard-card-top"><span className={`dashboard-status status-${assignment.status.toLowerCase().replaceAll(" ", "-")}`}>{assignment.status}</span><DueLabel assignment={assignment} compact /></div><h3>{assignment.title}</h3><p className="dashboard-class-label">{assignment.classNames.join(" · ") || "Your class"}</p>{assignment.description && <p className="dashboard-description">{assignment.description}</p>}{assignment.questionCount > 0 && <p className="dashboard-question-count">{assignment.questionCount} {assignment.questionCount === 1 ? "question" : "questions"}</p>}<Progress assignment={assignment} />{assignment.completed && <p className="dashboard-result">{assignment.showScore && score !== null ? <><strong>{score}%</strong><span>{assignment.score} / {assignment.maxScore} points</span></> : <span>Submitted</span>}</p>}</div><AssignmentAction assignment={assignment} /></article>;
}

export default function StudentDashboard({ firstName, email, classes, assignments }: Props) {
  const [filter, setFilter] = useState<"todo" | "completed" | "all">("todo");
  const actionable = assignments.filter((assignment) => assignment.actionable); const toDo = actionable.filter((assignment) => assignment.action === "start"); const inProgress = actionable.filter((assignment) => assignment.action === "continue"); const completed = assignments.filter((assignment) => assignment.completed);
  const shown = useMemo(() => filter === "todo" ? actionable : filter === "completed" ? completed : assignments, [actionable, assignments, completed, filter]); const hero = actionable[0];
  return <main className="student-page"><div className="student-container student-dashboard-container"><header className="student-header"><div className="auth-brand"><span className="brand-mark" aria-hidden="true">∑</span>Jaguar Math</div><div className="student-header-actions"><Link href="/student/progress">Progress</Link><LogoutButton /></div></header><section className="dashboard-welcome"><p className="eyebrow">Student space</p><h1 suppressHydrationWarning>{greeting()}, {firstName}.</h1>{classes.length ? <p>{classes.join(" · ")}</p> : <p>{email || "Your Jaguar Math workspace"}</p>}</section>{hero ? <section className="dashboard-hero"><div><p className="eyebrow">Needs attention</p><div className="dashboard-hero-heading"><div><span className={`dashboard-status status-${hero.status.toLowerCase().replaceAll(" ", "-")}`}>{hero.status}</span><h2>{hero.title}</h2><p>{hero.classNames.join(" · ") || "Your class"}</p>{hero.questionCount > 0 && <p className="dashboard-hero-question-count">{hero.questionCount} {hero.questionCount === 1 ? "question" : "questions"}</p>}</div><DueLabel assignment={hero} /></div><Progress assignment={hero} /></div><AssignmentAction assignment={hero} /></section> : <section className="dashboard-caught-up"><p className="eyebrow">Your workspace</p><h2>You&apos;re all caught up.</h2><p>{assignments.length ? "Completed work and closed assignments are still available below." : classes.length ? "Your teachers have not published any assignments yet." : "You are not enrolled in a class yet."}</p></section>}<section className="dashboard-summary" aria-label="Assignment summary"><article><span>To do</span><strong>{toDo.length}</strong></article><article><span>In progress</span><strong>{inProgress.length}</strong></article><article><span>Completed</span><strong>{completed.length}</strong></article></section><section className="dashboard-assignments"><div className="dashboard-section-heading"><div><p className="eyebrow">Assigned work</p><h2>Your assignments</h2></div><div className="dashboard-tabs" role="tablist" aria-label="Assignment filter">{(["todo", "completed", "all"] as const).map((option) => <button aria-selected={filter === option} className={filter === option ? "active" : ""} key={option} onClick={() => setFilter(option)} role="tab" type="button">{option === "todo" ? "To do" : option[0].toUpperCase() + option.slice(1)}</button>)}</div></div>{shown.length ? <div className="dashboard-assignment-list">{shown.map((assignment) => <AssignmentCard assignment={assignment} key={assignment.id} />)}</div> : <div className="dashboard-list-empty"><h3>{filter === "completed" ? "No completed assignments yet." : filter === "todo" ? "Nothing needs your attention." : "No assignments available."}</h3><p>{filter === "todo" ? "You&apos;re up to date with your available work." : "Assignments shared by your teachers will appear here."}</p></div>}</section></div></main>;
}
