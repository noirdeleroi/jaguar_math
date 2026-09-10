export type ClassroomWeek = {
  id: string;
  label: string;
  sortOrder: number;
  title: string | null;
  focus: string | null;
};

export type ClassroomStudent = {
  id: string;
  fullName: string;
  email: string | null;
  totals: Record<string, number>;
};

export type WorkKind = "homework" | "classwork";
export type WorkStatus = "done" | "late" | "missing" | "ok" | "not_ok";

export type ClassroomWorkItem = {
  id: string;
  weekLabel: string;
  kind: WorkKind;
  position: number;
  title: string;
  activityDate: string | null;
  statuses: Record<string, WorkStatus>;
};

export type ClassroomStarState = {
  classroom: { id: string; name: string; gradeLevel: number; academicYear: string };
  weeks: ClassroomWeek[];
  students: ClassroomStudent[];
  workItems: ClassroomWorkItem[];
  eventIds: string[];
};

export type QueuedWeek = {
  id: string;
  label: string;
  sort_order: number;
  title?: string;
  focus?: string;
};

export type QueuedStarEvent = {
  id: string;
  student_id: string;
  week_label: string;
  delta: number;
  note?: string;
  source: "classroom" | "offline_queue";
  occurred_at: string;
};

export type QueuedWorkItem = {
  id: string;
  week_label: string;
  kind: WorkKind;
  position: number;
  title: string;
  activity_date?: string;
};

export type QueuedWorkStatus = {
  student_id: string;
  week_label: string;
  kind: WorkKind;
  position: number;
  status: WorkStatus | "";
};

export type ClassroomSyncPayload = {
  weeks: QueuedWeek[];
  starEvents: QueuedStarEvent[];
  workItems: QueuedWorkItem[];
  workStatuses: QueuedWorkStatus[];
};
