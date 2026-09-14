import "server-only";

import { createClient } from "@/lib/supabase/server";

export type StudentNotificationKind =
  | "assessment_new"
  | "assessment_score_released"
  | "assessment_review_released"
  | "assessment_pdf_released"
  | "star_gained"
  | "skull_gained"
  | "homework_status"
  | "classwork_status"
  | "classwork_note";

export type StudentNotification = {
  id: string;
  kind: StudentNotificationKind;
  title: string;
  body: string;
  href: string;
  createdAt: string;
  readAt: string | null;
};

type NotificationRow = {
  id: string;
  kind: StudentNotificationKind;
  title: string;
  body: string;
  href: string;
  created_at: string;
  read_at: string | null;
};

export async function getStudentNotifications(limit = 24): Promise<{ notifications: StudentNotification[]; unreadCount: number }> {
  const supabase = await createClient();
  const [{ data, error }, { count, error: countError }] = await Promise.all([
    supabase.from("student_notifications").select("id, kind, title, body, href, created_at, read_at").order("created_at", { ascending: false }).limit(limit),
    supabase.from("student_notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  if (error) throw error;
  if (countError) throw countError;
  const rows = (data ?? []) as NotificationRow[];
  return {
    notifications: rows.map((row) => ({ id: row.id, kind: row.kind, title: row.title, body: row.body, href: row.href, createdAt: row.created_at, readAt: row.read_at })),
    unreadCount: count ?? 0,
  };
}
