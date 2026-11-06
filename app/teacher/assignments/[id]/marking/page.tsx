import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import ScanMarkingWorkspace from "./scan-marking-workspace";

export default async function MarkingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const teacher = await requireTeacher();
  const { id } = await params;
  const db = await createClient();
  const { data, error } = await db
    .from("assignments")
    .select("id,title,status,paper_scan_enabled,archived_at")
    .eq("id", id)
    .eq("created_by", teacher.id)
    .maybeSingle();
  if (error) throw new Error("Mixed Test could not be loaded.");
  if (!data?.paper_scan_enabled) notFound();
  return (
    <main className="teacher-main assessment-page">
      <Link className="back-link" href={`/teacher/assignments/${id}`}>
        ← Assessment & results
      </Link>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Mixed Test · Paper marking</p>
          <h1>{data.title}</h1>
          <p>
            Print, scan, and grade at your pace. Only finalized papers enter the
            class gradebook.
          </p>
        </div>
      </section>
      {data.status === "draft" ? (
        <section className="teacher-section">
          <h2>Publish to prepare your student sheets</h2>
          <p>
            Your questions and classes remain editable in the draft. Publishing
            locks the paper versions and creates pending gradebook entries.
          </p>
          <Link className="teacher-button" href={`/teacher/assignments/${id}`}>
            Review & publish
          </Link>
        </section>
      ) : (
        <ScanMarkingWorkspace
          assignmentId={id}
          archived={Boolean(data.archived_at)}
        />
      )}
    </main>
  );
}
