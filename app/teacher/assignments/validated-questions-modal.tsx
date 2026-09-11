"use client";

import { useEffect, useState, type CSSProperties } from "react";
import MathText from "@/app/components/math-text";
import type { ImportedQuestion } from "@/lib/assignment-import";
import styles from "./validated-questions-modal.module.css";

type ReviewMode = "edit" | "proof";

type Props = {
  groups: ImportedQuestion[][];
  onUpdate: (
    groupIndex: number,
    variantIndex: number,
    patch: Partial<ImportedQuestion>,
  ) => void;
  onClose: () => void;
};

export default function ValidatedQuestionsModal({
  groups,
  onUpdate,
  onClose,
}: Props) {
  const [selected, setSelected] = useState(0);
  const [versionView, setVersionView] = useState<number | "all">(0);
  const [mode, setMode] = useState<ReviewMode>("edit");
  const variant = typeof versionView === "number" ? versionView : 0;
  const questions = groups.map((group) => group[0]);
  const question = groups[selected][variant];

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  const updateOption = (optionIndex: number, text: string) =>
    onUpdate(selected, variant, {
      options:
        question.options?.map((option, index) =>
          index === optionIndex ? { ...option, text } : option,
        ) ?? null,
    });

  const updateSkills = (value: string) =>
    onUpdate(selected, variant, {
      skills: value.split(",").map((code, index) => ({
        code: code.trim(),
        weight: 1,
        is_primary: index === 0,
      })),
    });

  const selectQuestion = (index: number) => {
    setSelected(index);
    if (versionView !== "all") setVersionView(0);
  };

  return (
    <div
      aria-labelledby="validated-questions-title"
      aria-modal="true"
      className="validated-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      <section className={`validated-modal ${styles.modal}`}>
        <header className={`validated-modal-header ${styles.header}`}>
          <div className={styles.headerCopy}>
            <p className="eyebrow">Assignment review</p>
            <h2 id="validated-questions-title">
              {mode === "edit" ? "Question review" : "Full test proof"}
            </h2>
            <p>
              {mode === "edit"
                ? "Edit each variant and compare it with the student view."
                : "Every rendered question, answer, and solution in one reading view."}
            </p>
          </div>
          <div className={styles.headerActions}>
            <button
              className={`secondary-inline-button ${styles.proofToggle}`}
              onClick={() => setMode(mode === "edit" ? "proof" : "edit")}
              type="button"
            >
              {mode === "edit" ? "View all questions" : "Back to editor"}
            </button>
            <button
              aria-label="Close question review"
              autoFocus
              className="validated-modal-close"
              onClick={onClose}
              type="button"
            >
              ×
            </button>
          </div>
        </header>

        {mode === "proof" ? (
          <AllQuestionsProof groups={groups} />
        ) : (
          <div className={`validated-modal-body ${styles.body}`}>
            <aside
              aria-label="Validated questions"
              className="validated-question-nav"
            >
              {questions.map((item, index) => (
                <button
                  aria-current={index === selected ? "step" : undefined}
                  className={index === selected ? "active" : ""}
                  key={index}
                  onClick={() => selectQuestion(index)}
                  type="button"
                >
                  <span>{index + 1}</span>
                  <strong>{item.type.replaceAll("_", " ")}</strong>
                  <small>
                    {item.points} {item.points === 1 ? "point" : "points"} ·{" "}
                    {groups[index].length} version
                    {groups[index].length === 1 ? "" : "s"}
                  </small>
                </button>
              ))}
            </aside>

            <div className={styles.workspace}>
              {groups[selected].length > 1 && (
                <nav
                  aria-label={`Versions for question ${selected + 1}`}
                  className={styles.versionSwitcher}
                >
                  <span>Question version</span>
                  {groups[selected].map((_, index) => (
                    <button
                      aria-label={`Version ${index + 1}`}
                      aria-pressed={versionView === index}
                      className={
                        versionView === index ? styles.activeVersion : ""
                      }
                      key={index}
                      onClick={() => setVersionView(index)}
                      type="button"
                    >
                      V{index + 1}
                    </button>
                  ))}
                  <button
                    aria-pressed={versionView === "all"}
                    className={
                      versionView === "all" ? styles.activeVersion : ""
                    }
                    onClick={() => setVersionView("all")}
                    type="button"
                  >
                    All
                  </button>
                </nav>
              )}

              {versionView === "all" ? (
                <VersionComparison
                  questionNumber={selected + 1}
                  questions={groups[selected]}
                />
              ) : (
                <div className={styles.editorGrid}>
                  <section className="question-source-pane">
                    <div className="pane-heading">
                      <span>Editable source · Version {variant + 1}</span>
                      <small>LaTeX and answer key</small>
                    </div>
                    <label>
                      Prompt source (LaTeX)
                      <textarea
                        onChange={(event) =>
                          onUpdate(selected, variant, {
                            prompt: event.target.value,
                          })
                        }
                        rows={5}
                        value={question.prompt}
                      />
                    </label>
                    {question.options && (
                      <fieldset className="source-options">
                        <legend>Option source (LaTeX)</legend>
                        {question.options.map((option, index) => (
                          <label key={option.id}>
                            <span>{option.id}</span>
                            <input
                              onChange={(event) =>
                                updateOption(index, event.target.value)
                              }
                              value={option.text}
                            />
                          </label>
                        ))}
                      </fieldset>
                    )}
                    <div className="assessment-fields compact-fields">
                      <label>
                        Difficulty
                        <input
                          max="5"
                          min="1"
                          onChange={(event) =>
                            onUpdate(selected, variant, {
                              difficulty: Number(event.target.value),
                            })
                          }
                          type="number"
                          value={question.difficulty}
                        />
                      </label>
                      <label>
                        Points
                        <input
                          min="0.1"
                          onChange={(event) =>
                            onUpdate(selected, variant, {
                              points: Number(event.target.value),
                            })
                          }
                          step="0.1"
                          type="number"
                          value={question.points}
                        />
                      </label>
                      <label>
                        Correct answer
                        <input
                          onChange={(event) =>
                            onUpdate(selected, variant, {
                              correct_answer: event.target.value,
                            })
                          }
                          value={question.correct_answer}
                        />
                      </label>
                      {question.type === "numeric" && (
                        <label>
                          Numeric tolerance
                          <input
                            min="0"
                            onChange={(event) =>
                              onUpdate(selected, variant, {
                                numeric_tolerance: Number(event.target.value),
                              })
                            }
                            step="0.01"
                            type="number"
                            value={question.numeric_tolerance}
                          />
                        </label>
                      )}
                    </div>
                    <label>
                      Jaguar skills (comma-separated codes)
                      <input
                        onChange={(event) => updateSkills(event.target.value)}
                        value={question.skills
                          .map((skill) => skill.code)
                          .join(", ")}
                      />
                    </label>
                    <label>
                      Explanation / solution source (LaTeX)
                      <textarea
                        onChange={(event) =>
                          onUpdate(selected, variant, {
                            explanation: event.target.value || null,
                          })
                        }
                        rows={5}
                        value={question.explanation ?? ""}
                      />
                    </label>
                  </section>

                  <section className="student-question-preview">
                    <div className="pane-heading">
                      <span>Student presentation · Version {variant + 1}</span>
                      <small>Teacher-only answer key shown below</small>
                    </div>
                    <article>
                      <div className="question-number">
                        Question {selected + 1} · {question.points}{" "}
                        {question.points === 1 ? "point" : "points"}
                      </div>
                      <div className="question-prompt">
                        <MathText>
                          {question.prompt || "Add a question prompt."}
                        </MathText>
                      </div>
                      {question.type === "multiple_choice" ? (
                        <div className="answer-options">
                          {question.options?.map((option) => (
                            <div key={option.id}>
                              <b>{option.id}</b>
                              <MathText>{option.text}</MathText>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <label className="answer-text">
                          Your answer
                          <input
                            disabled
                            placeholder={
                              question.type === "numeric"
                                ? "Enter a number"
                                : "Type your answer"
                            }
                          />
                        </label>
                      )}
                      <div className="teacher-answer-preview">
                        <span>Correct answer</span>
                        <MathText>
                          {question.correct_answer || "Not set"}
                        </MathText>
                      </div>
                      {question.explanation && (
                        <div className="teacher-solution-preview">
                          <span>Solution</span>
                          <MathText>{question.explanation}</MathText>
                        </div>
                      )}
                    </article>
                  </section>
                </div>
              )}
            </div>
          </div>
        )}

        {mode === "edit" && (
          <footer className="validated-modal-footer">
            <span>
              Question {selected + 1} of {questions.length} ·{" "}
              {versionView === "all"
                ? `Comparing all ${groups[selected].length} versions`
                : `Version ${variant + 1} of ${groups[selected].length}`}
            </span>
            <div>
              <button
                className="secondary-inline-button"
                disabled={selected === 0}
                onClick={() => selectQuestion(selected - 1)}
                type="button"
              >
                ← Previous
              </button>
              <button
                className="teacher-button"
                disabled={selected === questions.length - 1}
                onClick={() => selectQuestion(selected + 1)}
                type="button"
              >
                Next question →
              </button>
            </div>
          </footer>
        )}
      </section>
    </div>
  );
}

function VersionComparison({
  questions,
  questionNumber,
}: {
  questions: ImportedQuestion[];
  questionNumber: number;
}) {
  const gridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${questions.length}, minmax(280px, 1fr))`,
  };

  return (
    <div className={styles.comparisonViewport}>
      <div className={styles.comparisonGrid} style={gridStyle}>
        {questions.map((question, versionIndex) => {
          const correctOption = question.options?.find(
            (option) => option.id === question.correct_answer,
          );

          return (
            <article className={styles.comparisonCard} key={versionIndex}>
              <header>
                <div>
                  <span>V{versionIndex + 1}</span>
                  <strong>Version {versionIndex + 1}</strong>
                </div>
                <small>
                  Q{questionNumber} · {question.points}{" "}
                  {question.points === 1 ? "point" : "points"}
                </small>
              </header>
              <div className={styles.comparisonPrompt}>
                <MathText>{question.prompt}</MathText>
              </div>
              {question.options && (
                <div className={styles.comparisonOptions}>
                  {question.options.map((option) => (
                    <div key={option.id}>
                      <b>{option.id}</b>
                      <MathText>{option.text}</MathText>
                    </div>
                  ))}
                </div>
              )}
              <div className={styles.comparisonKey}>
                <div>
                  <span>Answer</span>
                  <strong>
                    {correctOption && <b>{correctOption.id} · </b>}
                    <MathText>
                      {correctOption?.text ?? question.correct_answer}
                    </MathText>
                  </strong>
                </div>
                <div>
                  <span>Solution</span>
                  <p>
                    {question.explanation ? (
                      <MathText>{question.explanation}</MathText>
                    ) : (
                      "No solution provided."
                    )}
                  </p>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function AllQuestionsProof({ groups }: { groups: ImportedQuestion[][] }) {
  const versionCount = Math.max(...groups.map((group) => group.length));

  return (
    <div className={styles.proofViewport}>
      <div className={styles.proofDocument}>
        {Array.from({ length: versionCount }, (_, versionIndex) => (
          <section className={styles.proofVersion} key={versionIndex}>
            <header>
              <div>
                <p className="eyebrow">Teacher proof</p>
                <h3>Test version {versionIndex + 1}</h3>
              </div>
              <span>
                {groups.length} question{groups.length === 1 ? "" : "s"}
              </span>
            </header>

            <div className={styles.proofQuestionList}>
              {groups.map((group, questionIndex) => {
                const question = group[versionIndex];
                if (!question) return null;
                const correctOption = question.options?.find(
                  (option) => option.id === question.correct_answer,
                );

                return (
                  <article className={styles.proofQuestion} key={questionIndex}>
                    <div className={styles.proofQuestionHeading}>
                      <span>Question {questionIndex + 1}</span>
                      <small>
                        {question.points}{" "}
                        {question.points === 1 ? "point" : "points"}
                      </small>
                    </div>
                    <div className={styles.proofQuestionPrompt}>
                      <MathText>{question.prompt}</MathText>
                    </div>
                    {question.options && (
                      <div className={styles.proofOptions}>
                        {question.options.map((option) => (
                          <div key={option.id}>
                            <b>{option.id}</b>
                            <MathText>{option.text}</MathText>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className={styles.proofKey}>
                      <div>
                        <span>Answer</span>
                        <strong>
                          {correctOption && <b>{correctOption.id} · </b>}
                          <MathText>
                            {correctOption?.text ?? question.correct_answer}
                          </MathText>
                        </strong>
                      </div>
                      <div>
                        <span>Solution</span>
                        <p>
                          {question.explanation ? (
                            <MathText>{question.explanation}</MathText>
                          ) : (
                            "No solution provided."
                          )}
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
