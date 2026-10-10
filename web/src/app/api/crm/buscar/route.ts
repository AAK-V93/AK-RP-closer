import { NextResponse } from "next/server";
import { requireWorkspaceUser } from "@/lib/workspace-auth";
import { outsideCrmPeople } from "@/lib/crm-search";

/**
 * Names that only exist on calls outside the CRM (old Fathom recordings named after a
 * person), so the CRM search can find them. Read-only, small fields only.
 */
export async function GET() {
  try {
    const auth = await requireWorkspaceUser();
    if ("error" in auth && auth.error) return auth.error;
    const rows = await auth.prisma.fathomRecording.findMany({
      where: { userId: auth.userId },
      orderBy: { recordedAt: "desc" },
      take: 500,
      select: { id: true, title: true, recordedAt: true },
    });
    return NextResponse.json({ people: outsideCrmPeople(rows) });
  } catch (error) {
    console.error("crm buscar", error);
    return NextResponse.json({ people: [] });
  }
}
