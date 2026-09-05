import { ScriptingWorkspace } from "@/components/scripting/ScriptingWorkspace";

export default async function Page({ params }: PageProps<"/scripting/[id]">) {
  const { id } = await params;
  return <ScriptingWorkspace id={id} />;
}
