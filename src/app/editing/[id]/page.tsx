import { EditingWorkspace } from "@/components/editing/EditingWorkspace";

export default async function Page({ params }: PageProps<"/editing/[id]">) {
  const { id } = await params;
  return <EditingWorkspace id={id} />;
}
