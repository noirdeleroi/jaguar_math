import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AssignmentResultsOverview } from "../../results-overview-client";

const uuid = (value: string | null) => Boolean(value && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value));
const csvCell = (value: string | number | null | undefined) => `"${String(value ?? "").replace(/"/g, '""')}"`;
const safeFilePart = (value: string) => value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, "_").replace(/^[_\.]+|[_\.]+$/g, "").slice(0, 80) || "assignment";
const statusLabel = (status: "submitted" | "in_progress" | "not_started") => status === "submitted" ? "Submitted" : status === "in_progress" ? "In progress" : "Not submitted";
const completion = (seconds: number | null) => seconds === null ? "" : `${Math.max(0, Math.round(Number(seconds) / 60))}m`;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "teacher") return new Response("Not found", { status: 404 });
  const { id: assignmentId } = await context.params;
  if (!uuid(assignmentId)) return new Response("Not found", { status: 404 });
  const url = new URL(request.url); const selectedClassId = url.searchParams.get("classId");
  if (selectedClassId && !uuid(selectedClassId)) return new Response("Not found", { status: 404 });

  const supabase = await createClient();
  const { data: assignment } = await supabase.from("assignments").select("id, title").eq("id", assignmentId).eq("created_by", profile.id).maybeSingle();
  if (!assignment) return new Response("Not found", { status: 404 });
  const { data: linkedClasses } = await supabase.from("assignment_classes").select("class_id, classes(id, name)").eq("assignment_id", assignmentId);
  const classes = (linkedClasses ?? []).flatMap((row) => { const classroom = Array.isArray(row.classes) ? row.classes[0] : row.classes; return classroom ? [{ id: classroom.id, name: classroom.name }] : []; });
  const classById = new Map(classes.map((classroom) => [classroom.id, classroom.name]));
  if (selectedClassId && !classById.has(selectedClassId)) return new Response("Not found", { status: 404 });
  const includedClassIds = selectedClassId ? [selectedClassId] : classes.map((classroom) => classroom.id);
  const [{ data: overviewData, error: overviewError }, { data: memberships }] = await Promise.all([
    supabase.rpc("get_assignment_results_overview", { p_assignment_id: assignmentId, p_class_id: selectedClassId ?? null }),
    includedClassIds.length ? supabase.from("class_members").select("student_id, class_id").in("class_id", includedClassIds) : Promise.resolve({ data: [] as { student_id: string; class_id: string }[] }),
  ]);
  if (overviewError || !overviewData) return new Response("Results are unavailable", { status: 500 });

  const classesByStudent = new Map<string, string[]>();
  for (const membership of memberships ?? []) {
    const className = classById.get(membership.class_id);
    if (className) classesByStudent.set(membership.student_id, [...(classesByStudent.get(membership.student_id) ?? []), className]);
  }
  const overview = overviewData as AssignmentResultsOverview;
  const header = ["Student Name", "Student Email", "Class", "Status", "Score Earned", "Score Possible", "Percentage", "Submitted At", "Completion Time"];
  const rows = overview.students.map((student) => {
    const submitted = student.status === "submitted";
    return [student.student_name, student.email, (classesByStudent.get(student.student_id) ?? []).sort().join("; "), statusLabel(student.status), submitted ? student.score : "", submitted ? student.max_score : "", submitted && student.percentage !== null ? `${Number(student.percentage).toFixed(2)}%` : "", submitted && student.submitted_at ? new Date(student.submitted_at).toISOString() : "", submitted ? completion(student.completion_seconds) : ""];
  });
  const body = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const classPart = selectedClassId ? `_${safeFilePart(classById.get(selectedClassId) ?? "class")}` : "";
  const filename = `${safeFilePart(assignment.title)}${classPart}_results.csv`;
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" } });
}
