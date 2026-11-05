import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    role: "teacher" | "admin";
  }

  interface Session {
    user: {
      id: string;
      role: "teacher" | "admin";
    } & NonNullable<DefaultSession["user"]>;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: "teacher" | "admin";
  }
}
