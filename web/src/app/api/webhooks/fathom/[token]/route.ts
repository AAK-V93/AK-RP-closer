import { NextResponse } from "next/server";
import {
  meetingFromWebhookPayload,
  verifyFathomWebhookSignature,
} from "@/lib/fathom";
import { ingestFathomMeeting } from "@/lib/fathom-ingest";
import { getPrisma, ensureFathomTables, isDatabaseConfigured } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secret-crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || token.length < 16) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "DB" }, { status: 503 });
  }
  const prisma = getPrisma();
  if (!prisma) return NextResponse.json({ error: "DB" }, { status: 503 });

  try {
    await ensureFathomTables(prisma);
  } catch (error) {
    console.error("fathom webhook tables", error);
    return NextResponse.json({ error: "DB" }, { status: 503 });
  }

  const connection = await prisma.fathomConnection.findFirst({
    where: { webhookToken: token },
  });
  if (!connection) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const raw = await request.text();
  if (connection.webhookSecretEnc) {
    try {
      const secret = decryptSecret(connection.webhookSecretEnc);
      if (!verifyFathomWebhookSignature(secret, request.headers, raw)) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    } catch (error) {
      console.error("fathom webhook verify", error);
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  let body: unknown = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const meeting = meetingFromWebhookPayload(body);
  if (!meeting) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    const result = await ingestFathomMeeting(prisma, connection.userId, meeting);
    return NextResponse.json(result);
  } catch (error) {
    console.error("fathom webhook ingest", error);
    return NextResponse.json({ error: "Ingest failed" }, { status: 500 });
  }
}
