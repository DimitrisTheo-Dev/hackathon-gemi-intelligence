import ReportScreen from "@/components/report/ReportScreen";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ReportScreen mode="id" value={id} />;
}
