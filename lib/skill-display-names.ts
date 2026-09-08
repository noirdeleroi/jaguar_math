import skillsData from "@/data/skills.json";

type TaxonomySkill = { code: string; name: string };

export const SKILL_DISPLAY_NAMES = Object.fromEntries((skillsData.skills as TaxonomySkill[]).map((skill) => [skill.code, skill.name])) as Record<string, string>;

export function skillDisplayName(code: string) {
  return SKILL_DISPLAY_NAMES[code] ?? code;
}

export function teacherSkillDisplayName(code: string) {
  return `${code} — ${skillDisplayName(code)}`;
}
