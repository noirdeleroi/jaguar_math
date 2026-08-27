import AssignmentBuilder from "../assignment-builder";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type PageProps = { searchParams: Promise<{ error?: string }> };
export default async function NewAssignmentPage({ searchParams }: PageProps) {
  const teacher = await requireTeacher(); const messages = await searchParams; const supabase = await createClient(); const { data: classes } = await supabase.from("classes").select("id, name, grade_level, academic_year").eq("teacher_id", teacher.id).order("grade_level").order("name");
  return <>{messages.error && <p className="notice notice-error global-notice" role="alert">{messages.error}</p>}<AssignmentBuilder classes={classes ?? []} /></>;
}
