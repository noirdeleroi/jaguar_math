export type SatSkillSource = { id: string; code: string; name: string; sort_order: number };
export type SatMappingSource = { skill_id: string; sat_domain: string | null; sat_skill: string | null; mapping_status: string };
export type SatEvidenceSource = { skillCode: string; attempted: number; earned: number; possible: number };

type SatTopicDefinition = { name: string; mappingTopics: string[] };
type SatDomainDefinition = { code: string; name: string; weight: number; topics: SatTopicDefinition[] };

export const SAT_DOMAINS: SatDomainDefinition[] = [
  { code: "ALGEBRA", name: "Algebra", weight: 0.35, topics: [
    { name: "Linear equations in one variable", mappingTopics: ["Linear equations in one variable"] },
    { name: "Linear equations in two variables", mappingTopics: ["Linear equations in two variables"] },
    { name: "Linear functions", mappingTopics: ["Linear functions"] },
    { name: "Systems of two linear equations in two variables", mappingTopics: ["Systems of two linear equations in two variables"] },
    { name: "Linear inequalities in one or two variables", mappingTopics: ["Linear inequalities in one or two variables"] },
  ] },
  { code: "ADVANCED_MATH", name: "Advanced Math", weight: 0.35, topics: [
    { name: "Equivalent expressions", mappingTopics: ["Equivalent expressions"] },
    { name: "Nonlinear equations in one variable and systems of equations in two variables", mappingTopics: ["Nonlinear equations in one variable", "Systems of equations in two variables"] },
    { name: "Nonlinear functions", mappingTopics: ["Nonlinear functions"] },
  ] },
  { code: "PROBLEM_SOLVING_DATA_ANALYSIS", name: "Problem-Solving and Data Analysis", weight: 0.15, topics: [
    { name: "Ratios, rates, proportional relationships, and units", mappingTopics: ["Ratios, rates, proportional relationships, and units"] },
    { name: "Percentages", mappingTopics: ["Percentages"] },
    { name: "One-variable data: distributions and measures of center and spread", mappingTopics: ["One-variable data: Distributions and measures of center and spread"] },
    { name: "Two-variable data: models and scatterplots", mappingTopics: ["Two-variable data: Models and scatterplots"] },
    { name: "Probability and conditional probability", mappingTopics: ["Probability and conditional probability"] },
    { name: "Inference from sample statistics and margin of error", mappingTopics: ["Inference from sample statistics and margin of error"] },
    { name: "Evaluating statistical claims: observational studies and experiments", mappingTopics: ["Evaluating statistical claims: Observational studies and experiments"] },
  ] },
  { code: "GEOMETRY_TRIGONOMETRY", name: "Geometry and Trigonometry", weight: 0.15, topics: [
    { name: "Area and volume", mappingTopics: ["Area and volume"] },
    { name: "Lines, angles, and triangles", mappingTopics: ["Lines, angles, and triangles"] },
    { name: "Right triangles and trigonometry", mappingTopics: ["Right triangles and trigonometry"] },
    { name: "Circles", mappingTopics: ["Circles"] },
  ] },
];

export type SatSkillProgress = { code: string; name: string; readiness: number | null; attempted: number; earned: number; possible: number; evidenceLabel: "Not assessed" | "Low evidence" | "Some evidence" | "Strong evidence" };
export type SatTopicProgress = { name: string; readiness: number; assessedSkills: number; totalSkills: number; skills: SatSkillProgress[] };
export type SatDomainProgress = { code: string; name: string; weight: number; readiness: number; assessedSkills: number; totalSkills: number; topics: SatTopicProgress[] };
export type SatProgress = { readiness: number; assessedSkills: number; totalSkills: number; totalEvidence: number; domains: SatDomainProgress[] };

function evidenceLabel(attempted: number): SatSkillProgress["evidenceLabel"] {
  if (!attempted) return "Not assessed";
  if (attempted < 3) return "Low evidence";
  if (attempted < 6) return "Some evidence";
  return "Strong evidence";
}

export function buildSatProgress(skills: SatSkillSource[], mappings: SatMappingSource[], evidence: SatEvidenceSource[]): SatProgress {
  const skillById = new Map(skills.map((skill) => [skill.id, skill]));
  const evidenceByCode = new Map(evidence.map((item) => [item.skillCode, item]));
  const usableMappings = mappings.filter((mapping) => mapping.mapping_status !== "not_assessed" && mapping.sat_domain && mapping.sat_skill && skillById.has(mapping.skill_id));
  const mappedCodes = new Set(usableMappings.map((mapping) => skillById.get(mapping.skill_id)?.code).filter((code): code is string => Boolean(code)));
  const domains = SAT_DOMAINS.map((domain) => {
    const topics = domain.topics.map((topic) => {
      const topicSkills = [...new Map(usableMappings.filter((mapping) => mapping.sat_domain === domain.name && topic.mappingTopics.includes(mapping.sat_skill ?? "")).map((mapping) => {
        const skill = skillById.get(mapping.skill_id)!; return [skill.id, skill] as const;
      })).values()].sort((left, right) => left.sort_order - right.sort_order).map((skill): SatSkillProgress => {
        const record = evidenceByCode.get(skill.code); const possible = record?.possible ?? 0; const attempted = record?.attempted ?? 0;
        return { code: skill.code, name: skill.name, readiness: possible > 0 ? (record?.earned ?? 0) / possible * 100 : null, attempted, earned: record?.earned ?? 0, possible, evidenceLabel: evidenceLabel(attempted) };
      });
      const readiness = topicSkills.length ? topicSkills.reduce((sum, skill) => sum + (skill.readiness ?? 0), 0) / topicSkills.length : 0;
      return { name: topic.name, readiness, assessedSkills: topicSkills.filter((skill) => skill.attempted > 0).length, totalSkills: topicSkills.length, skills: topicSkills };
    });
    const domainSkills = new Map(topics.flatMap((topic) => topic.skills.map((skill) => [skill.code, skill] as const)));
    return { code: domain.code, name: domain.name, weight: domain.weight, readiness: topics.length ? topics.reduce((sum, topic) => sum + topic.readiness, 0) / topics.length : 0, assessedSkills: [...domainSkills.values()].filter((skill) => skill.attempted > 0).length, totalSkills: domainSkills.size, topics };
  });
  const totalSkills = mappedCodes.size; const assessedSkills = [...mappedCodes].filter((code) => (evidenceByCode.get(code)?.attempted ?? 0) > 0).length;
  const totalEvidence = [...mappedCodes].reduce((sum, code) => sum + (evidenceByCode.get(code)?.attempted ?? 0), 0);
  return { readiness: domains.reduce((sum, domain) => sum + domain.readiness * domain.weight, 0), assessedSkills, totalSkills, totalEvidence, domains };
}
