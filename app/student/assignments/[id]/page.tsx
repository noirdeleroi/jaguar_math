import Link from "next/link";
import { notFound } from "next/navigation";
import AssessmentRunner from "../assessment-runner";
import ExamModeAssessment from "../exam-mode-assessment";
import ExamModeGate from "../exam-mode-start";
import StartAssignmentButton from "../start-assignment-button";
import AssignmentDue from "@/app/components/assignment-due";
import SubmittedAttemptReview from "../submitted-attempt-review";
import AssignmentSkillReview from "../assignment-skill-review";
import TestAttemptRefresher from "../test-attempt-refresher";
import { buildAssignmentSkillReview } from "@/lib/assignment-skill-review";
import { homeworkPdfIsAvailable } from "@/lib/homework-pdf-release";
import { testQuestionsAreReleased } from "@/lib/test-question-release";
import { requireStudent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type AssignmentPageProps = { params: Promise<{ id: string }> };
type Option = { id: string; text: string };
type QuestionRow = { id: string; prompt: string; type: string; options: Option[] | null };
type AttemptQuestion = { attempt_id: string; question_id: string; position: number; points: number; option_order: string[] };
type PaperAnswerQuestion = { question_id: string; answer_position: number; points: number; question_type: string; option_ids: string[] };
type ResponseRow = { question_id: string; student_answer: string | null; client_revision: number; is_correct: boolean | null; points_awarded: number | null };
type AttemptRow = { id: string; assignment_id: string; status: "in_progress" | "submitted"; started_at: string; expires_at: string | null; form_code: string | null; submitted_at: string | null; score: number | null; max_score: number | null; attempt_number: number; exam_focus_violations: number; teacher_extra_minutes: number };

function orderedOptions(options: Option[] | null, order: string[]) {
  if (!options || !order.length) return options;
  const byId = new Map(options.map((option) => [option.id, option]));
  const ordered = order.flatMap((optionId) => byId.get(optionId) ?? []);
  return ordered.length === options.length ? ordered : options;
}

export default async function StudentAssignmentPage({ params }: AssignmentPageProps) {
  await requireStudent();
  const { id } = await params;
  const supabase = await createClient();
  const { data: assignment, error } = await supabase.from("assignments").select("id, title, description, kind, status, due_at, duration_minutes, max_attempts, show_score_after_submit, show_answers_after_submit, show_feedback_after_each_question, question_display_mode, shuffle_questions, shuffle_options, exam_mode, exam_require_fullscreen, exam_track_focus_exits, exam_allowed_focus_exits, exam_violation_action, teacher_controlled_question_release, questions_released_at, homework_pdf_released_at").eq("id", id).in("status", ["published", "closed"]).maybeSingle();
  if (error) {
    console.error(`[student-assignment] load failed: code=${error.code}; message=${error.message}`);
    throw new Error("Student assignment data could not be loaded.");
  }
  if (!assignment) notFound();

  if (assignment.kind === "homework") {
    const { error: finalizationError } = await supabase.rpc("finalize_overdue_homework_attempts", { p_assignment_id: id });
    if (finalizationError) console.error(`[student-assignment] overdue homework finalization failed: code=${finalizationError.code}; message=${finalizationError.message}`);
  } else if (assignment.kind === "test") {
    const { error: finalizationError } = await supabase.rpc("finalize_expired_test_attempts", { p_assignment_id: id });
    if (finalizationError) console.error(`[student-assignment] expired Test finalization failed: code=${finalizationError.code}; message=${finalizationError.message}`);
  }

  const { data: attemptData, error: attemptsError } = await supabase.rpc("get_my_assignment_attempts", { p_assignment_id: id });
  if (attemptsError) {
    console.error(`[student-assignment] attempts failed: code=${attemptsError.code}; message=${attemptsError.message}`);
    throw new Error("Student attempt data could not be loaded.");
  }
  const attempts = (attemptData ?? []) as AttemptRow[];
  const activeAttempt = attempts?.find((attempt) => attempt.status === "in_progress");
  const latestSubmitted = attempts?.find((attempt) => attempt.status === "submitted");
  const privateSubmission = assignment.kind !== "homework" && latestSubmitted && !activeAttempt && !assignment.show_score_after_submit && !assignment.show_answers_after_submit;
  if (privateSubmission) return <main className="student-page">{(assignment.kind === "test" || assignment.kind === "paper") && assignment.status === "published" && <TestAttemptRefresher />}<div className="student-container"><Link className="back-link" href="/student">← Your assignments</Link><section aria-labelledby="submission-title" className="student-results submission-success"><div aria-hidden="true" className="submission-confetti"><span /><span /><span /><span /><span /></div><div aria-hidden="true" className="submission-check">✓</div><p className="eyebrow">Nice work · Submitted!</p><h1 id="submission-title">Your assessment is in.</h1><p className="submission-assessment">“{assignment.title}” was submitted successfully.</p><div className="submission-next"><span aria-hidden="true">✦</span><div><strong>Now for the easy part</strong><p>Sit tight—your teacher will release your result when it&apos;s ready.</p></div></div><Link className="dashboard-action submission-dashboard-link" href="/student">Back to dashboard <span aria-hidden="true">→</span></Link></section></div></main>;

  const attemptIds = [activeAttempt?.id, assignment.show_answers_after_submit ? latestSubmitted?.id : undefined].filter((value): value is string => Boolean(value));

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
    const { data } = await supabase.from("responses").select("question_id, student_answer, client_revision, is_correct, points_awarded").eq("attempt_id", activeAttempt.id);
    responses = (data ?? []) as ResponseRow[];
  }
  let submittedResponses: ResponseRow[] = [];
  if (latestSubmitted && assignment.show_answers_after_submit) {
    const { data } = await supabase.from("responses").select("question_id, student_answer, client_revision, is_correct, points_awarded").eq("attempt_id", latestSubmitted.id);
    submittedResponses = (data ?? []) as ResponseRow[];
  }

  const responseByQuestion = new Map(responses.map((response) => [response.question_id, response]));
  let paperAnswerQuestions: PaperAnswerQuestion[] = [];
  if (activeAttempt && assignment.kind === "paper") {
    const { data, error: paperSheetError } = await supabase.rpc("get_my_paper_answer_sheet", { p_attempt_id: activeAttempt.id });
    if (paperSheetError) {
      console.error(`[student-assignment] paper answer sheet failed: code=${paperSheetError.code}; message=${paperSheetError.message}`);
      throw new Error("The paper answer sheet could not be loaded.");
    }
    paperAnswerQuestions = (data ?? []) as PaperAnswerQuestion[];
  }
  const runnerQuestions = assignment.kind === "paper" ? paperAnswerQuestions.map((item) => {
    const response = responseByQuestion.get(item.question_id);
    return { id: item.question_id, prompt: "", type: item.question_type, options: item.question_type === "multiple_choice" ? item.option_ids.map((optionId) => ({ id: optionId, text: "" })) : null, points: Number(item.points), answer: response?.student_answer ?? "", serverRevision: Number(response?.client_revision ?? 0), isCorrect: response?.is_correct ?? null, pointsAwarded: response?.points_awarded ?? null };
  }) : activeForm.flatMap((item) => {
    const question = questionById.get(item.question_id);
    const response = responseByQuestion.get(item.question_id);
    return question ? [{ ...question, options: orderedOptions(question.options, item.option_order), points: Number(item.points), answer: response?.student_answer ?? "", serverRevision: Number(response?.client_revision ?? 0), isCorrect: response?.is_correct ?? null, pointsAwarded: response?.points_awarded ?? null }] : [];
  });

  const isClosed = assignment.status === "closed";
  let review: { question_id: string; correct_answer: string; explanation: string | null }[] = [];
  if (latestSubmitted && assignment.show_answers_after_submit) {
    const { data } = await supabase.rpc("get_attempt_answer_review", { p_attempt_id: latestSubmitted.id });
    review = data ?? [];
  }

  const submittedIds = submittedForm.map((item) => item.question_id);
  const { data: rawSkillLinks } = latestSubmitted && submittedIds.length && assignment.show_answers_after_submit
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
  const hasActiveTimeExtension = Boolean(activeAttempt?.teacher_extra_minutes && activeAttempt.expires_at && new Date(activeAttempt.expires_at) > new Date());
  const responsesClosed = isOverdue && !hasActiveTimeExtension;
  const attemptsUsed = attempts.length;
  const canRetry = !isClosed && !activeAttempt && attemptsUsed < assignment.max_attempts && !isOverdue;
  const questionsReleased = testQuestionsAreReleased({ kind: assignment.kind, teacherControlledQuestionRelease: assignment.teacher_controlled_question_release, questionsReleasedAt: assignment.questions_released_at });
  const examMode = assignment.exam_mode ? { requireFullscreen: assignment.exam_require_fullscreen, trackFocusExits: assignment.exam_track_focus_exits, allowedFocusExits: assignment.exam_allowed_focus_exits, violationAction: assignment.exam_violation_action as "warn" | "auto_submit" } : undefined;
  const retryStart = canRetry && !examMode && (assignment.kind !== "paper" || questionsReleased) ? <StartAssignmentButton assignmentId={assignment.id} label={latestSubmitted ? "Start another attempt" : assignment.kind === "paper" ? "Open my answer sheet" : `Start ${assignment.kind}`} /> : null;
  const activeRunner = activeAttempt && !isClosed && !examMode ? <AssessmentRunner attemptId={activeAttempt.id} expiresAt={activeAttempt.expires_at} formCode={activeAttempt.form_code} paperMode={assignment.kind === "paper"} questionDisplayMode={assignment.question_display_mode} questions={runnerQuestions} responsesClosed={responsesClosed} showFeedbackAfterEachQuestion={assignment.show_feedback_after_each_question} /> : null;
  const examContent = examMode && !isClosed && activeAttempt ? <ExamModeAssessment assignmentId={assignment.id} durationMinutes={assignment.duration_minutes} expiresAt={activeAttempt.expires_at} examMode={examMode} initialAttempt={{ id: activeAttempt.id, expiresAt: activeAttempt.expires_at, formCode: activeAttempt.form_code, focusViolations: activeAttempt.exam_focus_violations }} questionDisplayMode={assignment.question_display_mode} questions={runnerQuestions} responsesClosed={responsesClosed} showFeedbackAfterEachQuestion={assignment.show_feedback_after_each_question} /> : examMode && !isClosed && canRetry ? <ExamModeGate allowedFocusExits={examMode.allowedFocusExits} assignmentId={assignment.id} durationMinutes={assignment.duration_minutes} instructions={assignment.description} questionsReleased={questionsReleased} requireFullscreen={examMode.requireFullscreen} violationAction={examMode.violationAction} /> : null;
  const activeContent = examContent ?? activeRunner;
  const showLearningReview = Boolean(latestSubmitted && assignment.show_answers_after_submit);
  const pdfAvailable = homeworkPdfIsAvailable({ kind: assignment.kind, dueAt: assignment.due_at, releasedAt: assignment.homework_pdf_released_at });
  const paperWaiting = assignment.kind === "paper" && !isClosed && canRetry && !questionsReleased;

  return <main className="student-page">{((assignment.kind === "test" && !isClosed && !activeAttempt && !examMode) || paperWaiting) && <TestAttemptRefresher />}<div className="student-container"><Link className="back-link" href="/student">← Your assignments</Link><section className="student-intro"><p className="eyebrow">{isClosed ? "Closed" : assignment.kind === "homework" ? "Learning mode · Homework" : assignment.kind === "quiz" ? "Check mode · Quiz" : assignment.kind === "paper" ? "Paper mode · Answer sheet" : "Secure mode · Test"}</p><h1>{assignment.title}</h1><p>{assignment.description || (assignment.kind === "paper" ? "Use the printed test and enter each answer in Jaguar." : "Complete each question, then submit your attempt.")}</p><AssignmentDue dueAt={assignment.due_at} status={assignment.status} /></section>{pdfAvailable && <section className="student-pdf-download"><div><p className="eyebrow">Homework PDF</p><h2>Questions and answers are ready.</h2><p>Your teacher released the printable homework packet after the deadline.</p></div><a className="dashboard-action" download href={`/api/assignments/${assignment.id}/answer-key.pdf`}>Download PDF <span aria-hidden="true">↓</span></a></section>}{paperWaiting ? <section className="student-results"><div className="paper-answer-waiting"><span aria-hidden="true">⌛</span><p className="eyebrow">Waiting for your teacher</p><h2>The paper answer page is not open yet.</h2><p>Keep this page open. It refreshes automatically; once your teacher opens the assessment, you can receive your paper version and enter answers.</p></div></section> : activeContent ?? (latestSubmitted ? <section className="student-results"><p className="eyebrow">Submitted{assignment.show_answers_after_submit ? ` · Form ${latestSubmitted.form_code ?? "—"}` : ""}</p><h2>{assignment.show_score_after_submit ? `Attempt ${latestSubmitted.attempt_number}` : `Your assessment “${assignment.title}” was submitted.`}</h2>{isClosed && activeAttempt && <p className="form-note lifecycle-note">This assignment is closed. Your in-progress attempt is preserved, but it cannot be changed or submitted.</p>}{assignment.show_score_after_submit && <><p className="result-score">{latestSubmitted.score ?? 0} / {latestSubmitted.max_score ?? 0}</p>{resultPercent !== null && <p className="result-percent">{resultPercent}%</p>}</>}{showLearningReview && <AssignmentSkillReview kind={assignment.kind} skills={skillReview} />}{assignment.show_answers_after_submit && <SubmittedAttemptReview questions={submittedReviewQuestions} />}</section> : null)}{!paperWaiting && (retryStart ?? (!activeContent && !latestSubmitted && <section className="student-results"><h2>{isClosed ? "This assignment is closed." : "This assignment is no longer available."}</h2><p>{isClosed ? activeAttempt ? "Your in-progress attempt is preserved, but it cannot be changed or submitted." : "Your teacher has closed this assignment." : "The due date has passed or all attempts have been used."}</p></section>))}</div></main>;
}
