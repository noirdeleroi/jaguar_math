"use client";

import { useEffect, useState } from "react";

export type VideoSkill = { code: string; name: string; readiness: number | null; attempted: number; evidenceLabel: "Not assessed" | "Low evidence" | "Some evidence" | "Strong evidence"; videoTitle: string | null; videoUrl: string | null };
export type VideoTopic = { name: string; skills: VideoSkill[] };
export type VideoDomain = { code: string; name: string; subtitle: string; topics: VideoTopic[] };

function embedUrl(videoUrl: string) {
  const url = new URL(videoUrl);
  const videoId = url.hostname.includes("youtu.be") ? url.pathname.slice(1) : url.searchParams.get("v");
  return videoId ? `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0` : videoUrl;
}

function ProgressMeter({ value }: { value: number }) {
  return <i className="sat-meter" aria-label={`${Math.round(value)}% readiness`}><em style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></i>;
}

export default function VideoLibrary({ domains, initialSkillCode }: { domains: VideoDomain[]; initialSkillCode?: string }) {
  const [selectedVideo, setSelectedVideo] = useState<VideoSkill | null>(() => domains.flatMap((domain) => domain.topics.flatMap((topic) => topic.skills)).find((skill) => skill.code === initialSkillCode && skill.videoUrl !== null) ?? null);

  useEffect(() => {
    if (!selectedVideo) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedVideo(null); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [selectedVideo]);

  return <>
    <section className="sat-domain-list video-domain-list" aria-label="SAT Math video topics">
      {domains.map((domain, domainIndex) => <details className="sat-domain-card video-domain-card" key={domain.code} open={domainIndex === 0}>
        <summary>
          <div><p>{domain.name}</p><span>{domain.subtitle} · {domain.topics.reduce((total, topic) => total + topic.skills.length, 0)} skills</span></div>
          <div className="video-domain-summary"><strong>{domain.topics.length}</strong><span>{domain.topics.length === 1 ? "Topic" : "Topics"}</span></div>
        </summary>
        <div className="sat-domain-content"><div className="sat-topic-list">
          {domain.topics.map((topic, topicIndex) => <details className="sat-topic-card" key={topic.name} open={domainIndex === 0 && topicIndex === 0}>
            <summary><div><strong>{topic.name}</strong><span>{topic.skills.length} {topic.skills.length === 1 ? "skill" : "skills"}</span></div></summary>
            <div className="video-skill-list">{topic.skills.map((skill) => <article className="video-skill-row" key={`${topic.name}-${skill.code}`}>
              <div><strong>{skill.name}</strong><small>{skill.attempted ? `${skill.attempted} scored question${skill.attempted === 1 ? "" : "s"} · ${skill.evidenceLabel}` : "Not assessed"}</small></div>
              <div className="video-skill-progress">{skill.readiness === null ? <b>Not assessed</b> : <><b>{Math.round(skill.readiness)}%</b><ProgressMeter value={skill.readiness} /></>}</div>
              {skill.videoUrl && skill.videoTitle ? <button className="video-watch-button" onClick={() => setSelectedVideo(skill)} type="button"><span>Watch</span><b>{skill.videoTitle}</b><i aria-hidden="true">▶</i></button> : <span className="video-unavailable">Video coming soon</span>}
            </article>)}</div>
          </details>)}
        </div></div>
      </details>)}
    </section>
    {selectedVideo?.videoUrl && <div className="video-modal-backdrop" onMouseDown={() => setSelectedVideo(null)} role="presentation">
      <section aria-label={`Watch: ${selectedVideo.videoTitle}`} aria-modal="true" className="video-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <header><div><p className="eyebrow">SAT Math video</p><h2>{selectedVideo.name}</h2><span>{selectedVideo.videoTitle}</span></div><button aria-label="Close video" className="video-modal-close" onClick={() => setSelectedVideo(null)} type="button">×</button></header>
        <div className="video-frame"><iframe allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" src={embedUrl(selectedVideo.videoUrl)} title={selectedVideo.videoTitle ?? selectedVideo.name} /></div>
        <footer><a href={selectedVideo.videoUrl} rel="noreferrer" target="_blank">Open on YouTube ↗</a></footer>
      </section>
    </div>}
  </>;
}
