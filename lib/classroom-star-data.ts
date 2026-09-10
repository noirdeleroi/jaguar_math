import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ClassroomStarState, ClassroomWorkItem, WorkStatus } from "@/lib/classroom-stars";
import type { StudentMatchCandidate } from "@/lib/classroom-star-import";

export async function loadClassroomStarState(classId: string, teacherId: string): Promise<ClassroomStarState | null> {
  const supabase = await createClient();
  const { data: classroom, error: classroomError } = await supabase.from("classes").select("id, name, grade_level, academic_year, teacher_id").eq("id", classId).eq("teacher_id", teacherId).maybeSingle();
  if (classroomError) throw classroomError;
  if (!classroom) return null;

  const [{ data: memberships, error: membershipError }, { data: weeks, error: weekError }, { data: events, error: eventError }, { data: workItems, error: workItemError }] = await Promise.all([
    supabase.from("class_members").select("student_id").eq("class_id", classId),
    supabase.from("classroom_weeks").select("id, label, sort_order, title, focus").eq("class_id", classId).order("sort_order"),
    supabase.from("classroom_star_events").select("id, student_id, delta, classroom_weeks!inner(label)").eq("class_id", classId),
    supabase.from("classroom_work_items").select("id, kind, position, title, activity_date, classroom_weeks!inner(label)").eq("class_id", classId).order("position"),
  ]);
  const firstError = membershipError ?? weekError ?? eventError ?? workItemError;
  if (firstError) throw firstError;

  const studentIds = (memberships ?? []).map((membership) => membership.student_id);
  const workItemIds = (workItems ?? []).map((item) => item.id);
  const [{ data: profiles, error: profileError }, { data: statuses, error: statusError }] = await Promise.all([
    studentIds.length ? supabase.from("profiles").select("id, full_name, email").in("id", studentIds).eq("role", "student").order("full_name") : Promise.resolve({ data: [], error: null }),
    workItemIds.length ? supabase.from("classroom_work_statuses").select("work_item_id, student_id, status").in("work_item_id", workItemIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (profileError || statusError) throw profileError ?? statusError;

  const totals = new Map<string, Record<string, number>>();
  for (const event of events ?? []) {
    const relation = Array.isArray(event.classroom_weeks) ? event.classroom_weeks[0] : event.classroom_weeks;
    const weekLabel = relation?.label;
    if (!weekLabel) continue;
    const byWeek = totals.get(event.student_id) ?? {};
    byWeek[weekLabel] = (byWeek[weekLabel] ?? 0) + Number(event.delta);
    totals.set(event.student_id, byWeek);
  }

  const statusesByItem = new Map<string, Record<string, WorkStatus>>();
  for (const status of statuses ?? []) {
    const values = statusesByItem.get(status.work_item_id) ?? {};
    values[status.student_id] = status.status as WorkStatus;
    statusesByItem.set(status.work_item_id, values);
  }

  return {
    classroom: { id: classroom.id, name: classroom.name, gradeLevel: classroom.grade_level, academicYear: classroom.academic_year },
    weeks: (weeks ?? []).map((week) => ({ id: week.id, label: week.label, sortOrder: week.sort_order, title: week.title, focus: week.focus })),
    students: (profiles ?? []).map((profile) => ({ id: profile.id, fullName: profile.full_name || profile.email || "Unnamed student", email: profile.email, totals: totals.get(profile.id) ?? {} })),
    workItems: (workItems ?? []).map((item): ClassroomWorkItem => {
      const relation = Array.isArray(item.classroom_weeks) ? item.classroom_weeks[0] : item.classroom_weeks;
      return { id: item.id, weekLabel: relation?.label ?? "", kind: item.kind as ClassroomWorkItem["kind"], position: item.position, title: item.title, activityDate: item.activity_date, statuses: statusesByItem.get(item.id) ?? {} };
    }).filter((item) => item.weekLabel),
    eventIds: (events ?? []).map((event) => event.id),
  };
}

export async function loadStudentMatchCandidates(classId: string, teacherId: string): Promise<{ classroomName: string; candidates: StudentMatchCandidate[] } | null> {
  const admin = createAdminClient();
  const { data: classroom, error: classroomError } = await admin.from("classes").select("id, name").eq("id", classId).eq("teacher_id", teacherId).maybeSingle();
  if (classroomError) throw classroomError;
  if (!classroom) return null;
  const { data: memberships, error: membershipError } = await admin.from("class_members").select("student_id").eq("class_id", classId);
  if (membershipError) throw membershipError;
  const studentIds = (memberships ?? []).map((membership) => membership.student_id);
  if (!studentIds.length) return { classroomName: classroom.name, candidates: [] };
  const [{ data: profiles, error: profileError }, { data: googleProfiles, error: googleError }] = await Promise.all([
    admin.from("profiles").select("id, full_name, email").in("id", studentIds).eq("role", "student"),
    admin.from("google_classroom_students").select("student_id, google_full_name, normalized_email").in("student_id", studentIds),
  ]);
  if (profileError || googleError) throw profileError ?? googleError;
  const googleByStudentId = new Map((googleProfiles ?? []).map((profile) => [profile.student_id, profile]));
  return {
    classroomName: classroom.name,
    candidates: (profiles ?? []).map((profile) => {
      const google = googleByStudentId.get(profile.id);
      const aliases = [profile.full_name, google?.google_full_name, profile.email?.split("@")[0], google?.normalized_email?.split("@")[0]].filter((value): value is string => Boolean(value));
      return { id: profile.id, fullName: profile.full_name || profile.email || "Unnamed student", email: profile.email, aliases: [...new Set(aliases)] };
    }),
  };
}
