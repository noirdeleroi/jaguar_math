import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const root = path.resolve(import.meta.dirname, "..");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, "data", file), "utf8"));
const sqlLiteral = (value) => value === null || value === undefined ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
const values = (items) => items.map((item) => `(${item.map(sqlLiteral).join(", ")})`).join(",\n  ");

const schema = readJson("skills.schema.json");
const taxonomy = readJson("skills.json");
const satTaxonomy = readJson("sat_taxonomy.json");
const icfesTaxonomy = readJson("icfes_taxonomy.json");
const aeroIndex = readJson("aero_skill_index.json");
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

if (!validate(taxonomy)) throw new Error(`skills.json does not match skills.schema.json:\n${ajv.errorsText(validate.errors, { separator: "\n" })}`);
if (taxonomy.skill_count !== taxonomy.skills.length || taxonomy.skills.length !== 125) throw new Error(`Expected exactly 125 skills; found ${taxonomy.skills.length} (declared ${taxonomy.skill_count}).`);
const codes = taxonomy.skills.map(({ code }) => code);
if (new Set(codes).size !== codes.length) throw new Error("Skill codes must be unique.");

const satDomains = new Map(satTaxonomy.domains.map(({ name, skills }) => [name, new Set(skills)]));
const icfesCategories = new Set(icfesTaxonomy.content_categories.map(({ name }) => name));
const icfesTypes = new Set(icfesTaxonomy.content_types.map(({ name }) => name));
for (const skill of taxonomy.skills) {
  if (skill.sat.domain && !satDomains.has(skill.sat.domain)) throw new Error(`${skill.code} has an unknown SAT domain.`);
  if (skill.sat.domain && skill.sat.skills.some((name) => !satDomains.get(skill.sat.domain).has(name))) throw new Error(`${skill.code} has an unknown SAT skill.`);
  if (skill.icfes.category && !icfesCategories.has(skill.icfes.category)) throw new Error(`${skill.code} has an unknown ICFES category.`);
  if (skill.icfes.content_type && !icfesTypes.has(skill.icfes.content_type)) throw new Error(`${skill.code} has an unknown ICFES content type.`);
}
const expectedAeroPairs = new Set(taxonomy.skills.flatMap((skill) => skill.aero.standards.map((standard) => `${standard}\u0000${skill.code}`)));
const indexedAeroPairs = new Set(aeroIndex.standards.flatMap(({ aero_code, jaguar_skills }) => jaguar_skills.map((code) => `${aero_code}\u0000${code}`)));
if (expectedAeroPairs.size !== indexedAeroPairs.size || [...expectedAeroPairs].some((pair) => !indexedAeroPairs.has(pair))) throw new Error("aero_skill_index.json does not match skills.json.");

const aeroRows = taxonomy.skills.flatMap((skill) => (skill.aero.standards.length ? skill.aero.standards : [null]).map((code) => [skill.code, code, skill.aero.status]));
const satRows = taxonomy.skills.flatMap((skill) => (skill.sat.skills.length ? skill.sat.skills : [null]).map((name) => [skill.code, skill.sat.domain, name, skill.sat.status]));
const icfesRows = taxonomy.skills.map((skill) => [skill.code, skill.icfes.category, skill.icfes.content_type, skill.icfes.status]);
const seed = `-- DO NOT EDIT MANUALLY\n-- Generated from data/skills.json by scripts/generate-skill-seed.mjs\n-- ${taxonomy.skills.length} Jaguar Math skills\n\nbegin;\n\ninsert into public.skills (code, domain, subdomain, name, sort_order, active, notes) values\n  ${values(taxonomy.skills.map((skill) => [skill.code, skill.domain, skill.subdomain, skill.name, skill.sort_order, skill.active, skill.notes ?? null]))}\non conflict (code) do update set\n  domain = excluded.domain, subdomain = excluded.subdomain, name = excluded.name,\n  sort_order = excluded.sort_order, active = excluded.active, notes = excluded.notes, updated_at = now();\n\ndelete from public.skill_aero_mappings mapping using public.skills skill where mapping.skill_id = skill.id and skill.code in (${codes.map(sqlLiteral).join(", ")});\ndelete from public.skill_sat_mappings mapping using public.skills skill where mapping.skill_id = skill.id and skill.code in (${codes.map(sqlLiteral).join(", ")});\ndelete from public.skill_icfes_mappings mapping using public.skills skill where mapping.skill_id = skill.id and skill.code in (${codes.map(sqlLiteral).join(", ")});\n\ninsert into public.skill_aero_mappings (skill_id, aero_code, mapping_status)\nselect skill.id, seed.aero_code, seed.mapping_status\nfrom (values\n  ${values(aeroRows)}\n) as seed(skill_code, aero_code, mapping_status)\njoin public.skills skill on skill.code = seed.skill_code;\n\ninsert into public.skill_sat_mappings (skill_id, sat_domain, sat_skill, mapping_status)\nselect skill.id, seed.sat_domain, seed.sat_skill, seed.mapping_status\nfrom (values\n  ${values(satRows)}\n) as seed(skill_code, sat_domain, sat_skill, mapping_status)\njoin public.skills skill on skill.code = seed.skill_code;\n\ninsert into public.skill_icfes_mappings (skill_id, category, content_type, mapping_status)\nselect skill.id, seed.category, seed.content_type, seed.mapping_status\nfrom (values\n  ${values(icfesRows)}\n) as seed(skill_code, category, content_type, mapping_status)\njoin public.skills skill on skill.code = seed.skill_code;\n\ncommit;\n`;
fs.writeFileSync(path.join(root, "supabase", "seed.sql"), seed);
console.log(`Validated and generated ${taxonomy.skills.length} skills, ${aeroRows.length} AERO rows, ${satRows.length} SAT rows, and ${icfesRows.length} ICFES rows.`);
