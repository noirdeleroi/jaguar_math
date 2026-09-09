"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function TeacherAssignmentError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <main className="teacher-main assessment-page"><Link className="back-link" href="/teacher/assignments">← Assignments</Link><section className="empty-state"><span aria-hidden="true">!</span><h1>We couldn&apos;t load this assignment.</h1><p>The assignment has not been deleted. This can happen briefly when the app and database are updating.</p><button className="teacher-button" onClick={() => retry()} type="button">Try again <span aria-hidden="true">→</span></button></section></main>;
}
