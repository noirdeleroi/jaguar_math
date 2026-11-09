import ScanAssignmentPage from "../scan-assignment-page";
export default async function GradingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScanAssignmentPage id={id} view="grading" />;
}
