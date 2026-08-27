"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startOrContinueAssignment } from "../actions";

export default function StartAssignmentButton({ assignmentId, label = "Start assignment" }: { assignmentId: string; label?: string }) {
  const router = useRouter(); const [error, setError] = useState(""); const [pending, startTransition] = useTransition();
  return <div><button className="teacher-button" disabled={pending} onClick={() => startTransition(async () => { setError(""); const result = await startOrContinueAssignment(assignmentId); if (result.error) setError(result.error); else router.refresh(); })} type="button">{pending ? "Starting…" : label} <span>→</span></button>{error && <p className="inline-error" role="alert">{error}</p>}</div>;
}
