import type { PrismaClient } from "@prisma/client";

/** Hub lines that can date a cuota. lead.updatedAt is not one of them. */
export async function loadCashNotes(prisma: PrismaClient, userId: string) {
  try {
    return await prisma.coachMessage.findMany({
      where: { thread: "hub", profile: { userId } },
      orderBy: { createdAt: "desc" },
      take: 400,
      select: { content: true, createdAt: true },
    });
  } catch (error) {
    console.error("cash notes", error);
    return [];
  }
}
