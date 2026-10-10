import { NextResponse } from "next/server";
import { CURRENT_BUILD_ID } from "@/lib/app-version";

export const dynamic = "force-dynamic";

/** Tiny, public, no DB: the build id of the deploy that answers. */
export function GET() {
  return NextResponse.json(
    { build: CURRENT_BUILD_ID },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
