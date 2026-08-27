import LogoutButton from "./logout-button";
import { requireStudent } from "@/lib/auth";

export default async function StudentPage() { const profile = await requireStudent(); return <main className="student-page"><div className="student-container"><div className="auth-brand"><span className="brand-mark" aria-hidden="true">∑</span>Jaguar Math</div><section className="student-card"><p className="eyebrow">Student space</p><h1>Welcome.</h1><p className="student-email">{profile.email}</p><p className="student-note">Your assignments will appear here.</p><LogoutButton /></section></div></main>; }
