import Link from "next/link";
import { notFound } from "next/navigation";
import { FrameworkProgress } from "@/app/components/framework-progress";
import { requireTeacher } from "@/lib/auth";
import { progressByDomain, progressPercent, progressStatus, type SkillEvidence, type SkillProgress } from "@/lib/skill-progress";
import type { SatSkillProgress } from "@/lib/sat-progress";
import { getStudentSatProgress } from "@/lib/student-sat-progress";
import { createClient } from "@/lib/supabase/server";

type PageProps = { params: Promise<{ studentId: string }> };
type TeacherAttempt = { id: string; assignment_id: string; attempt_number: number; submitted_at: string; score: number | null; max_score: number | null; assignments: { id: string; title: string } | { id: string; title: string }[] | null };

function attemptAssignment(attempt: TeacherAttempt) {
  return Array.isArray(attempt.assignments) ? attempt.assignments[0] : attempt.assignments;
}

function ProgressMeter({ value }: { value: number }) {
  return <i className="sat-meter" aria-label={`${Math.round(value)}% readiness`}><em style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></i>;
}

function SatSkillRow({ skill }: { skill: SatSkillProgress }) {
  return <article className="sat-skill-row"><div><strong>{skill.name}</strong><small><code>{skill.code}</code> · {skill.attempted ? `${skill.attempted} scored question${skill.attempted === 1 ? "" : "s"} · ${skill.earned}/${skill.possible} points · ${skill.evidenceLabel}` : "Not assessed yet"}</small></div><div className="sat-skill-score">{skill.readiness === null ? <b>Not assessed</b> : <><b>{Math.round(skill.readiness)}%</b><ProgressMeter value={skill.readiness} /></>}</div></article>;
}

