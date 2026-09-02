import Link from "next/link";
import { requireStudent } from "@/lib/auth";
import { getStudentSatProgress } from "@/lib/student-sat-progress";
import type { SatSkillProgress } from "@/lib/sat-progress";

const percent = (value: number) => Math.round(value);

function ProgressMeter({ value }: { value: number }) {
  return <i className="sat-meter" aria-label={`${percent(value)}% readiness`}><em style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></i>;
}

function SkillRow({ skill }: { skill: SatSkillProgress }) {
  return <article className="sat-skill-row"><div><strong>{skill.name}</strong><small>{skill.attempted ? `${skill.attempted} scored question${skill.attempted === 1 ? "" : "s"} · ${skill.evidenceLabel}` : "Not assessed"}</small></div><div className="sat-skill-score">{skill.readiness === null ? <b>Not assessed</b> : <><b>{percent(skill.readiness)}%</b><ProgressMeter value={skill.readiness} /></>}</div></article>;
}

export default async function StudentProgressPage() {
  const student = await requireStudent(); const progress = await getStudentSatProgress(student.id);
  return <main className="student-page"><div className="student-container sat-progress-container"><Link className="back-link" href="/student">← Your assignments</Link><section className="sat-progress-heading"><p className="eyebrow">SAT Math preparation</p><h1>SAT Math Preparation</h1><p>Readiness reflects the entire mapped SAT syllabus. Coverage shows how much submitted, scored evidence you have so far.</p></section><section className="sat-overview"><div><span>Overall readiness</span><strong>{percent(progress.readiness)}%</strong><ProgressMeter value={progress.readiness} /></div><dl><div><dt>Skills assessed</dt><dd>{progress.assessedSkills} / {progress.totalSkills}</dd></div><div><dt>Scored question evidence</dt><dd>{progress.totalEvidence}</dd></div></dl></section><section className="sat-domain-list" aria-label="SAT Math domains">{progress.domains.map((domain, index) => <details className="sat-domain-card" key={domain.code} open={index === 0}><summary><div><p>{domain.name}</p><span>≈{Math.round(domain.weight * 100)}% of SAT Math · {domain.assessedSkills} / {domain.totalSkills} skills assessed</span></div><div className="sat-domain-summary"><strong>{percent(domain.readiness)}%</strong><span>Readiness</span></div></summary><div className="sat-domain-content"><ProgressMeter value={domain.readiness} /><div className="sat-topic-list">{domain.topics.map((topic) => <details className="sat-topic-card" key={topic.name}><summary><div><strong>{topic.name}</strong><span>{topic.assessedSkills} / {topic.totalSkills} skills assessed</span></div><b>{percent(topic.readiness)}%</b></summary>{topic.skills.length ? <div className="sat-skill-list">{topic.skills.map((skill) => <SkillRow key={skill.code} skill={skill} />)}</div> : <p className="sat-mapping-gap">No Jaguar Math skills are mapped to this SAT testing point yet.</p>}</details>)}</div></div></details>)}</section></div></main>;
}
