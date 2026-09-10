import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth";
import { importPayload, previewClassroomWorkbook } from "@/lib/classroom-star-import";
import { loadStudentMatchCandidates } from "@/lib/classroom-star-data";
import { createClient } from "@/lib/supabase/server";

const maximumWorkbookBytes = 12 * 1024 * 1024;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const teacher = await requireTeacher();
    const { id } = await context.params;
    const formData = await request.formData();
    const mode = formData.get("mode") === "import" ? "import" : "preview";
    const file = formData.get("workbook");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx")) return NextResponse.json({ error: "Choose an .xlsx workbook." }, { status: 400 });
    if (file.size <= 0 || file.size > maximumWorkbookBytes) return NextResponse.json({ error: "The workbook must be smaller than 12 MB." }, { status: 400 });

    const matching = await loadStudentMatchCandidates(id, teacher.id);
    if (!matching) return NextResponse.json({ error: "That class is not available." }, { status: 404 });
    const preview = await previewClassroomWorkbook(Buffer.from(await file.arrayBuffer()), file.name, matching.classroomName, matching.candidates);
    const matched = preview.matches.filter((row) => row.outcome === "matched").length;
    const ambiguous = preview.matches.filter((row) => row.outcome === "ambiguous").length;
    const excelOnly = preview.matches.filter((row) => row.outcome === "excel_only").length;
    const publicPreview = {
      fileName: preview.fileName,
      sheetName: preview.sheetName,
      counts: { excelStudents: preview.matches.length, matched, ambiguous, excelOnly, jaguarOnly: preview.missingFromWorkbook.length, weeks: preview.weeks.length, workItems: preview.workItems.length },
      matches: preview.matches,
      missingFromWorkbook: preview.missingFromWorkbook,
    };
    if (mode === "preview") return NextResponse.json({ ok: true, preview: publicPreview }, { headers: { "Cache-Control": "no-store" } });
    if (!matched) return NextResponse.json({ error: "No Excel rows could be matched safely to existing students. Nothing was imported.", preview: publicPreview }, { status: 400 });

    const payload = importPayload(preview);
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("import_classroom_star_workbook", {
      p_class_id: id,
      p_file_name: preview.fileName,
      p_file_sha256: preview.fileSha256,
      p_weeks: payload.weeks,
      p_star_totals: payload.starTotals,
      p_work_items: payload.workItems,
      p_work_statuses: payload.workStatuses,
      p_report: { matched, ambiguous, excel_only: excelOnly, jaguar_only: preview.missingFromWorkbook.length, sheet_name: preview.sheetName },
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, imported: data, preview: publicPreview }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const safeWorkbookError = cause instanceof Error && (cause.message.startsWith("No worksheet safely matches") || cause.message.startsWith("The worksheet contains duplicate Student Name rows"));
    const message = safeWorkbookError ? cause.message : "Jaguar could not read or import that workbook. Nothing was changed.";
    console.error("[classroom-stars] workbook import failed", cause instanceof Error ? cause.name : "server_error");
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