export default async function TeacherStudentProgressPage({ params }: PageProps) {
  const teacher = await requireTeacher(); const { studentId } = await params; const supabase = await createClient();
  const { data: membership } = await supabase.from("class_members").select("class_id, classes!inner(id, name, teacher_id)").eq("student_id", studentId).eq("classes.teacher_id", teacher.id); if (!membership?.length) notFound();
  const [{ data: student }, { data: progress }, { data: evidence }, { data: submittedAttempts }, satProgress] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email").eq("id", studentId).eq("role", "student").maybeSingle(),
    supabase.rpc("get_student_skill_progress", { p_student_id: studentId }),
    supabase.rpc("get_student_skill_evidence", { p_student_id: studentId }),
    supabase.from("attempts").select("id, assignment_id, attempt_number, submitted_at, score, max_score, assignments!inner(id, title)").eq("student_id", studentId).eq("status", "submitted").eq("assignments.created_by", teacher.id).order("submitted_at", { ascending: false }),
    getStudentSatProgress(studentId, { assignmentCreatedBy: teacher.id }),
  ]); if (!student) notFound();
  const rows = (progress ?? []) as SkillProgress[]; const attempts = (submittedAttempts ?? []) as unknown as TeacherAttempt[]; const evidenceBySkill = new Map<string, SkillEvidence[]>(); (evidence as SkillEvidence[] ?? []).forEach((item) => evidenceBySkill.set(item.skill_code, [...(evidenceBySkill.get(item.skill_code) ?? []), item])); const classNames = membership.map((item) => { const classroom = Array.isArray(item.classes) ? item.classes[0] : item.classes; return classroom?.name ?? "Class"; }); const scoredAttempts = attempts.filter((attempt) => (attempt.max_score ?? 0) > 0); const overallAssessmentScore = scoredAttempts.length ? Math.round(scoredAttempts.reduce((sum, attempt) => sum + Number(attempt.score ?? 0), 0) / scoredAttempts.reduce((sum, attempt) => sum + Number(attempt.max_score ?? 0), 0) * 100) : null;

  return <main className="teacher-main assessment-page">
    <Link className="back-link" href="/teacher/students">← Students</Link>
    <section className="page-heading"><p className="eyebrow">Student progress</p><h1>{student.full_name || student.email || "Student"}</h1><p>{student.email} · {classNames.join(", ")}</p></section>
    <section className="teacher-student-summary" aria-label="Student assessment summary"><article><span>Submitted assessments</span><strong>{attempts.length}</strong></article><article><span>Overall assessment score</span><strong>{overallAssessmentScore === null ? "—" : `${overallAssessmentScore}%`}</strong></article><article><span>SAT readiness</span><strong>{Math.round(satProgress.readiness)}%</strong></article><article><span>SAT skills assessed</span><strong>{satProgress.assessedSkills} / {satProgress.totalSkills}</strong></article></section>
    <section className="teacher-sat-overview"><div><p className="eyebrow">SAT Math preparation</p><h2>Overall SAT readiness</h2><p>Evidence is based only on this teacher’s submitted, scored assessments. It is preparation feedback, not an official SAT score.</p></div><strong>{Math.round(satProgress.readiness)}%</strong></section>
    <section className="sat-domain-list teacher-sat-domain-list" aria-label="SAT domain and Jaguar skill readiness"><div className="section-row"><div><p className="eyebrow">Detailed readiness</p><h2>SAT domains and Jaguar skills</h2></div><span className="muted-count">{satProgress.totalEvidence} scored responses</span></div><p className="form-note">Open a SAT domain to see the mapped Jaguar skills, each skill’s readiness, points, and evidence level.</p>{satProgress.domains.map((domain) => <details className="sat-domain-card" key={domain.code} open><summary><div><p>{domain.name}</p><span>≈{Math.round(domain.weight * 100)}% of SAT Math · {domain.assessedSkills} / {domain.totalSkills} skills assessed</span></div><div className="sat-domain-summary"><strong>{Math.round(domain.readiness)}%</strong><span>Readiness</span></div></summary><div className="sat-domain-content"><ProgressMeter value={domain.readiness} /><div className="sat-topic-list">{domain.topics.map((topic) => <details className="sat-topic-card" key={topic.name} open={topic.assessedSkills > 0}><summary><div><strong>{topic.name}</strong><span>{topic.assessedSkills} / {topic.totalSkills} skills assessed</span></div><b>{Math.round(topic.readiness)}%</b></summary>{topic.skills.length ? <div className="sat-skill-list">{topic.skills.map((skill) => <SatSkillRow key={skill.code} skill={skill} />)}</div> : <p className="sat-mapping-gap">No Jaguar Math skills are mapped to this SAT testing point yet.</p>}</details>)}</div></div></details>)}</section>
    <section className="teacher-section teacher-assessment-history"><div className="section-row"><h2>Assessment history</h2><span className="muted-count">{attempts.length} submitted</span></div>{attempts.length ? <div className="teacher-attempt-history">{attempts.map((attempt) => { const assignment = attemptAssignment(attempt); const percent = (attempt.max_score ?? 0) > 0 ? Math.round(Number(attempt.score ?? 0) / Number(attempt.max_score) * 100) : null; return <Link href={`/teacher/assignments/${attempt.assignment_id}/attempts/${attempt.id}`} key={attempt.id}><div><strong>{assignment?.title || "Assessment"}</strong><span>Attempt {attempt.attempt_number} · Submitted {new Date(attempt.submitted_at).toLocaleDateString()}</span></div><b>{percent === null ? "Not scored" : `${attempt.score ?? 0}/${attempt.max_score ?? 0} · ${percent}%`} <span>→</span></b></Link>; })}</div> : <p className="form-note">No submitted assessments created by you yet.</p>}</section>
    {rows.length ? <section className="progress-domains teacher-progress"><h2>Jaguar skill evidence</h2>{progressByDomain(rows).map(([domain, skills], index) => <details key={domain} open={index === 0}><summary>{domain}<span>{skills.length} skills</span></summary><div>{skills.map((skill) => { const status = progressStatus(skill); const percent = progressPercent(skill); return <article className="skill-progress-row" key={skill.skill_code}><div><strong>{skill.skill_name}</strong><small>{percent}% · {skill.correct_evidence}/{skill.attempted_evidence} correct · {skill.earned_points}/{skill.possible_points} points</small><details className="evidence-detail"><summary>Evidence</summary>{(evidenceBySkill.get(skill.skill_code) ?? []).map((item, itemIndex) => <p key={`${item.assignment_title}-${item.question_position}-${itemIndex}`}>{item.assignment_title} · Question {item.question_position} · {new Date(item.submitted_at).toLocaleDateString()} · {item.is_correct ? "Correct" : "Incorrect"} · {item.earned_points}/{item.possible_points}</p>)}</details></div><div className="skill-progress-score"><b>{percent}%</b><span className={`progress-status ${status.toLowerCase().replaceAll(" ", "-")}`}>{status}</span></div></article>; })}</div></details>)}</section> : <section className="teacher-section"><h2>No submitted assessment evidence yet.</h2><p className="form-note">This student has not submitted assessments created by you.</p></section>}
    <FrameworkProgress studentId={studentId} />
  </main>;
}
