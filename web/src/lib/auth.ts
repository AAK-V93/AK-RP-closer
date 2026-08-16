import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import path from "path";
import { getPrisma, isDatabaseConfigured, prismaErrorCode } from "@/lib/prisma";

dotenv.config({ path: path.join(process.cwd(), "../.env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

export function googleAuthConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim(),
  );
}

async function upsertGoogleUser(email: string, name?: string | null) {
  const prisma = getPrisma();
  if (!prisma) return null;
  const normalized = email.toLowerCase().trim();
  return prisma.user.upsert({
    where: { email: normalized },
    create: {
      email: normalized,
      name: name?.trim() || null,
      passwordHash: null,
    },
    update: name?.trim() ? { name: name.trim() } : {},
  });
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    ...(googleAuthConfigured()
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            authorization: {
              params: {
                prompt: "select_account",
                scope: "openid email profile",
              },
            },
          }),
        ]
      : []),
    CredentialsProvider({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const prisma = getPrisma();
        if (!prisma || !credentials?.email || !credentials.password) {
          return null;
        }
        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase().trim() },
        });
        if (!user?.passwordHash) return null;
        const ok = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!ok) return null;
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google") return true;

      const email = (
        user.email ||
        (profile as { email?: string } | undefined)?.email ||
        ""
      )
        .toLowerCase()
        .trim();
      if (!email) {
        console.error("Google sign-in: no email on profile");
        return false;
      }

      try {
        const dbUser = await upsertGoogleUser(email, user.name);
        if (!dbUser) {
          console.error("Google sign-in: DATABASE_URL missing or Prisma unavailable");
          return "/login?error=Database&code=NO_URL";
        }
        user.id = dbUser.id;
        user.email = dbUser.email;
        return true;
      } catch (error) {
        const code = prismaErrorCode(error);
        console.error("Google sign-in upsert failed", code, error);
        return `/login?error=Database&code=${encodeURIComponent(code)}`;
      }
    },
    async jwt({ token, user, account }) {
      if (user) {
        token.email = user.email;
        token.name = user.name;
        if (account?.provider === "google" && user.email) {
          const prisma = getPrisma();
          const dbUser = await prisma?.user.findUnique({
            where: { email: user.email.toLowerCase().trim() },
          });
          token.sub = dbUser?.id ?? token.sub;
        } else {
          token.sub = user.id;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.email = token.email as string;
        session.user.name = token.name as string | null;
      }
      return session;
    },
  },
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
};

export function authConfigured() {
  return (
    isDatabaseConfigured() &&
    Boolean(process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim())
  );
}
