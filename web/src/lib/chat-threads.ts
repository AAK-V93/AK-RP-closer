import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  COACH_THREAD_SECTION,
  defaultCoachNotes,
  parseCoachThread,
  parseStoredNotes,
  type CoachChatLine,
  type CoachNotes,
} from "@/lib/closer-coach";

export const THREAD_COACH = "coach";
export const THREAD_HUB = "hub";

const HUB_SECTION = "hub_thread";

function toLine(row: {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
}): CoachChatLine {
  return {
    id: row.id,
    role: row.role === "user" ? "user" : "coach",
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getOrCreateCoachProfile(
  prisma: PrismaClient,
  userId: string,
) {
  let profile = await prisma.coachProfile.findUnique({ where: { userId } });
  if (!profile) {
    profile = await prisma.coachProfile.create({
      data: {
        userId,
        notes: defaultCoachNotes() as unknown as Prisma.InputJsonValue,
      },
    });
  }
  await migratePracticeChats(prisma, userId, profile.id);
  return prisma.coachProfile.findUniqueOrThrow({ where: { id: profile.id } });
}

async function migratePracticeChats(
  prisma: PrismaClient,
  userId: string,
  profileId: string,
) {
  const [coachCount, hubCount, coachRow, hubRow] = await Promise.all([
    prisma.coachMessage.count({ where: { profileId, thread: THREAD_COACH } }),
    prisma.coachMessage.count({ where: { profileId, thread: THREAD_HUB } }),
    prisma.practiceSession.findFirst({
      where: { userId, callSection: COACH_THREAD_SECTION },
      orderBy: { createdAt: "asc" },
    }),
    prisma.practiceSession.findFirst({
      where: { userId, callSection: HUB_SECTION },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  if (coachRow && coachCount === 0) {
    try {
      const payload = parseCoachThread(coachRow.evaluation);
      await prisma.coachProfile.update({
        where: { id: profileId },
        data: {
          level: payload.notes.level,
          niche: payload.notes.niche,
          notes: payload.notes as unknown as Prisma.InputJsonValue,
        },
      });
      for (const line of payload.messages) {
        await prisma.coachMessage.create({
          data: {
            profileId,
            thread: THREAD_COACH,
            role: line.role,
            content: line.content,
            createdAt: new Date(line.createdAt),
          },
        });
      }
      await prisma.practiceSession.delete({ where: { id: coachRow.id } }).catch(() => undefined);
    } catch (error) {
      console.error("migrate coach thread", error);
    }
  }

  if (hubRow && hubCount === 0) {
    try {
      const payload = parseCoachThread(hubRow.evaluation);
      for (const line of payload.messages) {
        await prisma.coachMessage.create({
          data: {
            profileId,
            thread: THREAD_HUB,
            role: line.role,
            content: line.content,
            createdAt: new Date(line.createdAt),
          },
        });
      }
      await prisma.practiceSession.delete({ where: { id: hubRow.id } }).catch(() => undefined);
    } catch (error) {
      console.error("migrate hub thread", error);
    }
  }
}

export async function loadThread(
  prisma: PrismaClient,
  userId: string,
  thread: typeof THREAD_COACH | typeof THREAD_HUB,
) {
  const profile = await getOrCreateCoachProfile(prisma, userId);
  const rows = await prisma.coachMessage.findMany({
    where: { profileId: profile.id, thread },
    orderBy: { createdAt: "asc" },
    take: 80,
  });
  return {
    profile,
    notes: parseStoredNotes(profile.notes),
    messages: rows.map(toLine),
  };
}

export async function saveCoachNotes(
  prisma: PrismaClient,
  profileId: string,
  notes: CoachNotes,
) {
  await prisma.coachProfile.update({
    where: { id: profileId },
    data: {
      level: notes.level,
      niche: notes.niche,
      notes: notes as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function appendThreadLines(
  prisma: PrismaClient,
  profileId: string,
  thread: typeof THREAD_COACH | typeof THREAD_HUB,
  lines: { role: CoachChatLine["role"]; content: string }[],
) {
  const created: CoachChatLine[] = [];
  for (const line of lines) {
    const row = await prisma.coachMessage.create({
      data: {
        profileId,
        thread,
        role: line.role,
        content: line.content,
      },
    });
    created.push(toLine(row));
  }
  return created;
}

export function evidenceSessionFilter() {
  return {
    callSection: { notIn: [COACH_THREAD_SECTION, HUB_SECTION] },
  };
}
