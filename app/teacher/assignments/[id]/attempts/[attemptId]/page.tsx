import Link from "next/link";
import { notFound } from "next/navigation";
import MathText from "@/app/components/math-text";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type AttemptDetailPageProps = { params: Promise<{ id: string; attemptId: string }> };

export default async function TeacherAttemptDetailPage({ params }: AttemptDetailPageProps) {
  const teacher = await requireTeacher(); const { id, attemptId } = await params; const supabase = await createClient();
  const { data: assignment, error: assignmentError } = await supabase.from("assignments").select("id, title, exam_mode, created_by").eq("id", id).maybeSingle();
  if (assignmentError || !assignment || assignment.created_by !== teacher.id) notFound();
  const { data: attempt, error: attemptError } = await supabase.from("attempts").select("id, attempt_number, status, score, max_score, submitted_at, exam_focus_violations, profiles(full_name, email)").eq("id", attemptId).eq("assignment_id", assignment.id).eq("status", "submitted").maybeSingle();
  if (attemptError || !attempt) notFound();
  const [{ data: composition }, { data: responses }, { data: examEvents }] = await Promise.all([
    supabase.from("assignment_questions").select("question_id, position, points").eq("assignment_id", assignment.id).order("position"),
    supabase.from("responses").select("question_id, student_answer, is_correct, points_awarded").eq("attempt_id", attempt.id),
    assignment.exam_mode ? supabase.from("attempt_exam_events").select("event_type, occurred_at, away_duration_seconds").eq("attempt_id", attempt.id).order("occurred_at") : Promise.resolve({ data: [] as { event_type: string; occurred_at: string; away_duration_seconds: number | null }[] }),
  ]);
  const questionIds = composition?.map((item) => item.question_id) ?? [];
  const [{ data: questions }, { data: keys }, { data: skillLinks }] = questionIds.length ? await Promise.all([
    supabase.from("questions").select("id, prompt").in("id", questionIds),
    supabase.from("question_keys").select("question_id, correct_answer, explanation").in("question_id", questionIds),
    supabase.from("question_skills").select("question_id, is_primary, skills(code, name)").in("question_id", questionIds),
  ]) : [{ data: [] }, { data: [] }, { data: [] }];
  const questionById = new Map((questions ?? []).map((question) => [question.id, question])); const responseByQuestion = new Map((responses ?? []).map((response) => [response.question_id, response])); const keyByQuestion = new Map((keys ?? []).map((key) => [key.question_id, key]));
  const skillsByQuestion = new Map<string, { code: string; name: string; is_primary: boolean }[]>();
  for (const link of skillLinks ?? []) { const skill = Array.isArray(link.skills) ? link.skills[0] : link.skills; if (skill) skillsByQuestion.set(link.question_id, [...(skillsByQuestion.get(link.question_id) ?? []), { code: skill.code, name: skill.name, is_primary: link.is_primary }]); }
  const profile = Array.isArray(attempt.profiles) ? attempt.profiles[0] : attempt.profiles;
  const eventLabel: Record<string, string> = { assessment_started: "Started", page_hidden: "Left assessment", page_visible: "Returned", window_blur: "Window lost focus", window_focus: "Window focused", fullscreen_exited: "Exited fullscreen", fullscreen_restored: "Restored fullscreen", fullscreen_unavailable: "Fullscreen unavailable", auto_submit: "Auto-submitted", manual_submit: "Submitted" };
  return <main className="teacher-main assessment-page"><Link className="back-link" href={`/teacher/assignments/${assignment.id}`}>← {assignment.title}</Link><section className="page-heading"><p className="eyebrow">Submitted attempt</p><h1>{profile?.full_name || profile?.email || "Student"}</h1><p>Attempt {attempt.attempt_number} · {attempt.score ?? 0}/{attempt.max_score ?? 0}{attempt.submitted_at ? ` · Submitted ${new Date(attempt.submitted_at).toLocaleString()}` : ""}</p></section>{assignment.exam_mode && <section className="teacher-section exam-activity"><p className="eyebrow">Exam Mode</p><h2>Exam activity</h2><p>Focus exits: <strong>{attempt.exam_focus_violations}</strong>. Activity signals show page/fullscreen interruptions, not proof of misconduct.</p>{examEvents?.length ? <div>{examEvents.map((event, index) => <article key={`${event.occurred_at}-${index}`}><strong>{eventLabel[event.event_type] ?? event.event_type}</strong><span>{new Date(event.occurred_at).toLocaleString()}{event.away_duration_seconds !== null ? ` · away ${event.away_duration_seconds} sec` : ""}</span></article>)}</div> : <p className="form-note">No Exam Mode activity was recorded.</p>}</section>}<section className="teacher-section attempt-detail"><h2>Question-by-question detail</h2>{(composition ?? []).map((item) => { const question = questionById.get(item.question_id); const response = responseByQuestion.get(item.question_id); const key = keyByQuestion.get(item.question_id); const skills = skillsByQuestion.get(item.question_id) ?? []; return question && key ? <article key={item.question_id}><span>Question {item.position} · {response?.is_correct ? "Correct" : "Incorrect"} · {response?.points_awarded ?? 0}/{item.points}</span><strong><MathText>{question.prompt}</MathText></strong><p>Student answer: {response?.student_answer || "No response"}</p><p>Correct answer: <MathText>{key.correct_answer}</MathText></p>{key.explanation && <p>Explanation: <MathText>{key.explanation}</MathText></p>}<p className="attempt-skills">Jaguar skills: {skills.length ? skills.map((skill) => <span key={skill.code}>{skill.is_primary ? "Primary · " : ""}{skill.code} — {skill.name}</span>) : "No linked skill"}</p></article> : null; })}</section></main>;
}
