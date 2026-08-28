import { FrameworkProgress } from "@/app/components/framework-progress";
export default async function StudentProgressLayout({ children, params }: { children: React.ReactNode; params: Promise<{ studentId: string }> }) { const { studentId } = await params; return <>{children}<FrameworkProgress studentId={studentId} /></>; }
