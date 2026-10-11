import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";

/** The signed-in user's id, or a redirect to login that comes back here. */
export async function requireUserId(back: string) {
  const session = await getServerSession(authOptions);
  const id = session?.user?.id;
  if (!id) redirect(`/login?callbackUrl=${encodeURIComponent(back)}`);
  return { id, name: session?.user?.name ?? null, email: session?.user?.email ?? null };
}
