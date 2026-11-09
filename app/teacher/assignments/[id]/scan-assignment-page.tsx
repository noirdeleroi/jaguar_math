import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import ScanMarkingWorkspace from "./marking/scan-marking-workspace";

export default async function ScanAssignmentPage({
  id,
  view,
  sheetId,
}: {
  id: string;
  view: "setup" | "grading";
  sheetId?: string;
}) {
  const teacher = await requireTeacher();
  const db = await createClient();
  const { data, error } = await db
    .from("assignments")
    .select("id,title,status,paper_scan_enabled,archived_at")
    .eq("id", id)
    .eq("created_by", teacher.id)
    .maybeSingle();
  if (error) throw new Error("Mixed Test could not be loaded.");
  if (!data?.paper_scan_enabled) notFound();
  if (sheetId) {
    if (!/^[a-f0-9-]{36}$/i.test(sheetId)) notFound();
    const { data: sheet } = await db
      .from("paper_scan_sheets")
      .select("id")
      .eq("id", sheetId)
      .eq("assignment_id", id)
      .maybeSingle();
    if (!sheet) notFound();
  }
  return (
    <main className="teacher-main assessment-page">
      <Link
        className="back-link"
        href={
          sheetId
            ? `/teacher/assignments/${id}/grading`
            : `/teacher/assignments/${id}`
        }
      >
        {sheetId ? "← All student grades" : "← Assessment & results"}
      </Link>
      <section className="page-heading">
        <div>
          <p className="eyebrow">
            Mixed Test · {view === "setup" ? "Print & upload" : "Grading"}
          </p>
          <h1>
            {view === "grading" && !sheetId
              ? "Grades & recognition"
              : data.title}
          </h1>
          <p>
            {view === "setup"
              ? "Print named packets, upload answer sheets, and let clear answers grade automatically."
              : sheetId
                ? "Every answer and its recognition confidence. Corrections update the grade when you save."
                : `${data.title} · See who is graded, who is awaiting a scan, and which papers need attention.`}
          </p>
        </div>
      </section>
      {data.status === "draft" ? (
        <section className="teacher-section">
          <h2>Publish to prepare your student sheets</h2>
          <p>
            Review your questions and classes, then publish to print and grade.
          </p>
          <Link className="teacher-button" href={`/teacher/assignments/${id}`}>
            Review & publish
          </Link>
        </section>
      ) : (
        <ScanMarkingWorkspace
          assignmentId={id}
          archived={Boolean(data.archived_at)}
          view={view}
          initialSheetId={sheetId}
        />
      )}
    </main>
  );
}
