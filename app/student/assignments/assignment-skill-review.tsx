import Link from "next/link";
import videoMap from "@/data/jaguar_math_skill_youtube_map.json";
import { skillDisplayName } from "@/lib/skill-display-names";
import type { AssignmentSkillReview as AssignmentSkillReviewItem } from "@/lib/assignment-skill-review";

type VideoEntry = { youtube_video_title: string; youtube_link: string };
const videos = videoMap as Record<string, VideoEntry>;

function SkillList({ skills }: { skills: AssignmentSkillReviewItem[] }) {
  if (!skills.length) return <p className="assignment-skill-empty">No mistakes were identified in the scored skill questions on this assignment. Nice work.</p>;
  return <div className="assignment-skill-list">{skills.map((skill) => {
    const video = videos[skill.code];
    return <article key={skill.code}><div><strong>{skillDisplayName(skill.code)}</strong><span>{skill.mistakeCount} {skill.mistakeCount === 1 ? "mistake" : "mistakes"} in this homework</span></div>{video ? <Link className="assignment-skill-video" href={`/student/videos?skill=${encodeURIComponent(skill.code)}`}>Watch lesson <span>→</span></Link> : <b>Review</b>}</article>;
  })}</div>;
}

export default function AssignmentSkillReview({ skills }: { skills: AssignmentSkillReviewItem[] }) {
  const suggestions = skills.slice(0, 5);
  return <section className="assignment-skill-review"><header><div><p className="eyebrow">Homework review</p><h3>Skills to revisit</h3><p className="assignment-skill-intro">Based only on mistakes from this submitted assignment—not your overall progress. Repeated mistakes are shown first.</p></div></header><section className="assignment-skill-group practice"><h4>{skills.length > suggestions.length ? "Top skills to review" : "Skills with mistakes"}</h4><p>{skills.length > suggestions.length ? `Showing the 5 most important of ${skills.length} skills with mistakes.` : "Review these skills, then try the linked lesson."}</p><SkillList skills={suggestions} /></section></section>;
}
