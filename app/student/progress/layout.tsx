import { FrameworkProgress } from "@/app/components/framework-progress";
import { requireStudent } from "@/lib/auth";
export default async function ProgressLayout({ children }: { children: React.ReactNode }) { const student = await requireStudent(); return <>{children}<FrameworkProgress studentId={student.id} /></>; }
