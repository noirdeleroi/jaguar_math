"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function StudentAssignmentError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <main className="student-page"><div className="student-container"><Link className="back-link" href="/student/assessments">← Your assignments</Link><section className="student-results"><p className="eyebrow">Temporary loading problem</p><h1>We couldn&apos;t load this assignment.</h1><p>Your assignment and saved work have not been deleted. Try again after the page and database finish updating.</p><button className="teacher-button" onClick={() => retry()} type="button">Try again <span aria-hidden="true">→</span></button></section></div></main>;
}
