"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type WeekOption = { label: string; sortOrder: number; trimester: string };

export default function CurrentWeekSelector({ currentWeek, options }: { currentWeek: string; options: WeekOption[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState(currentWeek);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  async function updateWeek(weekLabel: string) {
    setSelected(weekLabel);
    setMessage("Saving current week…");
    const response = await fetch("/api/stars/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ weekLabel }) });
    if (!response.ok) {
      setSelected(currentWeek);
      setMessage("Could not update the week. Please try again.");
      return;
    }
    setMessage(`${weekLabel} is now active on every Stars page.`);
    startTransition(() => router.refresh());
  }

  return <div className="current-week-selector"><label><span>Current teaching week</span><select aria-label="Current teaching week" disabled={isPending} onChange={(event) => void updateWeek(event.target.value)} value={selected}>{options.map((option) => <option key={option.label} value={option.label}>{option.label} · {option.trimester}</option>)}</select></label><small role="status">{message || "Changing this updates the default week across Jaguar Stars."}</small></div>;
}
