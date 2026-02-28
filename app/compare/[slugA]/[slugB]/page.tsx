import CompareScreen from "@/components/report/CompareScreen";

export default async function ComparePage({
  params,
}: {
  params: Promise<{ slugA: string; slugB: string }>;
}) {
  const { slugA, slugB } = await params;
  return <CompareScreen slugA={slugA} slugB={slugB} />;
}
