import { Suspense } from "react";
import { UploadingIndex } from "@/components/uploading/UploadingIndex";

export default function Page() {
  return (
    <Suspense>
      <UploadingIndex />
    </Suspense>
  );
}
