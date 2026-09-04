import Link from "next/link";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import QuestionBankAddForm from "./question-bank-add-form";
import QuestionBankWorkspace, { type BankQuestionDetail } from "./question-bank-workspace";

type PageProps = { searchParams: Promise<{ assignment_id?: string; q?: string; domain?: string; skill?: string; type?: string; difficulty?: string }> };
type BankQuestion = { id: string; prompt: string; type: string; difficulty: number; options: { id: string; text: string }[] | null; created_at: string };
type Skill = { id: string; code: string; name: string; domain: string };
type QuestionSkill = { question_id: string; weight: number; is_primary: boolean; skills: Skill | Skill[] | null };
type QuestionKey = { question_id: string; correct_answer: string; numeric_tolerance: number; explanation: string | null };
type AssignmentLink = { assignment_id: string; question_id: string; points: number };
type SourceAssignment = { id: string; title: string; status: string; updated_at: string };

const value = (raw: string | undefined) => raw?.trim() ?? "";

function questionBankHref(filters: Awaited<PageProps["searchParams"]>, changes: Partial<Awaited<PageProps["searchParams"]>>) {
  const next = { assignment_id: value(filters.assignment_id), q: value(filters.q), domain: value(filters.domain), skill: value(filters.skill), type: value(filters.type), difficulty: value(filters.difficulty), ...changes };
  const params = new URLSearchParams();
  for (const [key, item] of Object.entries(next)) if (item) params.set(key, item);
  return `/teacher/questions${params.size ? `?${params.toString()}` : ""}`;
}

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
  let questionCountQuery = supabase.from("questions").select("id", { count: "exact", head: true }).eq("created_by", teacher.id);
  if (query) { questionQuery = questionQuery.ilike("prompt", `%${query}%`); questionCountQuery = questionCountQuery.ilike("prompt", `%${query}%`); }
  if (type && ["multiple_choice", "numeric", "short_text"].includes(type)) { questionQuery = questionQuery.eq("type", type); questionCountQuery = questionCountQuery.eq("type", type); }
  if (difficulty && /^[1-5]$/.test(difficulty)) { questionQuery = questionQuery.eq("difficulty", Number(difficulty)); questionCountQuery = questionCountQuery.eq("difficulty", Number(difficulty)); }
  if (matchingQuestionIds) {
    const ids = matchingQuestionIds.length ? matchingQuestionIds : ["00000000-0000-0000-0000-000000000000"];
    questionQuery = questionQuery.in("id", ids); questionCountQuery = questionCountQuery.in("id", ids);
  }
  const [{ data: rawQuestions }, { count: totalQuestionCount }] = await Promise.all([questionQuery, questionCountQuery]);
  const questions = (rawQuestions ?? []) as BankQuestion[];
  const questionIds = questions.map((item) => item.id);
  const [{ data: rawQuestionSkills }, { data: rawKeys }, { data: rawAssignmentLinks }] = await Promise.all([
    questionIds.length ? supabase.from("question_skills").select("question_id, weight, is_primary, skills(id, code, name, domain)").in("question_id", questionIds) : Promise.resolve({ data: [] as QuestionSkill[] }),
    questionIds.length ? supabase.from("question_keys").select("question_id, correct_answer, numeric_tolerance, explanation").in("question_id", questionIds) : Promise.resolve({ data: [] as QuestionKey[] }),
    questionIds.length ? supabase.from("assignment_questions").select("assignment_id, question_id, points").in("question_id", questionIds) : Promise.resolve({ data: [] as AssignmentLink[] }),
  ]);
  const assignmentLinks = (rawAssignmentLinks ?? []) as AssignmentLink[];
  const assignmentIds = [...new Set(assignmentLinks.map((item) => item.assignment_id))];
  const { data: rawSourceAssignments } = assignmentIds.length ? await supabase.from("assignments").select("id, title, status, updated_at").eq("created_by", teacher.id).in("id", assignmentIds).order("updated_at", { ascending: false }) : { data: [] as SourceAssignment[] };
  const sourceById = new Map((rawSourceAssignments ?? []).map((item) => [item.id, item as SourceAssignment]));
  const skillsByQuestion = new Map<string, BankQuestionDetail["skills"]>();
  for (const item of (rawQuestionSkills ?? []) as QuestionSkill[]) { const linkedSkill = Array.isArray(item.skills) ? item.skills[0] : item.skills; if (linkedSkill) skillsByQuestion.set(item.question_id, [...(skillsByQuestion.get(item.question_id) ?? []), { code: linkedSkill.code, name: linkedSkill.name, domain: linkedSkill.domain, weight: Number(item.weight), is_primary: item.is_primary }]); }
  const keyByQuestion = new Map((rawKeys ?? []).map((item) => [item.question_id, item as QuestionKey]));
  const sourcesByQuestion = new Map<string, SourceAssignment[]>();
  for (const link of assignmentLinks) { const source = sourceById.get(link.assignment_id); if (source) sourcesByQuestion.set(link.question_id, [...(sourcesByQuestion.get(link.question_id) ?? []), source]); }
  const questionDetails: BankQuestionDetail[] = questions.map((question) => {
    const sources = sourcesByQuestion.get(question.id) ?? []; const source = sources[0] ?? null; const editableDraft = sources.find((item) => item.status === "draft") ?? null; const key = keyByQuestion.get(question.id);
    const points = assignmentLinks.find((item) => item.question_id === question.id && item.assignment_id === source?.id)?.points ?? 1;
    return { ...question, options: question.options ?? null, points: Number(points), skills: skillsByQuestion.get(question.id) ?? [], correctAnswer: key?.correct_answer ?? null, numericTolerance: key ? Number(key.numeric_tolerance) : null, explanation: key?.explanation ?? null, source: source ? { id: source.id, title: source.title, status: source.status } : null, editableDraft: editableDraft ? { id: editableDraft.id, title: editableDraft.title } : null };
  });
  const domains = [...new Set((skills ?? []).map((item) => item.domain))];
  const questionList = questionDetails.length ? <QuestionBankWorkspace canSelect={Boolean(drafts?.length)} questions={questionDetails} /> : <section className="question-bank-empty"><h2>No matching questions.</h2><p>Try another domain or filter, or import questions from a new assignment.</p>{(query || domain || skill || type || difficulty) && <Link className="secondary-inline-button" href={questionBankHref(filters, { q: "", domain: "", skill: "", type: "", difficulty: "" })}>Clear filters</Link>}</section>;
  return <main className="teacher-main assessment-page question-bank-page"><Link className="back-link" href="/teacher/assignments">← Assignments</Link><section className="page-heading question-bank-heading"><div><p className="eyebrow">Personal library</p><h1>Question Bank</h1><p>Browse, inspect, and safely reuse your questions. Selecting a question copies it into a private draft, protecting the original and any published assessment history.</p></div><div className="question-bank-total"><strong>{totalQuestionCount ?? 0}</strong><span>{totalQuestionCount === 1 ? "question" : "questions"}</span></div></section><div className="question-bank-layout"><aside className="question-bank-sidebar"><form className="question-bank-filters" method="get"><input name="assignment_id" type="hidden" value={value(filters.assignment_id)} /><div><p className="eyebrow">Find questions</p><h2>Filters</h2></div><label>Search prompts<input defaultValue={query} name="q" placeholder="e.g. linear equation" /></label><label>Question type<select defaultValue={type} name="type"><option value="">All types</option><option value="multiple_choice">Multiple choice</option><option value="numeric">Numeric</option><option value="short_text">Short text</option></select></label><label>Difficulty<select defaultValue={difficulty} name="difficulty"><option value="">All levels</option>{[1, 2, 3, 4, 5].map((item) => <option key={item} value={item}>Difficulty {item}</option>)}</select></label><button className="secondary-inline-button" type="submit">Apply filters</button></form><nav aria-label="Filter by Jaguar domain" className="question-domain-nav"><div><p className="eyebrow">Jaguar domains</p><h2>Browse by domain</h2></div><Link aria-current={!domain ? "page" : undefined} className={!domain ? "active" : ""} href={questionBankHref(filters, { domain: "", skill: "" })}>All domains <span>{totalQuestionCount ?? 0}</span></Link>{domains.map((item) => <Link aria-current={domain === item ? "page" : undefined} className={domain === item ? "active" : ""} href={questionBankHref(filters, { domain: item, skill: "" })} key={item}>{item}</Link>)}</nav></aside><section className="question-bank-results"><header><div><p className="eyebrow">Your questions</p><h2>{totalQuestionCount ?? 0} {totalQuestionCount === 1 ? "question" : "questions"}</h2><p>{questionDetails.length === 100 && (totalQuestionCount ?? 0) > 100 ? "Showing the newest 100 matches." : "Click a question to inspect its student view, answer key, solution, and skills."}</p></div><Link className="teacher-button" href="/teacher/assignments/new">New assignment <span>→</span></Link></header>{drafts?.length ? <QuestionBankAddForm defaultAssignmentId={value(filters.assignment_id)} drafts={drafts}>{questionList}</QuestionBankAddForm> : <><section className="question-bank-draft-notice"><strong>Create a draft to add questions</strong><p>You can browse details now. To reuse or edit a copy, create a private draft first.</p><Link className="secondary-inline-button" href="/teacher/assignments/new">Create a draft</Link></section>{questionList}</>}</section></div></main>;
}
