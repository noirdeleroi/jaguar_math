"use client";

import { useFormStatus } from "react-dom";

export default function DuplicateButton() {
  const { pending } = useFormStatus();
  return <button aria-live="polite" className="secondary-inline-button" disabled={pending} type="submit">{pending ? "Duplicating..." : "Duplicate"}</button>;
}
