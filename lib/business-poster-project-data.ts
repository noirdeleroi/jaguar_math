import "server-only";
import { createClient } from "@/lib/supabase/server";
import { loadStudentMatchCandidates } from "@/lib/classroom-star-data";
import type { BusinessPosterProject, ProjectDocument, ProjectRosterStudent } from "@/lib/business-poster-project";

export type ProjectRow = { work_item_id: string; column_id: string; revision: number; document: ProjectDocument };
export function projectFromRow(row: ProjectRow): BusinessPosterProject {
  return { workItemId: row.work_item_id, columnId: row.column_id, revision: row.revision, document: row.document };
}
export async function loadClassroomProjects(classId: string): Promise<BusinessPosterProject[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("classroom_projects").select("work_item_id, column_id, revision, document").eq("class_id", classId);
  if (error) throw error;
  return ((data ?? []) as ProjectRow[]).map(projectFromRow);
}
export async function loadProjectRoster(classId: string, teacherId: string): Promise<ProjectRosterStudent[] | null> {
  const result = await loadStudentMatchCandidates(classId, teacherId);
  return result?.candidates.map((student) => ({ id: student.id, aliases: student.aliases, fullName: student.aliases.filter((alias) => alias.includes(" ")).sort((a, b) => b.length - a.length)[0] || student.fullName })) ?? null;
}
