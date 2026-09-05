import { getCurrentUser } from "@/lib/auth";
import { json } from "@/lib/http";
import { platformStatuses } from "@/lib/publish";
import { env } from "@/lib/env";

export async function GET() {
  const user = await getCurrentUser();
  return json({ platforms: await platformStatuses(user.id), provider: env.publish.provider, publicBaseUrl: env.publicBaseUrl });
}
