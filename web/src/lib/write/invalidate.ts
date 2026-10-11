import { revalidateTag } from "next/cache";
import { type WriteEffect, tagsForWrite } from "@/lib/read/tags";

/**
 * Call after a write (Route Handler or Server Action), after recount().
 * revalidateTag marks entries stale; they are read again on the next visit.
 */
export function invalidate(userId: string, effect: WriteEffect, revalidate: (tag: string) => void = revalidateTag) {
  const list = tagsForWrite(userId, effect);
  for (const tag of list) revalidate(tag);
  return list;
}
