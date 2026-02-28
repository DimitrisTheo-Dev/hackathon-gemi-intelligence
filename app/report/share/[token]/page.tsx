import ReportScreen from "@/components/report/ReportScreen";

export default async function SharedReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ReportScreen mode="token" value={token} />;
}
