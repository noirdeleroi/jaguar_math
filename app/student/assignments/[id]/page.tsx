import Link from "next/link";
import { notFound } from "next/navigation";
import AssessmentRunner from "../assessment-runner";
import ExamModeAssessment from "../exam-mode-assessment";
import ExamModeGate from "../exam-mode-start";
import StartAssignmentButton from "../start-assignment-button";
import AssignmentDue from "@/app/components/assignment-due";
import SubmittedAttemptReview from "../submitted-attempt-review";
import AssignmentSkillReview from "../assignment-skill-review";
import { buildAssignmentSkillReview } from "@/lib/assignment-skill-review";
import { requireStudent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type AssignmentPageProps = { params: Promise<{ id: string }> };
type Option = { id: string; text: string };
type QuestionRow = { id: string; prompt: string; type: string; options: Option[] | null };
type AttemptQuestion = { attempt_id: string; question_id: string; position: number; points: number; option_order: string[] };
type ResponseRow = { question_id: string; student_answer: string | null; is_correct: boolean | null; points_awarded: number | null };

function orderedOptions(options: Option[] | null, order: string[]) {
  if (!options || !order.length) return options;
  const byId = new Map(options.map((option) => [option.id, option]));
  const ordered = order.flatMap((optionId) => byId.get(optionId) ?? []);
  return ordered.length === options.length ? ordered : options;
}

export default async function StudentAssignmentPage({ params }: AssignmentPageProps) {
  const student = await requireStudent();
  const { id } = await params;
  const supabase = await createClient();
  const { data: assignment, error } = await supabase.from("assignments").select("id, title, description, kind, status, due_at, duration_minutes, max_attempts, show_score_after_submit, show_answers_after_submit, show_feedback_after_each_question, question_display_mode, shuffle_questions, shuffle_options, exam_mode, exam_require_fullscreen, exam_track_focus_exits, exam_allowed_focus_exits, exam_violation_action").eq("id", id).in("status", ["published", "closed"]).maybeSingle();
  if (error || !assignment) notFound();

  const { data: attempts } = await supabase.from("attempts").select("id, status, started_at, expires_at, form_code, submitted_at, score, max_score, attempt_number, exam_focus_violations").eq("assignment_id", id).eq("student_id", student.id).order("attempt_number", { ascending: false });
  const activeAttempt = attempts?.find((attempt) => attempt.status === "in_progress");
  const latestSubmitted = attempts?.find((attempt) => attempt.status === "submitted");
  const attemptIds = [activeAttempt?.id, latestSubmitted?.id].filter((value): value is string => Boolean(value));

  let attemptQuestions: AttemptQuestion[] = [];
  if (attemptIds.length) {
    const { data } = await supabase.from("attempt_questions").select("attempt_id, question_id, position, points, option_order").in("attempt_id", attemptIds).order("position");
    attemptQuestions = (data ?? []) as AttemptQuestion[];
  }
  const activeForm = attemptQuestions.filter((item) => item.attempt_id === activeAttempt?.id);
  const submittedForm = attemptQuestions.filter((item) => item.attempt_id === latestSubmitted?.id);
  const questionIds = [...new Set(attemptQuestions.map((item) => item.question_id))];
  const { data: rawQuestions } = questionIds.length ? await supabase.from("questions").select("id, prompt, type, options").in("id", questionIds) : { data: [] as QuestionRow[] };
  const questionById = new Map(((rawQuestions ?? []) as QuestionRow[]).map((question) => [question.id, question]));

  let responses: ResponseRow[] = [];
  if (activeAttempt) {
    const { data } = await supabase.from("responses").select("question_id, student_answer, is_correct, points_awarded").eq("attempt_id", activeAttempt.id);
    responses = (data ?? []) as ResponseRow[];
  }
  let submittedResponses: ResponseRow[] = [];
  if (latestSubmitted) {
    const { data } = await supabase.from("responses").select("question_id, student_answer, is_correct, points_awarded").eq("attempt_id", latestSubmitted.id);
    submittedResponses = (data ?? []) as ResponseRow[];
  }

  const responseByQuestion = new Map(responses.map((response) => [response.question_id, response]));
  const runnerQuestions = activeForm.flatMap((item) => {
    const question = questionById.get(item.question_id);
    const response = responseByQuestion.get(item.question_id);
    return question ? [{ ...question, options: orderedOptions(question.options, item.option_order), points: Number(item.points), answer: response?.student_answer ?? "", isCorrect: response?.is_correct ?? null, pointsAwarded: response?.points_awarded ?? null }] : [];
  });

  const isClosed = assignment.status === "closed";
  const canReleaseReview = assignment.kind === "homework" || isClosed;
  let review: { question_id: string; correct_answer: string; explanation: string | null }[] = [];
  if (latestSubmitted && assignment.show_answers_after_submit && canReleaseReview) {
    const { data } = await supabase.rpc("get_attempt_answer_review", { p_attempt_id: latestSubmitted.id });
    review = data ?? [];
  }

  const submittedIds = submittedForm.map((item) => item.question_id);
  const { data: rawSkillLinks } = latestSubmitted && submittedIds.length && (assignment.kind === "homework" || isClosed)
    ? await supabase.from("question_skills").select("question_id, weight, skills(code)").in("question_id", submittedIds)
    : { data: [] as { question_id: string; weight: number; skills: { code: string } | { code: string }[] | null }[] };
  const assignmentSkillLinks = (rawSkillLinks ?? []).flatMap((link) => {
    const skill = Array.isArray(link.skills) ? link.skills[0] : link.skills;
    return skill ? [{ question_id: link.question_id, skill_code: skill.code, weight: Number(link.weight) }] : [];
  });
  const skillReview = buildAssignmentSkillReview(submittedResponses, submittedForm, assignmentSkillLinks);
  const submittedResponseByQuestion = new Map(submittedResponses.map((response) => [response.question_id, response]));
  const reviewByQuestion = new Map(review.map((question) => [question.question_id, question]));
  const submittedReviewQuestions = submittedForm.flatMap((item) => {
    const question = questionById.get(item.question_id);
    if (!question) return [];
    const response = submittedResponseByQuestion.get(item.question_id);
    const answerReview = reviewByQuestion.get(item.question_id);
    return [{ id: item.question_id, number: item.position, prompt: question.prompt, type: question.type, options: orderedOptions(question.options, item.option_order), studentAnswer: response?.student_answer ?? null, earnedPoints: response?.points_awarded ?? null, points: Number(item.points), isCorrect: response?.is_correct ?? null, correctAnswer: answerReview?.correct_answer, explanation: answerReview?.explanation }];
  });

  const resultPercent = latestSubmitted && (latestSubmitted.max_score ?? 0) > 0 ? Math.round(100 * (latestSubmitted.score ?? 0) / (latestSubmitted.max_score ?? 1)) : null;
  const isOverdue = Boolean(assignment.due_at && new Date(assignment.due_at) < new Date());
  const attemptsUsed = attempts?.length ?? 0;
  const canRetry = !isClosed && !activeAttempt && attemptsUsed < assignment.max_attempts && !isOverdue;
  const examMode = assignment.exam_mode ? { requireFullscreen: assignment.exam_require_fullscreen, trackFocusExits: assignment.exam_track_focus_exits, allowedFocusExits: assignment.exam_allowed_focus_exits, violationAction: assignment.exam_violation_action as "warn" | "auto_submit" } : undefined;
  const retryStart = canRetry && !examMode ? <StartAssignmentButton assignmentId={assignment.id} label={latestSubmitted ? "Start another attempt" : `Start ${assignment.kind}`} /> : null;
  const activeRunner = activeAttempt && !isClosed && !examMode ? <AssessmentRunner attemptId={activeAttempt.id} expiresAt={activeAttempt.expires_at} formCode={activeAttempt.form_code} questionDisplayMode={assignment.question_display_mode} questions={runnerQuestions} responsesClosed={isOverdue} showFeedbackAfterEachQuestion={assignment.show_feedback_after_each_question} /> : null;
  const examContent = examMode && !isClosed && activeAttempt ? <ExamModeAssessment assignmentId={assignment.id} expiresAt={activeAttempt.expires_at} examMode={examMode} initialAttempt={{ id: activeAttempt.id, expiresAt: activeAttempt.expires_at, formCode: activeAttempt.form_code, focusViolations: activeAttempt.exam_focus_violations }} questionDisplayMode={assignment.question_display_mode} questions={runnerQuestions} responsesClosed={isOverdue} showFeedbackAfterEachQuestion={assignment.show_feedback_after_each_question} /> : examMode && !isClosed && canRetry ? <ExamModeGate allowedFocusExits={examMode.allowedFocusExits} assignmentId={assignment.id} requireFullscreen={examMode.requireFullscreen} violationAction={examMode.violationAction} /> : null;
  const activeContent = examContent ?? activeRunner;
  const showLearningReview = Boolean(latestSubmitted && (assignment.kind === "homework" || isClosed));

  return <main className="student-page"><div className="student-container"><Link className="back-link" href="/student">← Your assignments</Link><section className="student-intro"><p className="eyebrow">{isClosed ? "Closed" : assignment.kind === "homework" ? "Learning mode · Homework" : assignment.kind === "quiz" ? "Check mode · Quiz" : "Secure mode · Test"}</p><h1>{assignment.title}</h1><p>{assignment.description || "Complete each question, then submit your attempt."}</p><AssignmentDue dueAt={assignment.due_at} status={assignment.status} /></section>{activeContent ?? (latestSubmitted ? <section className="student-results"><p className="eyebrow">Submitted · Form {latestSubmitted.form_code ?? "—"}</p><h2>Attempt {latestSubmitted.attempt_number}</h2>{isClosed && activeAttempt && <p className="form-note lifecycle-note">This assignment is closed. Your in-progress attempt is preserved, but it cannot be changed or submitted.</p>}{assignment.show_score_after_submit && <><p className="result-score">{latestSubmitted.score ?? 0} / {latestSubmitted.max_score ?? 0}</p>{resultPercent !== null && <p className="result-percent">{resultPercent}%</p>}</>}{!assignment.show_score_after_submit && <p>Your teacher will release results after the assessment window closes.</p>}{showLearningReview && <AssignmentSkillReview kind={assignment.kind} skills={skillReview} />}<SubmittedAttemptReview questions={submittedReviewQuestions} /></section> : null)}{retryStart ?? (!activeContent && !latestSubmitted && <section className="student-results"><h2>{isClosed ? "This assignment is closed." : "This assignment is no longer available."}</h2><p>{isClosed ? activeAttempt ? "Your in-progress attempt is preserved, but it cannot be changed or submitted." : "Your teacher has closed this assignment." : "The due date has passed or all attempts have been used."}</p></section>)}</div></main>;
}
