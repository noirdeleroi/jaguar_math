export function safeReturnPath(value: string | null | undefined, role: "student" | "teacher") {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  const allowedPrefix = role === "student" ? "/student" : "/teacher";
  return value === allowedPrefix || value.startsWith(`${allowedPrefix}/`) || value.startsWith(`${allowedPrefix}?`) ? value : null;
}
