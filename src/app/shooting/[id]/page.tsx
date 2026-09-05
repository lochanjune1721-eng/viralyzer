import { ShootingWorkspace } from "@/components/shooting/ShootingWorkspace";

export default async function Page({ params }: PageProps<"/shooting/[id]">) {
  const { id } = await params;
  return <ShootingWorkspace id={id} />;
}
