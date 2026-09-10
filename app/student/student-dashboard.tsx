"use client";

import Link from "next/link";
import LogoutButton from "./logout-button";
import type { DashboardAssignment } from "@/lib/student-assignments";

type SatSummary = { readiness: number; assessedSkills: number; totalSkills: number };
type CurrentWeek = { label: string; gradeLevel: number; topic: string; unit: string };
type Props = { firstName: string; email: string | null; classes: string[]; assignments: DashboardAssignment[]; satSummary: SatSummary; currentWeek: CurrentWeek | null };

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
  if (assignment.action === "start") return <Link className="dashboard-action" href={`/student/assignments/${assignment.id}`}>Open {assignment.kind} <span>→</span></Link>;
  if (assignment.action === "continue") return <Link className="dashboard-action" href={`/student/assignments/${assignment.id}`}>Continue <span>→</span></Link>;
  if (assignment.action === "review") return <Link className="dashboard-action dashboard-action-quiet" href={`/student/assignments/${assignment.id}`}>Review <span>→</span></Link>;
  if (assignment.action === "view") return <Link className="dashboard-action dashboard-action-quiet" href={`/student/assignments/${assignment.id}`}>View <span>→</span></Link>;
  return null;
}

export function AssignmentCard({ assignment }: { assignment: DashboardAssignment }) {
  const score = scorePercent(assignment);
  return <article className={`dashboard-assignment-card assignment-kind-${assignment.kind}`}><div className="dashboard-card-main"><div className="dashboard-card-top"><span className={`assignment-kind-badge kind-${assignment.kind}`}>{assignment.kind === "homework" ? "Learning · Homework" : assignment.kind === "quiz" ? "Check · Quiz" : "Secure · Test"}</span><span className={`dashboard-status status-${assignment.status.toLowerCase().replaceAll(" ", "-")}`}>{assignment.status}</span><DueLabel assignment={assignment} compact /></div><h3>{assignment.title}</h3><p className="dashboard-class-label">{assignment.classNames.join(" · ") || "Your class"}</p>{assignment.description && <p className="dashboard-description">{assignment.description}</p>}{assignment.questionCount > 0 && <p className="dashboard-question-count">{assignment.questionCount} {assignment.questionCount === 1 ? "question" : "questions"}</p>}<Progress assignment={assignment} />{assignment.completed && <p className="dashboard-result">{assignment.showScore && score !== null ? <><strong>{score}%</strong><span>{assignment.score} / {assignment.maxScore} points</span></> : <span>Submitted</span>}</p>}</div><AssignmentAction assignment={assignment} /></article>;
}

function DashboardReadiness({ summary }: { summary: SatSummary }) {
  const readiness = Math.round(summary.readiness);
  return (
    <Link className="dashboard-readiness" href="/student/progress" aria-label={`View SAT Math progress: ${readiness}% ready`}>
      <span>Your readiness</span>
      <strong>{readiness}%</strong>
      <i aria-hidden="true"><em style={{ width: `${Math.max(0, Math.min(100, summary.readiness))}%` }} /></i>
      <small>{summary.assessedSkills} of {summary.totalSkills} skills assessed</small>
      <b>View progress <span aria-hidden="true">→</span></b>
    </Link>
  );
}

function SatPreparation() {
  return (
    <section className="dashboard-sat-guide" aria-labelledby="sat-guide-title">
      <header>
        <div>
          <p className="eyebrow">SAT preparation</p>
          <h2 id="sat-guide-title">How to prepare for the SAT?</h2>
          <p>Choose a resource and take the next small step.</p>
        </div>
      </header>
      <div className="dashboard-sat-options">
        <Link href="/student/sat-math">
          <span className="dashboard-option-icon" aria-hidden="true">01</span>
          <span><strong>Learn about the SAT</strong><small>Understand the test and the math skills it covers.</small></span>
          <b aria-hidden="true">→</b>
        </Link>
        <Link href="/student/videos">
          <span className="dashboard-option-icon dashboard-option-video" aria-hidden="true">▶</span>
          <span><strong>Watch videos to become better at SAT</strong><small>Study 125 YouTube lessons organized by topic.</small></span>
          <b aria-hidden="true">→</b>
        </Link>
      </div>
    </section>
  );
}

export default function StudentDashboard({ firstName, email, classes, assignments, satSummary, currentWeek }: Props) {
  const actionable = assignments.filter((assignment) => assignment.actionable); const toDo = actionable.filter((assignment) => assignment.action === "start"); const inProgress = actionable.filter((assignment) => assignment.action === "continue"); const completed = assignments.filter((assignment) => assignment.completed); const hero = actionable[0];
  return <main className="student-page"><div className="student-container student-dashboard-container"><header className="student-header"><div className="auth-brand"><span className="brand-mark" aria-hidden="true">∑</span>Jaguar Math</div><nav className="student-header-actions" aria-label="Student menu"><Link href="/student/assessments">Assessments</Link><Link href="/student/progress">Progress</Link><Link href="/student/sat-math">SAT info</Link><Link className="student-nav-video" href="/student/videos"><span aria-hidden="true">▶</span> Study YouTube Videos</Link><LogoutButton /></nav></header><section className="dashboard-welcome"><div className="dashboard-welcome-copy"><p className="eyebrow">Student space</p><h1 suppressHydrationWarning>{greeting()}, {firstName}.</h1>{classes.length ? <p>{classes.join(" · ")}</p> : <p>{email || "Your Jaguar Math workspace"}</p>}</div><DashboardReadiness summary={satSummary} /></section>{currentWeek ? <section className="dashboard-current-week" aria-label={`Current teaching week ${currentWeek.label}`}><div><span>Current teaching week</span><strong>Week {currentWeek.label}</strong></div><div><span>Grade {currentWeek.gradeLevel} topic</span><h2>{currentWeek.topic}</h2>{currentWeek.unit ? <small>{currentWeek.unit}</small> : null}</div></section> : null}{hero ? <section className="dashboard-hero"><div><p className="eyebrow">Needs attention · {hero.kind}</p><div className="dashboard-hero-heading"><div><span className={`dashboard-status status-${hero.status.toLowerCase().replaceAll(" ", "-")}`}>{hero.status}</span><h2>{hero.title}</h2><p>{hero.classNames.join(" · ") || "Your class"}</p>{hero.questionCount > 0 && <p className="dashboard-hero-question-count">{hero.questionCount} {hero.questionCount === 1 ? "question" : "questions"}</p>}</div><DueLabel assignment={hero} /></div><Progress assignment={hero} /></div><AssignmentAction assignment={hero} /></section> : <section className="dashboard-caught-up"><p className="eyebrow">Your workspace</p><h2>You&apos;re all caught up.</h2><p>{assignments.length ? "Completed work is available on your Assessments page." : classes.length ? "Your teachers have not published any assignments yet." : "You are not enrolled in a class yet."}</p></section>}<section className="dashboard-summary" aria-label="Assessment summary"><article><span>To do</span><strong>{toDo.length}</strong></article><article><span>In progress</span><strong>{inProgress.length}</strong></article><article><span>Completed</span><strong>{completed.length}</strong></article></section><SatPreparation /></div></main>;
}
