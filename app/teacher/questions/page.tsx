import Link from "next/link";
import MathText from "@/app/components/math-text";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import QuestionBankAddForm from "./question-bank-add-form";

type PageProps = { searchParams: Promise<{ assignment_id?: string; q?: string; domain?: string; skill?: string; type?: string; difficulty?: string }> };
type BankQuestion = { id: string; prompt: string; type: string; difficulty: number; options: { id: string; text: string }[] | null; created_at: string };
type Skill = { id: string; code: string; name: string; domain: string };
type QuestionSkill = { question_id: string; is_primary: boolean; skills: Skill | Skill[] | null };

const value = (raw: string | undefined) => raw?.trim() ?? "";

export default async function TeacherQuestionBankPage({ searchParams }: PageProps) {
  const teacher = await requireTeacher();
  const filters = await searchParams;
  const query = value(filters.q); const domain = value(filters.domain); const skill = value(filters.skill); const type = value(filters.type); const difficulty = value(filters.difficulty);
  const supabase = await createClient();
  const [{ data: skills }, { data: drafts }] = await Promise.all([
    supabase.from("skills").select("id, code, name, domain").order("domain").order("code"),
    supabase.from("assignments").select("id, title").eq("created_by", teacher.id).eq("status", "draft").order("updated_at", { ascending: false }),
  ]);
  let matchingQuestionIds: string[] | null = null;
  if (domain || skill) {
    const matchingSkillIds = (skills ?? []).filter((item) => (!domain || item.domain === domain) && (!skill || item.code === skill)).map((item) => item.id);
    if (!matchingSkillIds.length) matchingQuestionIds = [];
    else {
      const { data: links } = await supabase.from("question_skills").select("question_id").in("skill_id", matchingSkillIds);
      matchingQuestionIds = [...new Set((links ?? []).map((link) => link.question_id))];
    }
  }
  let questionQuery = supabase.from("questions").select("id, prompt, type, difficulty, options, created_at").eq("created_by", teacher.id).order("created_at", { ascending: false }).limit(100);
  if (query) questionQuery = questionQuery.ilike("prompt", `%${query}%`);
  if (type && ["multiple_choice", "numeric", "short_text"].includes(type)) questionQuery = questionQuery.eq("type", type);
  if (difficulty && /^[1-5]$/.test(difficulty)) questionQuery = questionQuery.eq("difficulty", Number(difficulty));
  if (matchingQuestionIds) {
    if (!matchingQuestionIds.length) questionQuery = questionQuery.in("id", ["00000000-0000-0000-0000-000000000000"]);
    else questionQuery = questionQuery.in("id", matchingQuestionIds);
  }
  const { data: rawQuestions } = await questionQuery;
  const questions = (rawQuestions ?? []) as BankQuestion[];
  const questionIds = questions.map((item) => item.id);
  const [{ data: rawQuestionSkills }, { data: assignmentLinks }] = await Promise.all([
    questionIds.length ? supabase.from("question_skills").select("question_id, is_primary, skills(id, code, name, domain)").in("question_id", questionIds) : Promise.resolve({ data: [] as QuestionSkill[] }),
    questionIds.length ? supabase.from("assignment_questions").select("assignment_id, question_id, points").in("question_id", questionIds) : Promise.resolve({ data: [] as { assignment_id: string; question_id: string; points: number }[] }),
  ]);
  const assignmentIds = [...new Set((assignmentLinks ?? []).map((item) => item.assignment_id))];
  const { data: sourceAssignments } = assignmentIds.length ? await supabase.from("assignments").select("id, title, updated_at").eq("created_by", teacher.id).in("id", assignmentIds).order("updated_at", { ascending: false }) : { data: [] as { id: string; title: string; updated_at: string }[] };
  const sourceById = new Map((sourceAssignments ?? []).map((item) => [item.id, item]));
  const skillsByQuestion = new Map<string, QuestionSkill[]>();
  for (const item of (rawQuestionSkills ?? []) as QuestionSkill[]) skillsByQuestion.set(item.question_id, [...(skillsByQuestion.get(item.question_id) ?? []), item]);
  const sourceByQuestion = new Map<string, { title: string; points: number }>();
  for (const item of assignmentLinks ?? []) {
    const source = sourceById.get(item.assignment_id);
    if (source && !sourceByQuestion.has(item.question_id)) sourceByQuestion.set(item.question_id, { title: source.title, points: item.points });
  }
  const domains = [...new Set((skills ?? []).map((item) => item.domain))];
  return <main className="teacher-main assessment-page"><Link className="back-link" href="/teacher/assignments">← Assignments</Link><section className="page-heading"><p className="eyebrow">Personal library</p><h1>Question Bank</h1><p>Only questions you created or imported are shown. Adding one creates a separate copy in the chosen draft.</p></section>
    <section className="teacher-section"><form className="assessment-form" method="get"><div className="assessment-fields"><label>Search prompt<input defaultValue={query} name="q" placeholder="e.g. linear equation" /></label><label>Domain<select defaultValue={domain} name="domain"><option value="">All domains</option>{domains.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>Skill<select defaultValue={skill} name="skill"><option value="">All skills</option>{(skills ?? []).map((item) => <option key={item.id} value={item.code}>{item.code} — {item.name}</option>)}</select></label><label>Question type<select defaultValue={type} name="type"><option value="">All types</option><option value="multiple_choice">Multiple choice</option><option value="numeric">Numeric</option><option value="short_text">Short text</option></select></label><label>Difficulty<select defaultValue={difficulty} name="difficulty"><option value="">All difficulties</option>{[1, 2, 3, 4, 5].map((item) => <option key={item} value={item}>{item}</option>)}</select></label></div><button className="secondary-inline-button" type="submit">Apply filters</button></form></section>
    {drafts?.length ? <QuestionBankAddForm defaultAssignmentId={value(filters.assignment_id)} drafts={drafts}>{questions.length ? <section className="question-summary">{questions.map((question) => { const questionSkills = skillsByQuestion.get(question.id) ?? []; const primary = questionSkills.find((item) => item.is_primary) ?? questionSkills[0]; const relatedSkill = Array.isArray(primary?.skills) ? primary.skills[0] : primary?.skills; const source = sourceByQuestion.get(question.id); return <article key={question.id}><label><input name="question_ids" type="checkbox" value={question.id} /> <span>Select question</span></label><span>{question.type.replace("_", " ")} · Difficulty {question.difficulty} · {source?.points ?? 1} pts</span><strong><MathText>{question.prompt}</MathText></strong>{question.options?.length ? <ul>{question.options.map((option) => <li key={option.id}><b>{option.id}.</b> <MathText>{option.text}</MathText></li>)}</ul> : null}<small>{relatedSkill ? `Primary skill: ${relatedSkill.code} — ${relatedSkill.name}` : "No linked Jaguar skill"}{source ? ` · Source: ${source.title}` : ""} · Created {new Date(question.created_at).toLocaleDateString()}</small></article>; })}</section> : <section className="empty-state"><h3>No matching questions.</h3><p>Try clearing a filter or create/import questions in an assignment first.</p></section>}</QuestionBankAddForm> : <section className="empty-state"><h3>Create a private draft first.</h3><p>Question-bank copies can only be added to a draft you own.</p><Link className="teacher-button" href="/teacher/assignments/new">New assignment <span>→</span></Link></section>}</main>;
}
