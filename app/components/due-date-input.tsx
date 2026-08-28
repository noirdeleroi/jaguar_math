"use client";

import { useState } from "react";

function toLocalDateTimeValue(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function DueDateInput({ dueAt }: { dueAt: string | null }) {
  const [value, setValue] = useState(() => dueAt ? toLocalDateTimeValue(dueAt) : ""); const [offset, setOffset] = useState(() => (dueAt ? new Date(dueAt) : new Date()).getTimezoneOffset());
  return <label>Due date and time<input name="due_at" onChange={(event) => { setValue(event.target.value); const date = new Date(event.target.value); if (!Number.isNaN(date.getTime())) setOffset(date.getTimezoneOffset()); }} suppressHydrationWarning type="datetime-local" value={value} /><input name="due_at_timezone_offset" type="hidden" value={offset} /></label>;
}
