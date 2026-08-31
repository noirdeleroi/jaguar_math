"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { changeInitialPassword, type PasswordChangeState } from "./actions";

const initial: PasswordChangeState = {};

export default function ChangePasswordForm() {
  const router = useRouter(); const [state, action, pending] = useActionState(changeInitialPassword, initial);
  if (state.completed) return <section className="auth-card"><h1>Password updated.</h1><p>Your account is ready.</p><button className="submit-button" onClick={() => router.replace("/student")} type="button">Continue to Jaguar Math</button></section>;
  return <section className="auth-card"><h1>Choose a new password.</h1><p>Your teacher provided a temporary password. Set a private password before continuing.</p><form action={action}><label className="form-field" htmlFor="new-password">New password<input autoComplete="new-password" id="new-password" minLength={12} name="password" required type="password" /></label><label className="form-field" htmlFor="password-confirmation">Confirm new password<input autoComplete="new-password" id="password-confirmation" minLength={12} name="confirmation" required type="password" /></label>{state.error && <p className="form-error" role="alert">{state.error}</p>}<button className="submit-button" disabled={pending} type="submit">{pending ? "Updating password..." : "Set new password"}</button></form></section>;
}
