import { IdeaDetail } from "@/components/ideation/IdeaDetail";

export default async function Page({ params }: PageProps<"/ideation/[id]">) {
  const { id } = await params;
  return <IdeaDetail id={id} />;
}
