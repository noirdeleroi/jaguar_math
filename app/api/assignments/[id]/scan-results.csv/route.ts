import { scanWorkspace, ScanError } from "@/lib/paper-scan-server";
import { printedScanChoice, scanPaperLabel } from "@/lib/paper-scan-layout";
import { readingConfidence } from "@/lib/paper-scan-confidence";
function cell(value: unknown) {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+@\-\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const data = await scanWorkspace(id);
    const rows: unknown[][] = [
      [
        "Student ID",
        "Student",
        "Class",
        "Paper",
        "Paper status",
        "Score",
        "Maximum",
        "Percent",
        "Question",
        "Selected",
        "Correct answer",
        "Correct",
        "Points",
        "Scan page ID",
        "Decision",
        "Recognition confidence (estimated %)",
      ],
    ];
    for (const sheet of data.sheets) {
      const grade = data.grades.find(
        (g) => g.id === sheet.attempt_id && g.status === "submitted",
      );
      const pages = data.pages.filter(
        (p) =>
          p.sheet_id === sheet.id && ["accepted", "review"].includes(p.status),
      );
      const status = grade
        ? "graded"
        : pages.some((p) => p.status === "review")
          ? "needs review"
          : "pending";
      for (const q of sheet.questions) {
        const page = pages.find((p) =>
          (p.decisions ?? p.readings).some((r) => r.position === q.position),
        );
        const reading = (page?.decisions ?? page?.readings)?.find(
          (r) => r.position === q.position,
        );
        const answerKey = printedScanChoice(q, data.keys[q.questionId]);
        const correct = reading?.choice === answerKey;
        rows.push([
          sheet.student_code,
          sheet.student_name,
          sheet.class_name,
          scanPaperLabel(sheet),
          status,
          grade?.score,
          grade?.max_score,
          grade
            ? Math.round((Number(grade.score) / Number(grade.max_score)) * 100)
            : null,
          q.position,
          reading?.choice,
          answerKey,
          grade ? correct : null,
          grade ? (correct ? q.points : 0) : null,
          page?.id,
          reading?.status ?? "not scanned",
          readingConfidence(
            page?.readings.find((r) => r.position === q.position),
          ),
        ]);
      }
    }
    return new Response(
      "\ufeff" + rows.map((r) => r.map(cell).join(",")).join("\r\n"),
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition":
            'attachment; filename="mixed-test-detailed-results.csv"',
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof ScanError
            ? error.message
            : "Results could not be exported.",
      },
      { status: error instanceof ScanError ? error.status : 500 },
    );
  }
}
