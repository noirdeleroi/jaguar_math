import { requireStudent } from "@/lib/auth";
export default async function ProgressLayout({ children }: { children: React.ReactNode }) { await requireStudent(); return children; }
