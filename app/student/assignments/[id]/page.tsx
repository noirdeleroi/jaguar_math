import Link from "next/link";
import { notFound } from "next/navigation";
import videoMap from "@/data/jaguar_math_skill_youtube_map.json";
import AssessmentRunner from "../assessment-runner";
import ExamModeAssessment from "../exam-mode-assessment";
import ExamModeGate from "../exam-mode-start";
import StartAssignmentButton from "../start-assignment-button";
import AssignmentDue from "@/app/components/assignment-due";
import SubmittedAttemptReview from "../submitted-attempt-review";
import AssignmentSkillReview from "../assignment-skill-review";
import PaperAssessmentGate, { type PaperSessionState } from "../paper-assessment-gate";
import TestAttemptRefresher from "../test-attempt-refresher";
import { buildAssignmentSkillReview } from "@/lib/assignment-skill-review";
import { assignmentPdfIsAvailable } from "@/lib/homework-pdf-release";
import { homeworkResultsAreAvailable } from "@/lib/attempt-review";
import { testQuestionsAreReleased } from "@/lib/test-question-release";
import { requireStudent } from "@/lib/auth";
import { skillDisplayName } from "@/lib/skill-display-names";
import { createClient } from "@/lib/supabase/server";

type AssignmentPageProps = { params: Promise<{ id: string }>; searchParams: Promise<{ attempt?: string }> };
type Option = { id: string; text: string };
type QuestionRow = { id: string; prompt: string; type: string; options: Option[] | null };
type AttemptQuestion = { attempt_id: string; question_id: string; position: number; points: number; option_order: string[] };
type PaperAnswerQuestion = { question_id: string; answer_position: number; points: number; question_type: string; option_ids: string[] };
type ResponseRow = { question_id: string; student_answer: string | null; client_revision: number; is_correct: boolean | null; points_awarded: number | null };
type AttemptRow = { id: string; assignment_id: string; status: "in_progress" | "submitted"; started_at: string; expires_at: string | null; form_code: string | null; submitted_at: string | null; score: number | null; max_score: number | null; attempt_number: number; exam_focus_violations: number; teacher_extra_minutes: number };
type VideoEntry = { youtube_video_title: string; youtube_link: string };

const videos = videoMap as Record<string, VideoEntry>;

function orderedOptions(options: Option[] | null, order: string[]) {
  if (!options || !order.length) return options;
  const byId = new Map(options.map((option) => [option.id, option]));
  const ordered = order.flatMap((optionId) => byId.get(optionId) ?? []);
  return ordered.length === options.length ? ordered : options;
}

