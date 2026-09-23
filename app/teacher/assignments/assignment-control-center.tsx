import QuestionReleaseControls from "./question-release-controls";
import PaperSessionControls from "./paper-session-controls";
import ResultReleaseControls from "./result-release-controls";

type Visibility = "private" | "score_only" | "full_review";

export default function AssignmentControlCenter({ assignmentId, controlled, kind, questionsReleasedAt, status, visibility, durationMinutes = 60, paperStartedAt = null, paperWritingEndsAt = null, paperAnswerDurationSeconds = 90, serverNow }: { assignmentId: string; controlled: boolean; kind: string; questionsReleasedAt: string | null; status: string; visibility: Visibility; durationMinutes?: number | null; paperStartedAt?: string | null; paperWritingEndsAt?: string | null; paperAnswerDurationSeconds?: number; serverNow: string }) {
  const testLike = kind === "test" || kind === "paper";
  const started = !testLike || !controlled || Boolean(questionsReleasedAt);
  const closed = status === "closed";
  const resultsReleased = visibility !== "private";
  const stepClass = (complete: boolean, current = false) => complete ? "is-complete" : current ? "is-current" : "is-pending";
  return <section aria-labelledby="assignment-control-center-title" className="assignment-control-center">
    <header><div><p className="eyebrow">{testLike ? "Assessment lifecycle" : "Assignment lifecycle"}</p><h2 id="assignment-control-center-title">{kind === "test" ? "Test control center" : kind === "paper" ? "Paper test control center" : "Release controls"}</h2><p>{testLike ? "Start the assessment, monitor student work, and release results from one place." : "Manage student access and results without hunting through settings."}</p></div>{status === "published" && <span className="control-center-live"><i aria-hidden="true" />Live</span>}</header>
    <ol aria-label="Assignment lifecycle progress" className={`assignment-lifecycle-steps${testLike ? "" : " is-compact"}`}>
      <li className="is-complete"><span>1</span><div><strong>Publish</strong><small>Students can access it</small></div></li>
      {testLike && <li className={stepClass(started, !started && !closed)}><span>2</span><div><strong>Start</strong><small>{started ? kind === "paper" ? "Answer page open" : "Questions released" : "Waiting for you"}</small></div></li>}
      <li className={stepClass(closed, !closed && started)}><span>{testLike ? 3 : 2}</span><div><strong>Monitor</strong><small>{closed ? "Work ended" : started ? "Track student progress" : "Begins after start"}</small></div></li>
      <li className={stepClass(resultsReleased, closed && !resultsReleased)}><span>{testLike ? 4 : 3}</span><div><strong>Release results</strong><small>{visibility === "full_review" ? "Full review visible" : visibility === "score_only" ? "Scores visible" : "Hidden from students"}</small></div></li>
    </ol>
    <div className="assignment-control-actions">
      {kind === "paper" && status === "published" ? <PaperSessionControls answerDurationSeconds={paperAnswerDurationSeconds} answersReleasedAt={questionsReleasedAt} assignmentId={assignmentId} durationMinutes={durationMinutes ?? 60} serverNow={serverNow} writingEndsAt={paperWritingEndsAt} writingStartedAt={paperStartedAt} /> : testLike && status === "published" && <QuestionReleaseControls assignmentId={assignmentId} controlled={controlled} kind={kind} releasedAt={questionsReleasedAt} />}
      <ResultReleaseControls assignmentId={assignmentId} kind={kind} visibility={visibility} />
    </div>
  </section>;
}
