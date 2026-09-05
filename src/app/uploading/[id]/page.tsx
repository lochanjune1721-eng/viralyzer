import { Suspense } from "react";
import { UploadingWorkspace } from "@/components/uploading/UploadingWorkspace";

export default async function Page({ params }: PageProps<"/uploading/[id]">) {
  const { id } = await params;
  return (
    <Suspense>
      <UploadingWorkspace id={id} />
    </Suspense>
  );
}
