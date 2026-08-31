import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import ChangePasswordForm from "./change-password-form";

export default async function ChangePasswordPage() {
  const profile = await getCurrentProfile(); if (!profile) redirect("/login"); if (profile.role === "teacher") redirect("/teacher"); if (!profile.must_change_password) redirect("/student");
  return <main className="auth-page"><ChangePasswordForm /></main>;
}
