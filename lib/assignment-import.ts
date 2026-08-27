import skillsData from "@/data/skills.json";

const skillCodes = new Set(skillsData.skills.map((skill) => skill.code));
const questionTypes = new Set(["multiple_choice", "numeric", "short_text"]);
const icfesCompetencies = new Set(["INTERPRETACION_REPRESENTACION", "FORMULACION_EJECUCION", "ARGUMENTACION"]);

export type ImportedOption = { id: string; text: string };
export type ImportedSkill = { code: string; weight: number; is_primary: boolean };
export type ImportedQuestion = {
  prompt: string;
  type: "multiple_choice" | "numeric" | "short_text";
  options: ImportedOption[] | null;
  correct_answer: string;
  numeric_tolerance: number;
  explanation: string | null;
  difficulty: number;
  points: number;
  skills: ImportedSkill[];
  icfes_competency: string | null;
};
export type ImportedAssessment = { questions: ImportedQuestion[] };
export type ValidationResult = { data?: ImportedAssessment; errors: string[] };

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function number(value: unknown, fallback: number) { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }

export function validateAssignmentImport(value: unknown): ValidationResult {
  const root = record(value); const errors: string[] = [];
  if (!root || !Array.isArray(root.questions) || root.questions.length === 0) return { errors: ["The JSON must contain a non-empty questions array."] };
  const questions: ImportedQuestion[] = [];
  root.questions.forEach((rawQuestion, index) => {
    const label = `Question ${index + 1}`; const question = record(rawQuestion);
    if (!question) { errors.push(`${label} must be an object.`); return; }
    const type = text(question.type); const prompt = text(question.prompt); const correctAnswer = text(question.correct_answer);
    if (!questionTypes.has(type)) errors.push(`${label} has an unsupported type.`);
    if (!prompt) errors.push(`${label} needs a prompt.`);
    if (!correctAnswer) errors.push(`${label} needs correct_answer.`);
    const difficulty = number(question.difficulty, 3); const points = number(question.points, 1); const tolerance = number(question.numeric_tolerance, 0);
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) errors.push(`${label} difficulty must be an integer from 1 to 5.`);
    if (points <= 0) errors.push(`${label} points must be greater than zero.`);
    if (tolerance < 0) errors.push(`${label} numeric_tolerance cannot be negative.`);
    const rawSkills = question.skills;
    if (!Array.isArray(rawSkills) || rawSkills.length === 0) errors.push(`${label} needs at least one skill.`);
    const skills: ImportedSkill[] = Array.isArray(rawSkills) ? rawSkills.map((rawSkill, skillIndex) => {
      const skill = record(rawSkill); const code = text(skill?.code); const weight = number(skill?.weight, 1); const isPrimary = skill?.is_primary === true || skill?.primary === true;
      if (!code || !skillCodes.has(code)) errors.push(`${label} skill ${skillIndex + 1} must use a valid Jaguar Math skill code.`);
      if (weight <= 0) errors.push(`${label} skill ${skillIndex + 1} weight must be greater than zero.`);
      return { code, weight, is_primary: isPrimary };
    }) : [];
    if (new Set(skills.map((skill) => skill.code)).size !== skills.length) errors.push(`${label} cannot repeat a skill.`);
    if (skills.length && skills.filter((skill) => skill.is_primary).length !== 1) errors.push(`${label} must have exactly one primary skill.`);
    const competency = text(question.icfes_competency);
    if (competency && !icfesCompetencies.has(competency)) errors.push(`${label} has an invalid ICFES competency.`);
    let options: ImportedOption[] | null = null;
    if (type === "multiple_choice") {
      if (!Array.isArray(question.options) || question.options.length < 2) errors.push(`${label} needs at least two options.`);
      options = Array.isArray(question.options) ? question.options.map((rawOption, optionIndex) => {
        const option = record(rawOption); const id = text(option?.id); const optionText = text(option?.text);
        if (!id || !optionText) errors.push(`${label} option ${optionIndex + 1} needs id and text.`);
        return { id, text: optionText };
      }) : [];
      if (options && new Set(options.map((option) => option.id)).size !== options.length) errors.push(`${label} option ids must be unique.`);
      if (options && !options.some((option) => option.id === correctAnswer)) errors.push(`${label} correct_answer must match an option id.`);
    } else if (question.options !== undefined && question.options !== null) errors.push(`${label} options are only valid for multiple_choice.`);
    questions.push({ prompt, type: type as ImportedQuestion["type"], options, correct_answer: correctAnswer, numeric_tolerance: tolerance, explanation: text(question.explanation) || null, difficulty, points, skills, icfes_competency: competency || null });
  });
  return errors.length ? { errors } : { data: { questions }, errors: [] };
}

export function parseAssignmentImport(source: string): ValidationResult {
  try { return validateAssignmentImport(JSON.parse(source)); } catch { return { errors: ["The import is not valid JSON."] }; }
}

export const assignmentImportExample = JSON.stringify({ questions: [{ prompt: "Solve $2x + 3 = 11$.", type: "multiple_choice", options: [{ id: "A", text: "$x = 3$" }, { id: "B", text: "$x = 4$" }, { id: "C", text: "$x = 5$" }], correct_answer: "B", difficulty: 2, points: 1, skills: [{ code: "ALG.LINEAR_EQ_1VAR", primary: true }], icfes_competency: "FORMULACION_EJECUCION", explanation: "Subtract 3, then divide by 2." }] }, null, 2);
