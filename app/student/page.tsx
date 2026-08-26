import { redirect } from "next/navigation";
import LogoutButton from "./logout-button";
import { createClient } from "@/lib/supabase/server";

export default async function StudentPage() { const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect("/login"); return <main className="student-page"><div className="student-container"><div className="auth-brand"><span className="brand-mark" aria-hidden="true">∑</span>Jaguar Math</div><section className="student-card"><p className="eyebrow">Student space</p><h1>Welcome.</h1><p className="student-email">{user.email}</p><p className="student-note">Your assignments will appear here.</p><LogoutButton /></section></div></main>; }
