import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { teacherSkillDisplayName } from "@/lib/skill-display-names";
import TeacherAttemptReview, { type TeacherReviewQuestion } from "../../../teacher-attempt-review";

type AttemptDetailPageProps = { params: Promise<{ id: string; attemptId: string }> };

export default async function TeacherAttemptDetailPage({ params }: AttemptDetailPageProps) {
  const teacher = await requireTeacher(); const { id, attemptId } = await params; const supabase = await createClient();
  const { data: assignment, error: assignmentError } = await supabase.from("assignments").select("id, title, exam_mode, created_by").eq("id", id).maybeSingle();
  if (assignmentError || !assignment || assignment.created_by !== teacher.id) notFound();
  const { data: attempt, error: attemptError } = await supabase.from("attempts").select("id, student_id, attempt_number, status, score, max_score, submitted_at, form_code, exam_focus_violations, offline_recovery_used, offline_recovery_seconds, profiles(full_name, email)").eq("id", attemptId).eq("assignment_id", assignment.id).eq("status", "submitted").maybeSingle();
  if (attemptError || !attempt) notFound();
  const [{ data: composition }, { data: responses }, { data: examEvents }] = await Promise.all([
    supabase.from("attempt_questions").select("question_id, position, points, option_order").eq("attempt_id", attempt.id).order("position"),
    supabase.from("responses").select("question_id, student_answer, is_correct, points_awarded").eq("attempt_id", attempt.id),
    assignment.exam_mode ? supabase.from("attempt_exam_events").select("event_type, occurred_at, away_duration_seconds").eq("attempt_id", attempt.id).order("occurred_at") : Promise.resolve({ data: [] as { event_type: string; occurred_at: string; away_duration_seconds: number | null }[] }),
  ]);
  const questionIds = composition?.map((item) => item.question_id) ?? [];
  const [{ data: questions }, { data: keys }, { data: skillLinks }] = questionIds.length ? await Promise.all([
    supabase.from("questions").select("id, prompt, type, options").in("id", questionIds),
    supabase.from("question_keys").select("question_id, correct_answer, explanation").in("question_id", questionIds),
    supabase.from("question_skills").select("question_id, is_primary, skills(code, name)").in("question_id", questionIds),
  ]) : [{ data: [] }, { data: [] }, { data: [] }];
  const questionById = new Map((questions ?? []).map((question) => [question.id, question])); const responseByQuestion = new Map((responses ?? []).map((response) => [response.question_id, response])); const keyByQuestion = new Map((keys ?? []).map((key) => [key.question_id, key]));
  const skillsByQuestion = new Map<string, { code: string; name: string; is_primary: boolean }[]>();
  for (const link of skillLinks ?? []) { const skill = Array.isArray(link.skills) ? link.skills[0] : link.skills; if (skill) skillsByQuestion.set(link.question_id, [...(skillsByQuestion.get(link.question_id) ?? []), { code: skill.code, name: teacherSkillDisplayName(skill.code), is_primary: link.is_primary }]); }
  const profile = Array.isArray(attempt.profiles) ? attempt.profiles[0] : attempt.profiles;
  const eventLabel: Record<string, string> = { assessment_started: "Started", page_hidden: "Left assessment", page_visible: "Returned", window_blur: "Window lost focus", window_focus: "Window focused", fullscreen_exited: "Exited fullscreen", fullscreen_restored: "Restored fullscreen", fullscreen_unavailable: "Fullscreen unavailable", auto_submit: "Automatically submitted — focus limit exceeded", manual_submit: "Submitted", time_expired: "Time expired", teacher_closed: "Teacher closed assessment" };
  const autoSubmitted = Boolean(examEvents?.some((event) => event.event_type === "auto_submit"));
  const reviewQuestions: TeacherReviewQuestion[] = (composition ?? []).flatMap((item) => {
    const question = questionById.get(item.question_id); const response = responseByQuestion.get(item.question_id); const key = keyByQuestion.get(item.question_id); const skills = skillsByQuestion.get(item.question_id) ?? [];
    if (!question || !key) return [];
    const studentAnswer = response?.student_answer ?? null; const answered = Boolean(studentAnswer?.trim());
    const rawOptions = question.options as { id: string; text: string }[] | null; const optionById = new Map(rawOptions?.map((option) => [option.id, option]) ?? []); const orderedOptions = item.option_order?.length ? item.option_order.flatMap((optionId: string) => optionById.get(optionId) ?? []) : rawOptions;
    return [{ id: item.question_id, number: item.position, prompt: question.prompt, type: question.type, options: orderedOptions, studentAnswer, earnedPoints: response?.points_awarded ?? null, points: Number(item.points), isCorrect: response?.is_correct ?? null, correctAnswer: key.correct_answer, explanation: key.explanation, answered, skills: skills.map((skill) => ({ code: skill.code, name: skill.name, isPrimary: skill.is_primary })) }];
  });
  const correctCount = reviewQuestions.filter((question) => question.answered && question.isCorrect === true).length; const incorrectCount = reviewQuestions.filter((question) => question.answered && question.isCorrect === false).length; const unansweredCount = reviewQuestions.filter((question) => !question.answered).length; const maxScore = Number(attempt.max_score ?? 0); const score = Number(attempt.score ?? 0); const scorePercent = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
  return <main className="teacher-main assessment-page teacher-attempt-page"><Link className="back-link" href={`/teacher/assignments/${assignment.id}`}>← {assignment.title}</Link><section className="page-heading teacher-attempt-heading"><div><p className="eyebrow">{autoSubmitted ? "Auto-submitted attempt" : "Submitted attempt"}</p><h1>{profile?.full_name || profile?.email || "Student"}</h1><p>Attempt {attempt.attempt_number} · Form {attempt.form_code ?? "—"}{attempt.submitted_at ? ` · Submitted ${new Date(attempt.submitted_at).toLocaleString()}` : ""}</p></div><Link className="teacher-attempt-student-link" href={`/teacher/students/${attempt.student_id}`}><span>Student overview</span><strong>View overall progress</strong><b aria-hidden="true">→</b></Link></section>
    <section className="teacher-attempt-overview" aria-labelledby="overall-result-heading"><div className="teacher-attempt-score"><p className="eyebrow">Overall result</p><h2 id="overall-result-heading">{scorePercent}%</h2><p><strong>{score}</strong> of <strong>{maxScore}</strong> points</p></div><div className="teacher-attempt-summary"><article className="correct"><span>Correct</span><strong>{correctCount}</strong></article><article className="incorrect"><span>Incorrect</span><strong>{incorrectCount}</strong></article><article className="unanswered"><span>Unanswered</span><strong>{unansweredCount}</strong></article><article><span>Total questions</span><strong>{reviewQuestions.length}</strong></article></div></section>
    <TeacherAttemptReview questions={reviewQuestions} />
    {assignment.exam_mode && <details className="teacher-section teacher-attempt-activity"><summary><span><b>Exam Mode activity</b><small>{attempt.exam_focus_violations} focus {attempt.exam_focus_violations === 1 ? "exit" : "exits"} · {autoSubmitted ? "Auto-submitted" : "Submitted"}{attempt.offline_recovery_used ? ` · Wi-Fi recovery ${attempt.offline_recovery_seconds}s` : ""}</small></span><strong aria-hidden="true">+</strong></summary><div className="exam-activity"><p>Activity signals and offline recovery show what the browser reported; neither is proof of misconduct.</p>{examEvents?.length ? <div className="exam-activity-list">{examEvents.map((event, index) => <article key={`${event.occurred_at}-${index}`}><strong>{eventLabel[event.event_type] ?? event.event_type}</strong><span>{new Date(event.occurred_at).toLocaleString()}{event.away_duration_seconds !== null ? ` · away ${event.away_duration_seconds} sec` : ""}</span></article>)}</div> : <p className="form-note">No Exam Mode activity was recorded.</p>}</div></details>}
  </main>;
}
