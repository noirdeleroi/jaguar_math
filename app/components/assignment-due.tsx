"use client";

function isTomorrow(date: Date, now: Date) {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  return date.getFullYear() === tomorrow.getFullYear() && date.getMonth() === tomorrow.getMonth() && date.getDate() === tomorrow.getDate();
}

export default function AssignmentDue({ dueAt, status, className }: { dueAt: string | null; status?: string; className?: string }) {
  const due = dueAt ? new Date(dueAt) : null;
  const now = new Date();
  const validDue = due && !Number.isNaN(due.getTime()) ? due : null;
  const prefix = status === "closed" ? "Closed" : validDue && validDue.getTime() < now.getTime() ? "Overdue" : validDue && isTomorrow(validDue, now) ? "Due tomorrow" : validDue ? "Due" : status === "closed" ? "Closed" : "No due date";
  const value = validDue ? `${prefix}: ${validDue.toLocaleString()}` : prefix;
  return <small className={className} suppressHydrationWarning>{value}</small>;
}
