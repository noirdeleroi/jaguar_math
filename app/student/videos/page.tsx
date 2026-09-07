import Link from "next/link";
import skillsData from "@/data/skills.json";
import videoMap from "@/data/jaguar_math_skill_youtube_map.json";
import { SAT_DOMAINS } from "@/lib/sat-progress";
import { requireStudent } from "@/lib/auth";
import LogoutButton from "../logout-button";
import VideoLibrary, { type VideoDomain, type VideoSkill } from "./video-library";

type TaxonomySkill = { code: string; name: string; subdomain: string; sort_order: number; active: boolean; sat: { domain: string | null; skills: string[] } };
type VideoEntry = { youtube_video_title: string; youtube_link: string };

const skills = skillsData.skills as TaxonomySkill[];
const videos = videoMap as Record<string, VideoEntry>;

function toVideoSkill(skill: TaxonomySkill): VideoSkill {
  const video = videos[skill.code];
  return { code: skill.code, name: skill.name, videoTitle: video?.youtube_video_title ?? null, videoUrl: video?.youtube_link ?? null };
}

function buildDomains(): VideoDomain[] {
  const activeSkills = skills.filter((skill) => skill.active).sort((left, right) => left.sort_order - right.sort_order);
  const includedCodes = new Set<string>();
  const satDomains = SAT_DOMAINS.map((domain) => ({
    code: domain.code,
    name: domain.name,
    subtitle: `≈${Math.round(domain.weight * 100)}% of SAT Math`,
    topics: domain.topics.map((topic) => {
      const topicSkills = activeSkills.filter((skill) => skill.sat.domain === domain.name && skill.sat.skills.some((satSkill) => topic.mappingTopics.includes(satSkill)));
      topicSkills.forEach((skill) => includedCodes.add(skill.code));
      return { name: topic.name, skills: topicSkills.map(toVideoSkill) };
    }).filter((topic) => topic.skills.length),
  })).filter((domain) => domain.topics.length);
  const foundations = activeSkills.filter((skill) => !includedCodes.has(skill.code));
  if (!foundations.length) return satDomains;
  const foundationTopics = new Map<string, TaxonomySkill[]>();
  foundations.forEach((skill) => foundationTopics.set(skill.subdomain, [...(foundationTopics.get(skill.subdomain) ?? []), skill]));
  return [...satDomains, { code: "FOUNDATIONS", name: "Foundations and supporting skills", subtitle: "Build the skills behind SAT Math", topics: [...foundationTopics.entries()].map(([name, topicSkills]) => ({ name, skills: topicSkills.map(toVideoSkill) })) }];
}

export default async function StudentVideosPage() {
  await requireStudent();
  const domains = buildDomains();
  const videoCount = new Set(domains.flatMap((domain) => domain.topics.flatMap((topic) => topic.skills.map((skill) => skill.code)))).size;
  return <main className="student-page"><div className="student-container sat-progress-container video-library-container">
    <header className="student-header"><Link className="auth-brand" href="/student"><span className="brand-mark" aria-hidden="true">∑</span>Jaguar Math</Link><nav aria-label="Student navigation" className="student-header-actions"><Link href="/student/assessments">Assessments</Link><Link href="/student/progress">Progress</Link><Link aria-current="page" href="/student/videos">Video library</Link><Link href="/student/sat-math">SAT Math info</Link><LogoutButton /></nav></header>
    <section className="sat-progress-heading video-library-heading"><p className="eyebrow">SAT Math preparation</p><h1>Video Library</h1><p>Open any topic to find a guided YouTube lesson for each Jaguar Math skill. Videos play here, so you can stay focused on your study plan.</p></section>
    <section className="video-library-overview"><div><span>Study resources</span><strong>{videoCount}</strong><p>skill videos, organized around the SAT Math syllabus.</p></div><p>Pick a domain, expand a topic, and press <b>Watch</b> when you&apos;re ready to learn or review.</p></section>
    <VideoLibrary domains={domains} />
  </div></main>;
}
