import { NextResponse } from "next/server";
import { requireTeacher } from "@/lib/auth";
import { suppliedProjectTeams, validateProjectDocument } from "@/lib/business-poster-project";
import { loadProjectRoster, projectFromRow, type ProjectRow } from "@/lib/business-poster-project-data";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const teacher = await requireTeacher();
    const { id } = await context.params;
    const body = await request.json() as { weekLabel?: unknown; activityDate?: unknown; useSuppliedTeams?: unknown };
    if (typeof body.weekLabel !== "string" || !/^T[1-9]\d*$/.test(body.weekLabel) || typeof body.activityDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.activityDate) || Number.isNaN(Date.parse(`${body.activityDate}T12:00:00Z`))) return NextResponse.json({ error: "Choose a topic and activity date." }, { status: 400 });
    const roster = await loadProjectRoster(id, teacher.id);
    if (!roster) return NextResponse.json({ error: "That class is not available." }, { status: 404 });
    const document = (body.useSuppliedTeams === true ? suppliedProjectTeams(roster) : null) ?? { rubricVersion: 1, teams: [], individualScores: {} };
    validateProjectDocument(document, new Set(roster.map((student) => student.id)));
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_business_poster_project", { p_class_id: id, p_week_label: body.weekLabel, p_activity_date: body.activityDate, p_document: document });
    if (error) throw error;
    return NextResponse.json({ project: projectFromRow(data as ProjectRow) }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("[business-poster] create failed", typeof cause === "object" && cause && "code" in cause ? String(cause.code) : "server_error");
    return NextResponse.json({ error: "The project could not be created. Refresh the class and try again." }, { status: 503 });
  }
}
