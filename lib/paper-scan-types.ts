import type { BubbleReading, ScanQuestion } from "./paper-scan-layout";
export type SheetRow = {
  id: string;
  assignment_id: string;
  student_id: string;
  class_id: string;
  student_name: string;
  student_code: string;
  class_name: string;
  version: number;
  questions: ScanQuestion[];
  attempt_id: string | null;
  token: string;
};
export type BatchRow = {
  id: string;
  file_name: string;
  status: "uploading" | "ready" | "processing" | "complete" | "failed";
  page_count: number | null;
  next_page: number;
  error: string | null;
  duplicate_uploads: number;
  lease_until: string | null;
};
export type PageRow = {
  id: string;
  batch_id: string;
  source_page: number;
  sheet_id: string | null;
  sheet_page: number | null;
  status: "review" | "accepted" | "unidentified" | "rejected" | "duplicate";
  readings: BubbleReading[];
  decisions: BubbleReading[] | null;
  problem: string | null;
  normalized_path: string | null;
  algorithm?: string;
  revision: number;
};
export type ScanWorkspace = {
  sheets: SheetRow[];
  batches: BatchRow[];
  pages: PageRow[];
  grades: {
    id: string;
    score: number | null;
    max_score: number | null;
    status: string;
  }[];
  keys: Record<string, string>;
  audit: {
    id: number;
    page_id: string | null;
    sheet_id: string | null;
    event: string;
    created_at: string;
    detail: Record<string, unknown>;
  }[];
};
