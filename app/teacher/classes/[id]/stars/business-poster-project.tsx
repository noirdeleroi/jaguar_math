"use client";

import { useEffect, useRef, useState } from "react";
import { BUSINESS_POSTER_RUBRIC, BUSINESS_POSTER_TITLE, projectGrades, sumProjectScores, validateProjectDocument, type BusinessPosterProject, type ProjectDocument, type ProjectRosterStudent, type ProjectScore, type ProjectTeam } from "@/lib/business-poster-project";
import gradebookStyles from "./class-gradebook.module.css";
import styles from "./business-poster-project.module.css";

function ScoreInput({ label, value, disabled, onChange }: { label: string; value: ProjectScore; disabled: boolean; onChange: (value: ProjectScore) => void }) {
  return <input aria-label={label} disabled={disabled} inputMode="decimal" max={20} min={0} onChange={(event) => {
    const raw = event.target.value;
    if (raw === "") onChange(null);
    else { const score = Number(raw); if (Number.isFinite(score) && score >= 0 && score <= 20) onChange(score); }
  }} placeholder="—" step="any" type="number" value={value ?? ""} />;
}

function Rubric() {
  return <details className={styles.rubric}><summary>Full rubric · five criteria, 20 points each</summary>{BUSINESS_POSTER_RUBRIC.map((criterion, index) => <article key={criterion.title}><strong>C{index + 1}. {criterion.title} · {index < 3 ? "Team" : "Individual"} /20</strong><p>{criterion.description}</p></article>)}</details>;
}

