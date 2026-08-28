import { createClient } from "@/lib/supabase/server";
import { progressPercent, progressStatus, type SkillProgress } from "@/lib/skill-progress";

type Row = SkillProgress & { target: string; contributing_skills?: string[] };
export async function FrameworkProgress({ studentId }: { studentId: string }) {
  const supabase = await createClient(); const [sat, content, competencies, aero] = await Promise.all(["SAT", "ICFES_CONTENT", "ICFES_COMPETENCY", "AERO"].map((p_framework) => supabase.rpc("get_student_framework_progress", { p_student_id: studentId, p_framework })));
  const section = (title: string, rows: Row[], empty: string) => <details className="framework-section"><summary>{title}</summary>{rows.length ? rows.map((row) => <article key={row.target}><strong>{row.target}</strong><span>{progressPercent(row)}% · {row.correct_evidence}/{row.attempted_evidence} · {row.earned_points}/{row.possible_points} · {progressStatus(row)}</span>{row.contributing_skills?.length ? <small>Jaguar skills: {row.contributing_skills.join(", ")}</small> : null}</article>) : <p>{empty}</p>}</details>;
  return <section className="framework-progress"><h2>Framework progress</h2>{section("SAT readiness by domain", (sat.data ?? []) as Row[], "No SAT evidence yet.")}{section("ICFES content", (content.data ?? []) as Row[], "No ICFES content evidence yet.")}{section("ICFES competencies", (competencies.data ?? []) as Row[], "No ICFES competency evidence yet.")}{section("AERO curriculum progress", (aero.data ?? []) as Row[], "No AERO evidence yet.")}</section>;
}
