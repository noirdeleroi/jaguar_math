export type ClassroomWeek = {
  id: string;
  label: string;
  sortOrder: number;
  title: string | null;
  focus: string | null;
  isCurrent: boolean;
  finalGradeFormula: string;
  finalGradeMax: number;
  summativeGradeColumnId: string | null;
};

export type ClassroomStudent = {
  id: string;
  fullName: string;
  nickname: string;
  email: string | null;
  totals: Record<string, number>;
  skulls: Record<string, { today: number; total: number }>;
};

export type GradebookRosterStudent = {
  gradebookCode: string;
  gradebookName: string;
  sortOrder: number;
  studentId: string | null;
};

export type WorkKind = "homework" | "classwork";
export type WorkStatus = "ok" | "not_ok" | "late";

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
  gradebookRoster: GradebookRosterStudent[];
  weeks: ClassroomWeek[];
  students: ClassroomStudent[];
  workItems: ClassroomWorkItem[];
  eventIds: string[];
  skullEventIds: string[];
};

export type ClassroomGrade = {
  attemptId: string | null;
  score: number;
  maxScore: number;
  percent: number;
};

export type ClassroomGradeColumn = {
  id: string;
  weekLabel: string;
  title: string;
  assessmentDate: string;
  source: "assessment" | "manual";
  assignmentId: string | null;
  maxScore: number | null;
  average: number | null;
  scores: Record<string, ClassroomGrade>;
};

export type AvailableClassroomAssessment = {
  id: string;
  title: string;
  kind: string;
  status: "published" | "closed";
  dueAt: string | null;
};

export type ClassroomAssignmentResult = {
  attemptId: string | null;
  status: "not_started" | "in_progress" | "submitted";
  score: number | null;
  maxScore: number | null;
  percentage: number | null;
};

export type ClassroomHomeworkAssignment = {
  id: string;
  title: string;
  status: "published" | "closed";
  dueAt: string | null;
  weekLabel: string;
  results: Record<string, ClassroomAssignmentResult>;
};

export type ClassroomCwRecord = {
  id: string;
  studentId: string;
  weekLabel: string;
  recordDate: string;
  reason: string;
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

export type QueuedSkullEvent = {
  id: string;
  student_id: string;
  week_label: string;
  action: "add" | "clear_today";
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
  skullEvents: QueuedSkullEvent[];
  workItems: QueuedWorkItem[];
  workStatuses: QueuedWorkStatus[];
};
