import Link from "next/link";
import videoMap from "@/data/jaguar_math_skill_youtube_map.json";
import { skillDisplayName } from "@/lib/skill-display-names";
import type { AssignmentSkillReview as AssignmentSkillReviewItem } from "@/lib/assignment-skill-review";

type VideoEntry = { youtube_video_title: string; youtube_link: string };
const videos = videoMap as Record<string, VideoEntry>;

function SkillList({ skills, kind }: { skills: AssignmentSkillReviewItem[]; kind: "strength" | "practice" }) {
  if (!skills.length) return <p className="assignment-skill-empty">{kind === "strength" ? "No skills reached the 70% mark on this attempt yet." : "No improvement skills were identified from this assignment."}</p>;
  return <div className="assignment-skill-list">{skills.map((skill) => {
    const video = videos[skill.code];
    return <article key={skill.code}><div><strong>{skillDisplayName(skill.code)}</strong><span>{skill.percent}% on {skill.questionCount} {skill.questionCount === 1 ? "question" : "questions"}</span></div>{kind === "practice" && video ? <Link className="assignment-skill-video" href={`/student/videos?skill=${encodeURIComponent(skill.code)}`}>Watch lesson <span>→</span></Link> : <b>{kind === "strength" ? "Strong" : "Review"}</b>}</article>;
  })}</div>;
}

export default function AssignmentSkillReview({ skills }: { skills: AssignmentSkillReviewItem[] }) {
  if (!skills.length) return <section className="assignment-skill-review"><p className="eyebrow">Skill insights</p><h3>Skill feedback is coming soon.</h3><p className="assignment-skill-intro">Your teacher has not scored the questions connected to skills in this assignment yet.</p></section>;
  const strengths = skills.filter((skill) => skill.percent >= 70);
  const practice = skills.filter((skill) => skill.percent < 70).sort((left, right) => left.percent - right.percent || left.code.localeCompare(right.code));
  return <section className="assignment-skill-review"><header><div><p className="eyebrow">Skill insights</p><h3>What this assignment showed</h3><p className="assignment-skill-intro">This feedback uses only scored questions from this attempt. A skill is a strength at 70% or higher.</p></div></header><div className="assignment-skill-columns"><section className="assignment-skill-group strengths"><h4>You did well</h4><p>Keep using these skills with confidence.</p><SkillList kind="strength" skills={strengths} /></section><section className="assignment-skill-group practice"><h4>Keep practicing</h4><p>Review these skills, then try the linked lesson.</p><SkillList kind="practice" skills={practice} /></section></div></section>;
}
