import LoadingPipeline from "@/components/loading/LoadingPipeline";

export default async function SearchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LoadingPipeline searchId={id} />;
}
