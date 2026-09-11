"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { landingRotation } from "@/lib/student-randomizer";
import styles from "./student-randomizer.module.css";

type Student = { id: string; name: string };

const COLORS = ["#17483d", "#e36f51", "#d6a42f", "#397965", "#98533f", "#66865f", "#bd7f27", "#2c6254"];
const CENTER = 300;
const RADIUS = 274;

function point(angle: number) {
  const radians = angle * Math.PI / 180;
  return {
    x: Number((CENTER + RADIUS * Math.cos(radians)).toFixed(4)),
    y: Number((CENTER + RADIUS * Math.sin(radians)).toFixed(4)),
  };
}

function segmentPath(index: number, total: number) {
  if (total === 1) return `M ${CENTER - RADIUS} ${CENTER} a ${RADIUS} ${RADIUS} 0 1 0 ${RADIUS * 2} 0 a ${RADIUS} ${RADIUS} 0 1 0 ${-RADIUS * 2} 0`;
  const angle = 360 / total;
  const start = point(-90 - angle / 2 + index * angle);
  const end = point(-90 - angle / 2 + (index + 1) * angle);
  return `M ${CENTER} ${CENTER} L ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 ${angle > 180 ? 1 : 0} 1 ${end.x} ${end.y} Z`;
}

function wheelLabel(name: string, total: number) {
  const words = name.trim().split(/\s+/);
  const compact = total > 18 && words.length > 1 ? `${words[0]} ${words.at(-1)?.[0] ?? ""}.` : name;
  const limit = total > 24 ? 13 : total > 14 ? 17 : 23;
  return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact;
}

function randomInteger(maximum: number) {
  if (maximum <= 1) return 0;
  const values = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / maximum) * maximum;
  do crypto.getRandomValues(values); while (values[0] >= limit);
  return values[0] % maximum;
}

function easeOutQuint(value: number) {
  return 1 - Math.pow(1 - value, 5);
}

