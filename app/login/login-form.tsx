"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const router = useRouter(); const [error, setError] = useState(""); const [isLoading, setIsLoading] = useState(false);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setError(""); const form = new FormData(event.currentTarget); const email = String(form.get("email") ?? "").trim(); const password = String(form.get("password") ?? ""); if (!email || !password) { setError("Enter both your email address and password."); return; } setIsLoading(true); const { error: signInError } = await createClient().auth.signInWithPassword({ email, password }); if (signInError) { setError("We couldn’t sign you in with those credentials. Please try again."); setIsLoading(false); return; } router.replace("/auth/redirect"); router.refresh(); }
  return <main className="auth-page"><section className="auth-card" aria-labelledby="login-title"><Link className="auth-brand" href="/"><span className="brand-mark" aria-hidden="true">∑</span>Jaguar Math</Link><h1 id="login-title">Welcome back.</h1><p>Sign in with the account provided by your teacher.</p><form onSubmit={handleSubmit} noValidate><label className="form-field" htmlFor="email">Email<input autoComplete="email" id="email" name="email" type="email" required /></label><label className="form-field" htmlFor="password">Password<input autoComplete="current-password" id="password" name="password" type="password" required /></label><p className="form-error" role="alert">{error}</p><button className="submit-button" disabled={isLoading} type="submit">{isLoading ? "Signing in…" : "Login"}</button></form><p className="auth-footer"><Link href="/">← Back to Jaguar Math</Link></p></section></main>;
}
