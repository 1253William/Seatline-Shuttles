import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as typeof globalThis & { seatlinePrisma?: PrismaClient };

export const prisma = globalForPrisma.seatlinePrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.seatlinePrisma = prisma;
}
