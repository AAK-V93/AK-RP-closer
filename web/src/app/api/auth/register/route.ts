import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getPrisma, isDatabaseConfigured } from "@/lib/prisma";

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "La base de datos no está configurada (DATABASE_URL)" },
      { status: 503 },
    );
  }

  const prisma = getPrisma();
  if (!prisma) {
    return NextResponse.json({ error: "DB no disponible" }, { status: 503 });
  }

  try {
    const body = await request.json();
    const email = String(body.email || "")
      .toLowerCase()
      .trim();
    const password = String(body.password || "");
    const name = String(body.name || "").trim() || null;

    if (!email.includes("@") || password.length < 8) {
      return NextResponse.json(
        { error: "Email válido y contraseña de al menos 8 caracteres" },
        { status: 400 },
      );
    }

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return NextResponse.json(
        { error: "Ese email ya tiene cuenta" },
        { status: 409 },
      );
    }

    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash: await bcrypt.hash(password, 10),
      },
      select: { id: true, email: true, name: true },
    });

    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json(
      {
        error: "No se pudo crear la cuenta",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
