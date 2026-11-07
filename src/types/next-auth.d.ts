import "next-auth";
import "next-auth/jwt";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    role: "teacher" | "admin";
    sessionVersion: number;
  }

  interface Session {
    user: {
      id: string;
      role: "teacher" | "admin";
      sessionVersion: number;
    } & NonNullable<DefaultSession["user"]>;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: "teacher" | "admin";
    sessionVersion?: number;
  }
}
