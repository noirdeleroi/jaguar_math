import { ClassFrameworkProgress } from "@/app/components/class-framework-progress";
export default async function ClassProgressLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) { const { id } = await params; return <>{children}<ClassFrameworkProgress classId={id} /></>; }
