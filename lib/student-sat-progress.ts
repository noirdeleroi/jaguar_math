import "server-only";
import { createClient } from "@/lib/supabase/server";
import { buildSatProgress, type SatEvidenceSource, type SatMappingSource, type SatProgress, type SatSkillSource } from "@/lib/sat-progress";

type SubmittedAttempt = { id: string; assignment_id: string };
type ScoreVisibleAssignment = { id: string; show_score_after_submit: boolean };
type ScoredResponse = { attempt_id: string; question_id: string; is_correct: boolean | null; points_awarded: number | null };
type AssignmentQuestion = { assignment_id: string; question_id: string; points: number };
type PrimarySkill = { question_id: string; skill_id: string; weight: number };

const chunk = <T,>(items: T[], size = 150) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

export async function getStudentSatProgress(studentId: string, options?: { assignmentCreatedBy?: string }): Promise<SatProgress> {
  const supabase = await createClient();
  const [{ data: skills, error: skillsError }, { data: mappings, error: mappingsError }, { data: attempts, error: attemptsError }] = await Promise.all([
    supabase.from("skills").select("id, code, name, sort_order").eq("active", true),
    supabase.from("skill_sat_mappings").select("skill_id, sat_domain, sat_skill, mapping_status").neq("mapping_status", "not_assessed").not("sat_domain", "is", null).not("sat_skill", "is", null),
    supabase.from("attempts").select("id, assignment_id").eq("student_id", studentId).eq("status", "submitted"),
  ]);
  if (skillsError) throw skillsError; if (mappingsError) throw mappingsError; if (attemptsError) throw attemptsError;
  const submittedAttempts = (attempts ?? []) as SubmittedAttempt[];
  if (!submittedAttempts.length) return buildSatProgress((skills ?? []) as SatSkillSource[], (mappings ?? []) as SatMappingSource[], []);

  const submittedAssignmentIds = [...new Set(submittedAttempts.map((attempt) => attempt.assignment_id))]; const assignmentResults = await Promise.all(chunk(submittedAssignmentIds).map((ids) => { let query = supabase.from("assignments").select("id, show_score_after_submit").in("id", ids); if (options?.assignmentCreatedBy) query = query.eq("created_by", options.assignmentCreatedBy); return query; }));
  const assignmentError = assignmentResults.find((result) => result.error)?.error; if (assignmentError) throw assignmentError;
  const scoreVisibleAssignmentIds = new Set((assignmentResults.flatMap((result) => result.data ?? []) as ScoreVisibleAssignment[]).filter((assignment) => assignment.show_score_after_submit).map((assignment) => assignment.id)); const attemptRows = submittedAttempts.filter((attempt) => scoreVisibleAssignmentIds.has(attempt.assignment_id));
  if (!attemptRows.length) return buildSatProgress((skills ?? []) as SatSkillSource[], (mappings ?? []) as SatMappingSource[], []);

  const attemptIds = attemptRows.map((attempt) => attempt.id); const assignmentIds = [...new Set(attemptRows.map((attempt) => attempt.assignment_id))];
  const [responseResults, compositionResults] = await Promise.all([
    Promise.all(chunk(attemptIds).map((ids) => supabase.from("responses").select("attempt_id, question_id, is_correct, points_awarded").in("attempt_id", ids).not("is_correct", "is", null))),
    Promise.all(chunk(assignmentIds).map((ids) => supabase.from("assignment_questions").select("assignment_id, question_id, points").in("assignment_id", ids))),
  ]);
  const responseError = responseResults.find((result) => result.error)?.error; const compositionError = compositionResults.find((result) => result.error)?.error;
  if (responseError) throw responseError; if (compositionError) throw compositionError;
  const responses = responseResults.flatMap((result) => result.data ?? []) as ScoredResponse[]; const composition = compositionResults.flatMap((result) => result.data ?? []) as AssignmentQuestion[];
  const questionIds = [...new Set(responses.map((response) => response.question_id))];
  if (!questionIds.length) return buildSatProgress((skills ?? []) as SatSkillSource[], (mappings ?? []) as SatMappingSource[], []);
  const skillResults = await Promise.all(chunk(questionIds).map((ids) => supabase.from("question_skills").select("question_id, skill_id, weight").eq("is_primary", true).in("question_id", ids)));
  const skillError = skillResults.find((result) => result.error)?.error; if (skillError) throw skillError;
  const assignmentByAttempt = new Map(attemptRows.map((attempt) => [attempt.id, attempt.assignment_id])); const pointsByAssignmentQuestion = new Map(composition.map((item) => [`${item.assignment_id}:${item.question_id}`, Number(item.points)])); const primaryByQuestion = new Map((skillResults.flatMap((result) => result.data ?? []) as PrimarySkill[]).map((item) => [item.question_id, item])); const evidence = new Map<string, SatEvidenceSource>(); const skillById = new Map(((skills ?? []) as SatSkillSource[]).map((skill) => [skill.id, skill.code]));
  for (const response of responses) {
    const primary = primaryByQuestion.get(response.question_id); const assignmentId = assignmentByAttempt.get(response.attempt_id); const points = assignmentId ? pointsByAssignmentQuestion.get(`${assignmentId}:${response.question_id}`) : undefined; const code = primary ? skillById.get(primary.skill_id) : undefined;
    if (!primary || !code || !points) continue;
    const weight = Number(primary.weight); const current = evidence.get(code) ?? { skillCode: code, attempted: 0, earned: 0, possible: 0 };
    evidence.set(code, { skillCode: code, attempted: current.attempted + 1, earned: current.earned + Number(response.points_awarded ?? 0) * weight, possible: current.possible + points * weight });
  }
  return buildSatProgress((skills ?? []) as SatSkillSource[], (mappings ?? []) as SatMappingSource[], [...evidence.values()]);
}
