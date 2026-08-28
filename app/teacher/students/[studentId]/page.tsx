import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { progressByDomain, progressPercent, progressStatus, type SkillEvidence, type SkillProgress } from "@/lib/skill-progress";

type PageProps = { params: Promise<{ studentId: string }> };
export default async function TeacherStudentProgressPage({ params }: PageProps) {
  const teacher = await requireTeacher(); const { studentId } = await params; const supabase = await createClient();
  const { data: membership } = await supabase.from("class_members").select("class_id, classes!inner(id, name, teacher_id)").eq("student_id", studentId).eq("classes.teacher_id", teacher.id); if (!membership?.length) notFound();
  const [{ data: student }, { data: progress }, { data: evidence }, { count: attempts }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email").eq("id", studentId).eq("role", "student").maybeSingle(),
    supabase.rpc("get_student_skill_progress", { p_student_id: studentId }),
    supabase.rpc("get_student_skill_evidence", { p_student_id: studentId }),
    supabase.from("attempts").select("id", { count: "exact", head: true }).eq("student_id", studentId).eq("status", "submitted"),
  ]); if (!student) notFound();
  const rows = (progress ?? []) as SkillProgress[]; const evidenceBySkill = new Map<string, SkillEvidence[]>(); (evidence as SkillEvidence[] ?? []).forEach((item) => evidenceBySkill.set(item.skill_code, [...(evidenceBySkill.get(item.skill_code) ?? []), item])); const classNames = membership.map((item) => { const classroom = Array.isArray(item.classes) ? item.classes[0] : item.classes; return classroom?.name ?? "Class"; });
  return <main className="teacher-main assessment-page"><Link className="back-link" href="/teacher/students">← Students</Link><section className="page-heading"><p className="eyebrow">Student progress</p><h1>{student.full_name || student.email || "Student"}</h1><p>{student.email} · {classNames.join(", ")} · {attempts ?? 0} submitted assessments</p></section>{rows.length ? <section className="progress-domains teacher-progress">{progressByDomain(rows).map(([domain, skills], index) => <details key={domain} open={index === 0}><summary>{domain}<span>{skills.length} skills</span></summary><div>{skills.map((skill) => { const status = progressStatus(skill); const percent = progressPercent(skill); return <article className="skill-progress-row" key={skill.skill_code}><div><strong>{skill.skill_name}</strong><small>{percent}% · {skill.correct_evidence}/{skill.attempted_evidence} correct · {skill.earned_points}/{skill.possible_points} points</small><details className="evidence-detail"><summary>Evidence</summary>{(evidenceBySkill.get(skill.skill_code) ?? []).map((item, itemIndex) => <p key={`${item.assignment_title}-${item.question_position}-${itemIndex}`}>{item.assignment_title} · Question {item.question_position} · {new Date(item.submitted_at).toLocaleDateString()} · {item.is_correct ? "Correct" : "Incorrect"} · {item.earned_points}/{item.possible_points}</p>)}</details></div><div className="skill-progress-score"><b>{percent}%</b><span className={`progress-status ${status.toLowerCase().replaceAll(" ", "-")}`}>{status}</span></div></article>; })}</div></details>)}</section> : <section className="teacher-section"><h2>No submitted assessment evidence yet.</h2><p className="form-note">This student has not submitted any assessments created by you.</p></section>}</main>;
}
