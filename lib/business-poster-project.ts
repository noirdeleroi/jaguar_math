import type { ClassroomGrade } from "./classroom-stars";

export const BUSINESS_POSTER_TITLE = "Business Poster Project";
export const BUSINESS_POSTER_RUBRIC = [
  { title: "Mathematical Correctness & Completeness", description: "All required mathematics is present and correct: arithmetic, algebra, linear equations, system, graph, inequality, interpretations, and conclusion. Full working is shown." },
  { title: "Mathematical Presentation", description: "Formulas are large and readable; notation is correct; variables and terms are defined; calculations are organized; graph axes, scale, lines, and intersection are clearly labeled." },
  { title: "Creativity & Poster Presentation", description: "Original business idea; hand-drawn poster shows visible effort; layout is clear and attractive; visuals support the mathematics; the business context is meaningful." },
  { title: "Questions & Mathematical Understanding", description: "Students answer teacher and classmate questions correctly and explain equations, graph, system, inequality, and reasoning without simply reading from the poster." },
  { title: "Participation & Engagement", description: "All four students should participate meaningfully in the presentation. Students listen to other groups, stay engaged, participate in discussion, and ask meaningful questions." },
] as const;

export type ProjectScore = number | null;
export type ProjectTeam = { id: string; name: string; scores: [ProjectScore, ProjectScore, ProjectScore]; members: { studentId: string | null; label: string }[] };
export type ProjectDocument = { rubricVersion: 1; teams: ProjectTeam[]; individualScores: Record<string, [ProjectScore, ProjectScore]> };
export type BusinessPosterProject = { workItemId: string; columnId: string; revision: number; document: ProjectDocument };
export type ProjectRosterStudent = { id: string; fullName: string; aliases: string[] };

export function sumProjectScores(scores: readonly ProjectScore[]): number | null {
  return scores.some((score) => score === null) ? null : Number(scores.reduce<number>((sum, score) => sum + (score ?? 0), 0).toPrecision(15));
}

export function projectGrades(document: ProjectDocument, rosterIds?: ReadonlySet<string>): Record<string, ClassroomGrade> {
  const grades: Record<string, ClassroomGrade> = {};
  for (const team of document.teams) for (const { studentId } of team.members) {
    if (!studentId || (rosterIds && !rosterIds.has(studentId))) continue;
    const score = sumProjectScores([...team.scores, ...(document.individualScores[studentId] ?? [null, null])]);
    if (score !== null) grades[studentId] = { attemptId: null, score, maxScore: 100, percent: Math.round(score) };
  }
  return grades;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function scoreArray(value: unknown, length: number): value is ProjectScore[] {
  return Array.isArray(value) && value.length === length && value.every((score) => score === null || (typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 20));
}

export function validateProjectDocument(value: unknown, rosterIds: ReadonlySet<string>): asserts value is ProjectDocument {
  if (!record(value) || value.rubricVersion !== 1 || !Array.isArray(value.teams) || value.teams.length > 50 || !record(value.individualScores)) throw new Error("Invalid project rubric.");
  const teamIds = new Set<string>();
  const students = new Set<string>();
  for (const team of value.teams) {
    if (!record(team) || typeof team.id !== "string" || !uuidPattern.test(team.id) || teamIds.has(team.id) || typeof team.name !== "string" || !team.name.trim() || team.name.length > 80 || !scoreArray(team.scores, 3) || !Array.isArray(team.members) || team.members.length > 100) throw new Error("Check team names, members, and scores (0–20).");
    teamIds.add(team.id);
    for (const member of team.members) {
      if (!record(member) || typeof member.label !== "string" || member.label.length > 160 || (member.studentId !== null && (typeof member.studentId !== "string" || !rosterIds.has(member.studentId)))) throw new Error("Choose students from this class roster.");
      if (typeof member.studentId === "string") {
        if (students.has(member.studentId)) throw new Error("A student can only belong to one team.");
        students.add(member.studentId);
      }
    }
  }
  for (const [id, scores] of Object.entries(value.individualScores)) if (!students.has(id) || !scoreArray(scores, 2)) throw new Error("Check individual scores (0–20) and team membership.");
}

const suppliedGroups = [
  ["Samantha Tirado", "Samuel Lopez", "Lorenzo Gonzalez", "Tomas Castaño"],
  ["Josue Rada", "Tyrique", "Samuel Burgos", "Martin Perez"],
  ["Santiago Giraldo", "Salomon Londoño", "Simon Diaz", "Andres Cabra"],
  ["Paulina Perez", "Santiago Escobar", "Juliana Jimenez", "Antonia Ruiz"],
  ["Luciana Duque", "Angelina Kruichack", "Mariana Lozada", "Gabriela Moreno"],
];
function tokens(name: string): string[] { return name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().match(/[a-z]+/g) ?? []; }

// Only exact, unique token matches are automatic. Spelling variations stay unresolved.
export function suppliedProjectTeams(roster: ProjectRosterStudent[]): ProjectDocument | null {
  let matched = 0;
  const used = new Set<string>();
  const teams = suppliedGroups.map((names, index): ProjectTeam => ({
    id: crypto.randomUUID(), name: `Group ${index + 1}`, scores: [null, null, null],
    members: names.map((label) => {
      const requested = tokens(label);
      const candidates = roster.filter((student) => student.aliases.some((alias) => { const available = tokens(alias); return requested.every((token) => available.includes(token)); }));
      const studentId = candidates.length === 1 && !used.has(candidates[0].id) ? candidates[0].id : null;
      if (studentId) { matched += 1; used.add(studentId); }
      return { studentId, label };
    }),
  }));
  // The supplied groups are offered only to the roster they overwhelmingly match.
  return matched >= 16 ? { rubricVersion: 1, teams, individualScores: {} } : null;
}

export function projectColumnGrades(project: BusinessPosterProject, rosterIds?: ReadonlySet<string>) {
  const scores = projectGrades(project.document, rosterIds);
  const percentages = Object.values(scores).map((grade) => grade.percent);
  return { scores, average: percentages.length ? Math.round(percentages.reduce((sum, score) => sum + score, 0) / percentages.length) : null };
}