export default function StudentRandomizer({ students }: { students: Student[] }) {
  const [includedIds, setIncludedIds] = useState(() => new Set(students.map((student) => student.id)));
  const [winner, setWinner] = useState<Student | null>(null);
  const [history, setHistory] = useState<Student[]>([]);
  const [spinning, setSpinning] = useState(false);
  const wheelRef = useRef<SVGGElement>(null);
  const rotationRef = useRef(0);
  const animationRef = useRef<number | null>(null);
  const activeStudents = useMemo(() => students.filter((student) => includedIds.has(student.id)), [includedIds, students]);
  const activeIndexById = useMemo(() => new Map(activeStudents.map((student, index) => [student.id, index])), [activeStudents]);

  useEffect(() => () => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
  }, []);

  useEffect(() => {
    rotationRef.current = 0;
    if (wheelRef.current) wheelRef.current.style.transform = "rotate(0deg)";
  }, [includedIds]);

  function toggleStudent(studentId: string) {
    if (spinning) return;
    setWinner(null);
    setIncludedIds((current) => {
      const next = new Set(current);
      if (next.has(studentId)) next.delete(studentId); else next.add(studentId);
      return next;
    });
  }

  function includeEveryone() {
    if (!spinning) {
      setWinner(null);
      setIncludedIds(new Set(students.map((student) => student.id)));
    }
  }

  function clearEveryone() {
    if (!spinning) {
      setWinner(null);
      setIncludedIds(new Set());
    }
  }

  function spin() {
    if (spinning || !activeStudents.length) return;
    const winnerIndex = randomInteger(activeStudents.length);
    const selected = activeStudents[winnerIndex];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const turns = reducedMotion ? 1 : 6 + randomInteger(3);
    const duration = reducedMotion ? 700 : 4800 + randomInteger(700);
    const startedAt = performance.now();
    const startRotation = rotationRef.current;
    const finishRotation = landingRotation(startRotation, winnerIndex, activeStudents.length, turns);
    setWinner(null);
    setSpinning(true);

    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const rotation = startRotation + (finishRotation - startRotation) * easeOutQuint(progress);
      if (wheelRef.current) wheelRef.current.style.transform = `rotate(${rotation}deg)`;
      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }
      rotationRef.current = finishRotation;
      animationRef.current = null;
      setWinner(selected);
      setHistory((current) => [selected, ...current].slice(0, 6));
      setSpinning(false);
    };
    animationRef.current = requestAnimationFrame(animate);
  }

  return <section className={styles.workspace} aria-busy={spinning}>
    <div className={styles.wheelPanel}>
      <div className={styles.wheelHeading}><span>{activeStudents.length} on the wheel</span><small>{spinning ? "Choosing…" : "Ready to spin"}</small></div>
      <div className={styles.wheelFrame}>
        <div className={styles.pointer} aria-hidden="true"><i /></div>
        <svg aria-label={`Wheel containing ${activeStudents.length} students`} className={styles.wheel} role="img" viewBox="0 0 600 600">
          <g className={styles.wheelGroup} ref={wheelRef}>
            {activeStudents.length ? activeStudents.map((student, index) => <g key={student.id}>
              <path d={segmentPath(index, activeStudents.length)} fill={COLORS[index % COLORS.length]} />
              <text className={styles.wheelName} fontSize={activeStudents.length > 24 ? 12 : activeStudents.length > 15 ? 14 : 17} transform={`rotate(${index * 360 / activeStudents.length} ${CENTER} ${CENTER}) rotate(90 ${CENTER} 92)`} x={CENTER} y="92">
                <title>{student.name}</title>{wheelLabel(student.name, activeStudents.length)}
              </text>
            </g>) : <circle cx={CENTER} cy={CENTER} fill="#d8d0c3" r={RADIUS} />}
            <circle className={styles.innerRing} cx={CENTER} cy={CENTER} r="55" />
            <circle className={styles.hub} cx={CENTER} cy={CENTER} r="39" />
            <path className={styles.hubMark} d="M281 300h38M300 281v38" />
          </g>
        </svg>
        {!activeStudents.length ? <div className={styles.emptyWheel}><strong>No names selected</strong><span>Choose students from the roster.</span></div> : null}
      </div>
      <button className={styles.spinButton} disabled={spinning || !activeStudents.length} onClick={spin} type="button">
        <span aria-hidden="true">↻</span>{spinning ? "Spinning…" : winner ? "Spin again" : "Spin the wheel"}
      </button>
    </div>

    <aside className={styles.controlPanel}>
      <div aria-live="polite" className={`${styles.result} ${winner ? styles.hasWinner : ""}`}>
        <span>{spinning ? "The wheel is spinning" : winner ? "Selected student" : "Next up"}</span>
        <strong>{spinning ? "…" : winner?.name ?? "Spin to choose"}</strong>
        {winner ? <button disabled={spinning} onClick={() => toggleStudent(winner.id)} type="button">Remove from wheel</button> : <small>Every included student has an equal chance.</small>}
      </div>

      <div className={styles.rosterHeader}>
        <div><span>Participants</span><strong>{activeStudents.length} of {students.length}</strong></div>
        <div><button disabled={spinning || activeStudents.length === students.length} onClick={includeEveryone} type="button">All</button><button disabled={spinning || !activeStudents.length} onClick={clearEveryone} type="button">Clear</button></div>
      </div>
      <div className={styles.roster}>
        {students.length ? students.map((student) => <label key={student.id}>
          <input checked={includedIds.has(student.id)} disabled={spinning} onChange={() => toggleStudent(student.id)} type="checkbox" />
          <i style={{ background: activeIndexById.has(student.id) ? COLORS[activeIndexById.get(student.id)! % COLORS.length] : "#b9c2bd" }} />
          <span>{student.name}</span>
        </label>) : <p>This class has no students yet.</p>}
      </div>

      <div className={styles.history}>
        <span>Recent picks</span>
        {history.length ? <ol>{history.map((student, index) => <li key={`${student.id}-${index}`}><b>{index + 1}</b>{student.name}</li>)}</ol> : <p>Your latest selections will appear here.</p>}
      </div>
    </aside>
  </section>;
}
