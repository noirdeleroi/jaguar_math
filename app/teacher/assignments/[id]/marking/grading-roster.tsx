"use client";
import Link from "next/link";
import { useState } from "react";
import type { ScanWorkspace, SheetRow } from "@/lib/paper-scan-types";
import { averageConfidence } from "@/lib/paper-scan-confidence";
import styles from "./scan-marking.module.css";

export function GradingRoster({
  data,
  assignmentId,
  classId,
  setClassId,
  filter,
  setFilter,
}: {
  data: ScanWorkspace;
  assignmentId: string;
  classId: string;
  setClassId: (value: string) => void;
  filter: string;
  setFilter: (value: "all" | "pending" | "graded" | "review") => void;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("name");
  const rows = data.sheets
    .map((sheet: SheetRow) => {
      const pages = data.pages.filter(
        (p) =>
          p.sheet_id === sheet.id && ["accepted", "review"].includes(p.status),
      );
      const grade = data.grades.find(
        (g) => g.id === sheet.attempt_id && g.status === "submitted",
      );
      const status = grade
        ? "graded"
        : pages.some((p) => p.status === "review")
          ? "review"
          : "pending";
      const confidence = averageConfidence(pages.flatMap((p) => p.readings));
      return { sheet, pages, grade, status, confidence };
    })
    .filter(
      ({ sheet, status }) =>
        (!classId || sheet.class_id === classId) &&
        (filter === "all" || status === filter) &&
        `${sheet.student_name} ${sheet.student_code} ${sheet.class_name}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()),
    )
    .sort((a, b) => {
      if (sort === "confidence" && a.confidence !== b.confidence)
        return (a.confidence ?? 101) - (b.confidence ?? 101);
      if (sort === "status" && a.status !== b.status)
        return (
          { review: 0, pending: 1, graded: 2 }[a.status as "review"] -
          { review: 0, pending: 1, graded: 2 }[b.status as "review"]
        );
      return (
        a.sheet.class_name.localeCompare(b.sheet.class_name) ||
        a.sheet.student_name.localeCompare(b.sheet.student_name)
      );
    });
  const classes = [
    ...new Map(data.sheets.map((s) => [s.class_id, s.class_name])).entries(),
  ];
  return (
    <section className="teacher-section" aria-label="Student grading dashboard">
      <div className="section-row">
        <div>
          <h2>Student grades</h2>
          <p>
            Grades save automatically after a readable scan. Open any paper to
            inspect every answer or make a correction.
          </p>
        </div>
        <Link
          className="secondary-inline-button"
          href={`/teacher/assignments/${assignmentId}/marking`}
        >
          Upload more scans
        </Link>
      </div>
      <div className={styles.rosterFilters}>
        <label>
          Find a student
          <input
            type="search"
            placeholder="Name, class or student ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          Class
          <select value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">All classes</option>
            {classes.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={filter}
            onChange={(e) =>
              setFilter(
                e.target.value as "all" | "pending" | "graded" | "review",
              )
            }
          >
            <option value="all">All students</option>
            <option value="graded">Graded</option>
            <option value="pending">Awaiting scans</option>
            <option value="review">Needs attention</option>
          </select>
        </label>
        <label>
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="name">Class & name</option>
            <option value="status">Needs attention first</option>
            <option value="confidence">Lowest confidence first</option>
          </select>
        </label>
      </div>
      <div className={styles.resultTableScroll}>
        <table className={`${styles.resultTable} ${styles.rosterTable}`}>
          <thead>
            <tr>
              <th>Student</th>
              <th>Class</th>
              <th>Status</th>
              <th>Score</th>
              <th>Recognition confidence</th>
              <th>Paper</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ sheet, pages, grade, status, confidence }) => (
              <tr key={sheet.id}>
                <th scope="row">
                  {sheet.student_name}
                  <small>ID {sheet.student_code}</small>
                </th>
                <td>{sheet.class_name}</td>
                <td>
                  <span className={styles[status]}>
                    {grade
                      ? "Graded"
                      : status === "review"
                        ? "Needs attention"
                        : pages.length
                          ? "Partial scan"
                          : "Not scanned"}
                  </span>
                  <small>
                    {pages.length}/{Math.ceil(sheet.questions.length / 60)}{" "}
                    pages received
                  </small>
                </td>
                <td>
                  <strong>
                    {grade ? `${grade.score} / ${grade.max_score}` : "—"}
                  </strong>
                  {grade && (
                    <small>
                      {Math.round(
                        (Number(grade.score) / Number(grade.max_score)) * 100,
                      )}
                      %
                    </small>
                  )}
                </td>
                <td>
                  {confidence === null ? (
                    "—"
                  ) : (
                    <>
                      <strong>{confidence}%</strong>
                      <small>
                        {confidence >= 85 ? "Clear marks" : "Worth a look"}
                      </small>
                    </>
                  )}
                </td>
                <td>
                  <Link
                    className="secondary-inline-button"
                    prefetch={false}
                    href={`/teacher/assignments/${assignmentId}/grading/${sheet.id}`}
                  >
                    {pages.length ? "View / edit answers" : "View paper"}
                  </Link>
                  <div className={styles.actions}>
                    <a
                      className={styles.textLink}
                      href={`/api/assignments/${assignmentId}/papers.pdf?studentId=${sheet.student_id}`}
                    >
                      Student packet
                    </a>
                    <a
                      className={styles.textLink}
                      href={`/api/assignments/${assignmentId}/papers.pdf?kind=questions&studentId=${sheet.student_id}`}
                    >
                      Question paper
                    </a>
                    <a
                      className={styles.textLink}
                      href={`/api/assignments/${assignmentId}/answer-sheets.pdf?studentId=${sheet.student_id}`}
                    >
                      Answer sheet
                    </a>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p>No students match these filters.</p>}
      <small>
        Confidence estimates mark clarity; it is not a measured accuracy rate. A
        saved teacher correction always takes priority.
      </small>
    </section>
  );
}