export default function BusinessPosterProjectDialog({ classId, workItemId, onClose, onSaved }: { classId: string; workItemId: string; onClose: () => void; onSaved: (project: BusinessPosterProject) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const savingRef = useRef(false);
  const [project, setProject] = useState<BusinessPosterProject | null>(null);
  const [draft, setDraft] = useState<ProjectDocument | null>(null);
  const [roster, setRoster] = useState<ProjectRosterStudent[]>([]);
  const [mode, setMode] = useState<"overview" | "grades" | "teams">("overview");
  const [activeTeamId, setActiveTeamId] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const dirty = !!draft && !!project && JSON.stringify(draft) !== JSON.stringify(project.document);

  useEffect(() => {
    const dialog = dialogRef.current!;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => { document.body.style.overflow = overflow; dialog.close(); previous?.focus(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/classes/${classId}/projects/${workItemId}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json() as { project?: BusinessPosterProject; roster?: ProjectRosterStudent[]; error?: string };
        if (!response.ok || !result.project || !result.roster) throw new Error(result.error || "The project could not be loaded.");
        setProject(result.project); setDraft(structuredClone(result.project.document)); setRoster(result.roster);
        setActiveTeamId(result.project.document.teams[0]?.id ?? "");
        setError(""); setConflict(false); setMessage("");
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The project could not be loaded."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [classId, workItemId, reloadKey]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  function close() { if (!busy && (!dirty || window.confirm("Discard the unsaved project changes?"))) onClose(); }
  function updateTeam(id: string, change: (team: ProjectTeam) => ProjectTeam) {
    setDraft((current) => current ? { ...current, teams: current.teams.map((team) => team.id === id ? change(team) : team) } : current);
    setMessage("");
  }
  async function save() {
    if (!draft || !project || savingRef.current || conflict) return;
    const members = new Set(draft.teams.flatMap((team) => team.members.flatMap((member) => member.studentId ? [member.studentId] : [])));
    const snapshot: ProjectDocument = { ...draft, individualScores: Object.fromEntries(Object.entries(draft.individualScores).filter(([id]) => members.has(id))) };
    try { validateProjectDocument(snapshot, new Set(roster.map((student) => student.id))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Check the rubric."); return; }
    savingRef.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/classes/${classId}/projects/${workItemId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: project.revision, document: snapshot }) });
      const result = await response.json() as { project?: BusinessPosterProject; error?: string };
      if (response.status === 409) setConflict(true);
      if (!response.ok || !result.project) throw new Error(result.error || "The project could not be saved.");
      setProject(result.project); setDraft(structuredClone(result.project.document)); onSaved(result.project);
      setMessage("Saved. Completed individual grades are now in Class Manager.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Save failed. Your changes are still open."); }
    finally { savingRef.current = false; setBusy(false); }
  }
  const activeTeam = draft?.teams.find((team) => team.id === activeTeamId) ?? draft?.teams[0];
  const grades = draft ? projectGrades(draft, new Set(roster.map((student) => student.id))) : {};
  const assigned = new Set(draft?.teams.flatMap((team) => team.members.flatMap((member) => member.studentId ? [member.studentId] : [])) ?? []);
  const unresolved = draft?.teams.reduce((sum, team) => sum + team.members.filter((member) => !member.studentId || !roster.some((student) => student.id === member.studentId)).length, 0) ?? 0;

  return <dialog aria-labelledby="poster-project-title" className={`${gradebookStyles.columnDialog} ${styles.dialog}`} onCancel={(event) => { event.preventDefault(); close(); }} ref={dialogRef}>
    <button aria-label="Close project" className={gradebookStyles.dialogClose} disabled={busy} onClick={close} type="button">×</button>
    <header><p className={gradebookStyles.dialogEyebrow}>Class Manager · Project /100</p><h2 id="poster-project-title">{BUSINESS_POSTER_TITLE}</h2><p>Team criteria /60 + individual criteria /40. Blank cells remain ungraded.</p></header>
    {loading ? <p role="status">Loading saved teams and scores…</p> : null}
    {draft && !loading ? <>
      <nav aria-label="Project tools" className={styles.toolbar}><button aria-pressed={mode === "grades"} onClick={() => setMode("grades")} type="button">Grade Project</button><button aria-pressed={mode === "teams"} onClick={() => setMode("teams")} type="button">Edit teams</button><span>{Object.keys(grades).length}/{assigned.size} students graded</span></nav>
      <Rubric />
      {unresolved ? <p className={styles.warning} role="status">{unresolved} unresolved {unresolved === 1 ? "student" : "students"}. Open Edit teams to choose existing roster students.</p> : null}
      {mode === "overview" ? <div className={styles.overview}>{draft.teams.map((team) => <article key={team.id}><strong>{team.name}</strong><p>{team.members.map((member) => roster.find((student) => student.id === member.studentId)?.fullName ?? `${member.label || "Choose a student"} (unresolved)`).join(" · ")}</p></article>)}{!draft.teams.length ? <p>Create teams from this class roster to start grading.</p> : null}</div> : null}
      {mode === "teams" ? <section className={styles.teamEditor}><p>Choose students from this class. Team scores follow the team; individual scores follow the student. Students may appear in one team only.</p>{draft.teams.map((team) => <fieldset disabled={busy} key={team.id}><legend>{team.name}</legend><div className={styles.teamHeading}><label>Team name<input maxLength={80} onChange={(event) => updateTeam(team.id, (current) => ({ ...current, name: event.target.value }))} value={team.name} /></label><button onClick={() => setDraft((current) => current ? { ...current, teams: current.teams.filter((item) => item.id !== team.id) } : current)} type="button">Remove team</button></div>{team.members.map((member, index) => <div className={styles.member} key={index}><label>{member.label || `Member ${index + 1}`}<select aria-label={`${team.name} member ${index + 1}`} onChange={(event) => { const student = roster.find((item) => item.id === event.target.value); updateTeam(team.id, (current) => ({ ...current, members: current.members.map((item, position) => position === index ? { studentId: student?.id ?? null, label: student?.fullName ?? item.label } : item) })); }} value={member.studentId && roster.some((student) => student.id === member.studentId) ? member.studentId : ""}><option value="">Unresolved — choose a student</option>{roster.map((student) => <option disabled={assigned.has(student.id) && member.studentId !== student.id} key={student.id} value={student.id}>{student.fullName}</option>)}</select></label><button aria-label={`Remove ${member.label || "member"} from ${team.name}`} onClick={() => updateTeam(team.id, (current) => ({ ...current, members: current.members.filter((_, position) => position !== index) }))} type="button">×</button></div>)}<button disabled={team.members.length >= 100} onClick={() => updateTeam(team.id, (current) => ({ ...current, members: [...current.members, { studentId: null, label: "" }] }))} type="button">＋ Add member</button></fieldset>)}<button disabled={busy || draft.teams.length >= 50} onClick={() => { const team: ProjectTeam = { id: crypto.randomUUID(), name: `Group ${draft.teams.length + 1}`, scores: [null, null, null], members: Array.from({ length: 4 }, () => ({ studentId: null, label: "" })) }; setDraft((current) => current ? { ...current, teams: [...current.teams, team] } : current); setActiveTeamId(team.id); }} type="button">＋ Add team</button><p>Not assigned: {roster.filter((student) => !assigned.has(student.id)).map((student) => student.fullName).join(" · ") || "Everyone is assigned"}</p></section> : null}
      {mode === "grades" ? <section>
        <nav aria-label="Project groups" className={styles.groupTabs}>{draft.teams.map((team) => <button aria-pressed={activeTeam?.id === team.id} key={team.id} onClick={() => setActiveTeamId(team.id)} type="button">{team.name}</button>)}</nav>
        {activeTeam ? <div className={styles.grading}>
          <h3>{activeTeam.name} <small>Team subtotal: {sumProjectScores(activeTeam.scores) ?? "—"}/60</small></h3>
          <fieldset disabled={busy}><legend>Team grading · shared by every member</legend>{BUSINESS_POSTER_RUBRIC.slice(0, 3).map((criterion, index) => <label className={styles.criterion} key={criterion.title}><span>C{index + 1}. {criterion.title}</span><ScoreInput disabled={busy} label={`${activeTeam.name} ${criterion.title}`} onChange={(value) => updateTeam(activeTeam.id, (team) => ({ ...team, scores: team.scores.map((score, position) => position === index ? value : score) as ProjectTeam["scores"] }))} value={activeTeam.scores[index]} /><span>/20</span></label>)}</fieldset>
          <h4>Individual grading</h4><div className={styles.tableScroller}><table><thead><tr><th>Student</th><th>Understanding /20</th><th>Participation /20</th><th>Final /100</th></tr></thead><tbody>{activeTeam.members.map((member, index) => {
            const student = roster.find((item) => item.id === member.studentId);
            const scores = member.studentId ? draft.individualScores[member.studentId] ?? [null, null] : [null, null];
            return <tr key={member.studentId ?? `unresolved-${index}`}><th>{student?.fullName ?? `${member.label || "Choose a student"} (unresolved)`}</th>{[0, 1].map((criterion) => <td key={criterion}><ScoreInput disabled={busy || !student} label={`${student?.fullName ?? member.label} ${criterion === 0 ? "Understanding" : "Participation"}`} onChange={(value) => { const id = member.studentId; if (!id) return; setDraft((current) => { if (!current) return current; const existing = current.individualScores[id] ?? [null, null]; const next: [ProjectScore, ProjectScore] = [...existing]; next[criterion] = value; return { ...current, individualScores: { ...current.individualScores, [id]: next } }; }); setMessage(""); }} value={scores[criterion]} /></td>)}<td><output aria-label={`${student?.fullName ?? member.label} final grade`}>{member.studentId && grades[member.studentId] ? `${grades[member.studentId].score}/100` : "Ungraded"}</output></td></tr>;
          })}</tbody></table></div>
        </div> : <p>Open Edit teams and add a team to start grading.</p>}
      </section> : null}
    </> : null}
    <footer className={styles.footer}>
      {error ? <p className={gradebookStyles.formError} role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : <p role="status">{busy ? "Saving rubric and individual grades…" : dirty ? "Unsaved changes" : "Saved scores restore when you reopen this project."}</p>}
      <div className={gradebookStyles.dialogActions}>{conflict || (!draft && !loading) ? <button disabled={busy} onClick={() => { if (!dirty || window.confirm("Discard your unsaved changes and load the latest saved project?")) { setLoading(true); setReloadKey((value) => value + 1); } }} type="button">Reload saved project</button> : <button disabled={busy} onClick={close} type="button">Close</button>}<button disabled={busy || loading || !draft || !dirty || conflict} onClick={() => void save()} type="button">{busy ? "Saving…" : "Save project grades"}</button></div>
    </footer>
  </dialog>;
}
