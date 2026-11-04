import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth";
import { validateProjectDocument } from "@/lib/business-poster-project";
import { loadProjectRoster, projectFromRow, type ProjectRow } from "@/lib/business-poster-project-data";
import { createClient } from "@/lib/supabase/server";

type Context = { params: Promise<{ id: string; workItemId: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const teacher = await requireTeacher();
    const { id, workItemId } = await context.params;
    const roster = await loadProjectRoster(id, teacher.id);
    if (!roster) return NextResponse.json({ error: "That class is not available." }, { status: 404 });
    const supabase = await createClient();
    const { data, error } = await supabase.from("classroom_projects").select("work_item_id, column_id, revision, document").eq("class_id", id).eq("work_item_id", workItemId).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "That project does not belong to this class." }, { status: 404 });
    return NextResponse.json({ project: projectFromRow(data as ProjectRow), roster }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[business-poster] load failed", typeof cause === "object" && cause && "code" in cause ? String(cause.code) : cause instanceof Error ? cause.name : "server_error");
    return NextResponse.json({ error: "The saved project could not be loaded." }, { status: 503 });
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const teacher = await requireTeacher();
    const { id, workItemId } = await context.params;
    const body = await request.json() as { revision?: unknown; document?: unknown };
    if (typeof body.revision !== "number" || !Number.isSafeInteger(body.revision) || body.revision < 0) return NextResponse.json({ error: "Invalid project revision." }, { status: 400 });
    const roster = await loadProjectRoster(id, teacher.id);
    if (!roster) return NextResponse.json({ error: "That class is not available." }, { status: 404 });
    try { validateProjectDocument(body.document, new Set(roster.map((student) => student.id))); }
    catch (cause) { return NextResponse.json({ error: cause instanceof Error ? cause.message : "Invalid project scores." }, { status: 400 }); }
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("save_business_poster_project", { p_class_id: id, p_work_item_id: workItemId, p_revision: body.revision, p_document: body.document });
    if (error?.code === "PT409" || error?.code === "40001") return NextResponse.json({ error: error.message }, { status: 409 });
    if (error?.code === "P0002" || error?.code === "42501") return NextResponse.json({ error: "That project does not belong to this class." }, { status: 404 });
    if (error) throw error;
    return NextResponse.json({ project: projectFromRow(data as ProjectRow) }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[business-poster] save failed", typeof cause === "object" && cause && "code" in cause ? String(cause.code) : cause instanceof Error ? cause.name : "server_error");
    return NextResponse.json({ error: "The grades could not be saved. Your changes are still open; try Save again." }, { status: 503 });
  }
}