export default async function StudentAssignmentPage({ params, searchParams }: AssignmentPageProps) {
  await requireStudent();
  const { id } = await params;
  const supabase = await createClient();
  const { data: assignment, error } = await supabase.from("assignments").select("id, title, description, kind, status, due_at, duration_minutes, max_attempts, show_score_after_submit, show_answers_after_submit, show_feedback_after_each_question, question_display_mode, shuffle_questions, shuffle_options, exam_mode, exam_require_fullscreen, exam_track_focus_exits, exam_allowed_focus_exits, exam_violation_action, teacher_controlled_question_release, questions_released_at, paper_started_at, paper_writing_ends_at, paper_writing_paused_at, paper_answer_duration_seconds, homework_pdf_released_at").eq("id", id).in("status", ["published", "closed"]).maybeSingle();
  if (error) {
    console.error(`[student-assignment] load failed: code=${error.code}; message=${error.message}`);
    throw new Error("Student assignment data could not be loaded.");
  }
  if (!assignment) notFound();

  if (assignment.kind === "test" || assignment.kind === "paper") {
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
  const submittedAttempts = attempts.filter((attempt) => attempt.status === "submitted").sort((left, right) => right.attempt_number - left.attempt_number);
  const latestSubmitted = submittedAttempts[0];
  const { attempt: requestedAttemptId } = await searchParams;
  const reviewedAttempt = requestedAttemptId ? submittedAttempts.find((attempt) => attempt.id === requestedAttemptId) ?? (activeAttempt ? undefined : latestSubmitted) : activeAttempt ? undefined : latestSubmitted;
  const serverNow = new Date().toISOString();
  const isOverdue = Boolean(assignment.due_at && new Date(assignment.due_at) < new Date(serverNow));
  const homeworkResultsReady = homeworkResultsAreAvailable(assignment.kind, assignment.due_at, new Date(serverNow).getTime());
  const answerReviewVisible = assignment.show_answers_after_submit || homeworkResultsReady;
  const scoreVisible = assignment.kind !== "homework" && (assignment.show_score_after_submit || homeworkResultsReady);
  const privateSubmission = assignment.kind !== "homework" && latestSubmitted && !activeAttempt && !assignment.show_score_after_submit && !assignment.show_answers_after_submit;
  if (privateSubmission) return <main className="student-page">{(assignment.kind === "test" || assignment.kind === "paper") && assignment.status === "published" && <TestAttemptRefresher />}<div className="student-container"><Link className="back-link" href="/student">← Your assignments</Link><section aria-labelledby="submission-title" className="student-results submission-success"><div aria-hidden="true" className="submission-confetti"><span /><span /><span /><span /><span /></div><div aria-hidden="true" className="submission-check">✓</div><p className="eyebrow">Nice work · Submitted!</p><h1 id="submission-title">Your assessment is in.</h1><p className="submission-assessment">“{assignment.title}” was submitted successfully.</p><div className="submission-next"><span aria-hidden="true">✦</span><div><strong>Now for the easy part</strong><p>Sit tight—your teacher will release your result when it&apos;s ready.</p></div></div><Link className="dashboard-action submission-dashboard-link" href="/student">Back to dashboard <span aria-hidden="true">→</span></Link></section></div></main>;

  const { data: rawPaperSession } = assignment.kind === "paper" ? await supabase.rpc("get_my_paper_session_state", { p_assignment_id: id }) : { data: null };
  const paperSessionRow = (Array.isArray(rawPaperSession) ? rawPaperSession[0] : rawPaperSession) as { server_now?: string; writing_started_at?: string | null; writing_ends_at?: string | null; writing_paused_at?: string | null; answers_released_at?: string | null; answer_ends_at?: string | null; answer_duration_seconds?: number; paper_version_count?: number; paper_version_confirmed?: boolean; attempt_id?: string | null; attempt_status?: string | null; form_code?: string | null; focus_violations?: number } | null;
  const paperSession: PaperSessionState | null = assignment.kind === "paper" ? {
    serverNow: paperSessionRow?.server_now ?? new Date().toISOString(), writingStartedAt: paperSessionRow?.writing_started_at ?? assignment.paper_started_at,
    writingEndsAt: paperSessionRow?.writing_ends_at ?? assignment.paper_writing_ends_at, writingPausedAt: paperSessionRow?.writing_paused_at ?? assignment.paper_writing_paused_at, answersReleasedAt: paperSessionRow?.answers_released_at ?? assignment.questions_released_at,
    answerEndsAt: paperSessionRow?.answer_ends_at ?? activeAttempt?.expires_at ?? null, answerDurationSeconds: Number(paperSessionRow?.answer_duration_seconds ?? assignment.paper_answer_duration_seconds ?? 90),
    paperVersionCount: Number(paperSessionRow?.paper_version_count ?? 4), paperVersionConfirmed: Boolean(paperSessionRow?.paper_version_confirmed),
    attemptId: paperSessionRow?.attempt_id ?? activeAttempt?.id ?? null, attemptStatus: paperSessionRow?.attempt_status ?? activeAttempt?.status ?? null, formCode: paperSessionRow?.form_code ?? activeAttempt?.form_code ?? null, focusViolations: Number(paperSessionRow?.focus_violations ?? activeAttempt?.exam_focus_violations ?? 0),
  } : null;
  const paperAnswersReleased = Boolean(paperSession?.answersReleasedAt);

  const attemptIds = [activeAttempt?.id, answerReviewVisible ? reviewedAttempt?.id : undefined].filter((value): value is string => Boolean(value));

  let attemptQuestions: AttemptQuestion[] = [];
  if (attemptIds.length) {
    const { data } = await supabase.from("attempt_questions").select("attempt_id, question_id, position, points, option_order").in("attempt_id", attemptIds).order("position");
    attemptQuestions = (data ?? []) as AttemptQuestion[];
  }
  const activeForm = attemptQuestions.filter((item) => item.attempt_id === activeAttempt?.id);
  const submittedForm = attemptQuestions.filter((item) => item.attempt_id === reviewedAttempt?.id);
  const questionIds = [...new Set(attemptQuestions.map((item) => item.question_id))];
  const { data: rawQuestions } = questionIds.length ? await supabase.from("questions").select("id, prompt, type, options").in("id", questionIds) : { data: [] as QuestionRow[] };
  const questionById = new Map(((rawQuestions ?? []) as QuestionRow[]).map((question) => [question.id, question]));
  const { data: rawSkillLinks } = questionIds.length
    ? await supabase.from("question_skills").select("question_id, weight, is_primary, skills(code)").in("question_id", questionIds)
    : { data: [] as { question_id: string; weight: number; is_primary: boolean; skills: { code: string } | { code: string }[] | null }[] };
  const questionSkillLinks = (rawSkillLinks ?? []).flatMap((link) => {
    const skill = Array.isArray(link.skills) ? link.skills[0] : link.skills;
    return skill ? [{ question_id: link.question_id, skill_code: skill.code, weight: Number(link.weight), is_primary: Boolean(link.is_primary) }] : [];
  });
  const learningHelpByQuestion = new Map<string, { skillName: string; videoTitle: string; videoHref: string }>();
  for (const link of [...questionSkillLinks].sort((left, right) => Number(right.is_primary) - Number(left.is_primary) || right.weight - left.weight)) {
    const video = videos[link.skill_code];
    if (video && !learningHelpByQuestion.has(link.question_id)) learningHelpByQuestion.set(link.question_id, { skillName: skillDisplayName(link.skill_code), videoTitle: video.youtube_video_title, videoHref: video.youtube_link });
  }

  let responses: ResponseRow[] = [];
  if (activeAttempt) {
    const { data } = await supabase.from("responses").select("question_id, student_answer, client_revision, is_correct, points_awarded").eq("attempt_id", activeAttempt.id);
    responses = (data ?? []) as ResponseRow[];
  }
  let submittedResponses: ResponseRow[] = [];
  if (reviewedAttempt && answerReviewVisible) {
    const { data } = await supabase.from("responses").select("question_id, student_answer, client_revision, is_correct, points_awarded").eq("attempt_id", reviewedAttempt.id);
    submittedResponses = (data ?? []) as ResponseRow[];
  }

  const responseByQuestion = new Map(responses.map((response) => [response.question_id, response]));
  let paperAnswerQuestions: PaperAnswerQuestion[] = [];
  if (activeAttempt && assignment.kind === "paper" && paperAnswersReleased) {
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
    return question ? [{ ...question, options: orderedOptions(question.options, item.option_order), points: Number(item.points), answer: response?.student_answer ?? "", serverRevision: Number(response?.client_revision ?? 0), isCorrect: response?.is_correct ?? null, pointsAwarded: response?.points_awarded ?? null, learningHelp: assignment.kind === "homework" ? learningHelpByQuestion.get(item.question_id) : undefined }] : [];
  });

  const isClosed = assignment.status === "closed";
  let review: { question_id: string; correct_answer: string; explanation: string | null }[] = [];
  if (reviewedAttempt && answerReviewVisible) {
    const { data } = await supabase.rpc("get_attempt_answer_review", { p_attempt_id: reviewedAttempt.id });
    review = data ?? [];
  }

  const submittedIds = new Set(submittedForm.map((item) => item.question_id));
  const assignmentSkillLinks = questionSkillLinks.filter((link) => submittedIds.has(link.question_id));
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

  const resultPercent = assignment.kind !== "homework" && reviewedAttempt && (reviewedAttempt.max_score ?? 0) > 0 ? Math.round(100 * (reviewedAttempt.score ?? 0) / (reviewedAttempt.max_score ?? 1)) : null;
  const hasActiveTimeExtension = Boolean(activeAttempt?.teacher_extra_minutes && activeAttempt.expires_at && new Date(activeAttempt.expires_at) > new Date());
  const responsesClosed = isOverdue && !hasActiveTimeExtension;
  const attemptsUsed = attempts.length;
  const canRetry = !isClosed && !activeAttempt && attemptsUsed < assignment.max_attempts && !isOverdue;
  const questionsReleased = testQuestionsAreReleased({ kind: assignment.kind, teacherControlledQuestionRelease: assignment.teacher_controlled_question_release, questionsReleasedAt: assignment.questions_released_at });
  const examMode = assignment.exam_mode ? { requireFullscreen: assignment.exam_require_fullscreen, trackFocusExits: assignment.exam_track_focus_exits, allowedFocusExits: assignment.exam_allowed_focus_exits, violationAction: assignment.exam_violation_action as "warn" | "auto_submit" } : undefined;
  const retryStart = canRetry && !examMode && assignment.kind !== "paper" ? <StartAssignmentButton assignmentId={assignment.id} label={latestSubmitted ? "Start another attempt" : `Start ${assignment.kind}`} /> : null;
  const activeRunner = activeAttempt && !isClosed && (assignment.kind === "paper" ? paperAnswersReleased : !examMode) ? <AssessmentRunner attemptId={activeAttempt.id} expiresAt={assignment.kind === "homework" ? assignment.due_at : activeAttempt.expires_at} formCode={activeAttempt.form_code} homeworkMode={assignment.kind === "homework"} paperMode={assignment.kind === "paper"} examMode={assignment.kind === "paper" && examMode ? { ...examMode, focusViolations: activeAttempt.exam_focus_violations } : undefined} questionDisplayMode={assignment.question_display_mode} questions={runnerQuestions} responsesClosed={responsesClosed} serverNow={paperSession?.serverNow ?? serverNow} showFeedbackAfterEachQuestion={assignment.show_feedback_after_each_question} /> : null;
  const examContent = assignment.kind === "test" && examMode && !isClosed && activeAttempt ? <ExamModeAssessment assignmentId={assignment.id} durationMinutes={assignment.duration_minutes} expiresAt={activeAttempt.expires_at} examMode={examMode} initialAttempt={{ id: activeAttempt.id, expiresAt: activeAttempt.expires_at, formCode: activeAttempt.form_code, focusViolations: activeAttempt.exam_focus_violations }} questionDisplayMode={assignment.question_display_mode} questions={runnerQuestions} responsesClosed={responsesClosed} showFeedbackAfterEachQuestion={assignment.show_feedback_after_each_question} /> : assignment.kind === "test" && examMode && !isClosed && canRetry ? <ExamModeGate allowedFocusExits={examMode.allowedFocusExits} assignmentId={assignment.id} durationMinutes={assignment.duration_minutes} instructions={assignment.description} questionsReleased={questionsReleased} requireFullscreen={examMode.requireFullscreen} violationAction={examMode.violationAction} /> : null;
  const activeContent = examContent ?? activeRunner;
  const showLearningReview = Boolean(reviewedAttempt && answerReviewVisible);
  const pdfAvailable = assignmentPdfIsAvailable({ kind: assignment.kind, dueAt: assignment.due_at, releasedAt: assignment.homework_pdf_released_at });
  const paperWaiting = assignment.kind === "paper" && !isClosed && !latestSubmitted && paperSession && (!activeAttempt || !paperAnswersReleased || !paperSession.paperVersionConfirmed);
  const attemptHistory = assignment.kind === "homework" && submittedAttempts.length ? <section className="student-attempt-history" aria-labelledby="attempt-history-title"><div><p className="eyebrow">Practice history</p><h2 id="attempt-history-title">Completed practice</h2><p>Open any attempt to revisit mistakes, solutions, and the skills to strengthen.</p></div><nav aria-label="Completed homework attempts">{submittedAttempts.map((attempt) => <Link aria-current={attempt.id === reviewedAttempt?.id ? "page" : undefined} className={attempt.id === reviewedAttempt?.id ? "is-current" : ""} href={`/student/assignments/${assignment.id}?attempt=${attempt.id}#attempt-result`} key={attempt.id}><span><strong>Practice {attempt.attempt_number}</strong><small>{attempt.submitted_at ? new Date(attempt.submitted_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Completed"}</small></span><b>Review learning →</b></Link>)}</nav></section> : null;
  const reviewedResult = reviewedAttempt ? <section className="student-results" id="attempt-result"><p className="eyebrow">{assignment.kind === "homework" ? "Practice review" : `Submitted attempt · Form ${reviewedAttempt.form_code ?? "—"}`}</p><h2>{assignment.kind === "homework" ? `What to work on from practice ${reviewedAttempt.attempt_number}` : scoreVisible ? `Attempt ${reviewedAttempt.attempt_number}` : `Your assessment “${assignment.title}” was submitted.`}</h2>{scoreVisible && <><p className="result-score">{reviewedAttempt.score ?? 0} / {reviewedAttempt.max_score ?? 0}</p>{resultPercent !== null && <p className="result-percent">{resultPercent}%</p>}</>}{showLearningReview && <AssignmentSkillReview kind={assignment.kind} skills={skillReview} />}{answerReviewVisible && <SubmittedAttemptReview learningMode={assignment.kind === "homework"} questions={submittedReviewQuestions} />}</section> : null;

  return <main className="student-page">{assignment.kind === "test" && !isClosed && !activeAttempt && !examMode && <TestAttemptRefresher />}<div className="student-container"><Link className="back-link" href="/student">← Your assignments</Link><section className="student-intro"><p className="eyebrow">{isClosed ? "Closed" : assignment.kind === "homework" ? "Learning mode · Homework" : assignment.kind === "quiz" ? "Check mode · Quiz" : assignment.kind === "paper" ? "Paper mode · Secure test" : "Secure mode · Test"}</p><h1>{assignment.title}</h1><p>{assignment.description || (assignment.kind === "homework" ? "Try each question, check the solution, and change your answer as often as you need. Homework is practice—there is no grade." : assignment.kind === "paper" ? "Complete the printed test, then enter your answers when your teacher opens the answer window." : "Complete each question, then submit your attempt.")}</p><AssignmentDue dueAt={assignment.due_at} status={assignment.status} /></section>{pdfAvailable && <section className="student-pdf-download"><div><p className="eyebrow">Assessment PDF</p><h2>Questions and answers are ready.</h2><p>{assignment.kind === "homework" && isOverdue ? "The homework deadline has passed, so the printable PDF is ready to download." : "Your teacher released the printable questions and answers."}</p></div><a className="dashboard-action" download href={`/api/assignments/${assignment.id}/answer-key.pdf`}>Download PDF <span aria-hidden="true">↓</span></a></section>}{attemptHistory}{reviewedResult}{paperWaiting ? <PaperAssessmentGate assignmentId={assignment.id} durationMinutes={assignment.duration_minutes ?? 60} initialSession={paperSession!} /> : activeContent}{!paperWaiting && (retryStart ?? (!activeContent && !latestSubmitted && <section className="student-results"><h2>{isClosed ? "This assignment is closed." : "This assignment is no longer available."}</h2><p>{isClosed ? activeAttempt ? "Your in-progress attempt is preserved, but it cannot be changed or submitted." : "Your teacher has closed this assignment." : "The due date has passed or all attempts have been used."}</p></section>))}{isClosed && activeAttempt && <p className="form-note lifecycle-note">This assignment is closed. Your in-progress attempt is preserved, but it cannot be changed or submitted.</p>}</div></main>;
}
