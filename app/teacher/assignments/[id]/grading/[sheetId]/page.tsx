import ScanAssignmentPage from "../../scan-assignment-page";
export default async function PaperGradingPage({ params }: { params: Promise<{ id: string; sheetId: string }> }) {
  const { id, sheetId } = await params;
  return <ScanAssignmentPage id={id} view="grading" sheetId={sheetId} />;
}
