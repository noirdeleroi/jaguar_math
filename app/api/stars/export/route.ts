import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth";
import { buildClassroomStarsWorkbook } from "@/lib/classroom-star-export";
import { loadClassroomStarState } from "@/lib/classroom-star-data";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const teacher = await requireTeacher();
    const supabase = await createClient();
    const { data: classes, error } = await supabase.from("classes").select("id").eq("teacher_id", teacher.id).order("grade_level").order("name");
    if (error) throw error;
    const states = (await Promise.all((classes ?? []).map((classroom) => loadClassroomStarState(classroom.id, teacher.id)))).filter((state) => state !== null);
    if (!states.length) return NextResponse.json({ error: "There are no classes to export." }, { status: 404 });
    const buffer = await buildClassroomStarsWorkbook(states);
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="Jaguar_Stars_Backup_${date}.xlsx"`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
  } catch (cause) {
    console.error("[classroom-stars] Excel export failed", cause instanceof Error ? cause.name : "server_error");
    return NextResponse.json({ error: "Jaguar could not create the Excel backup." }, { status: 500 });
  }
}
