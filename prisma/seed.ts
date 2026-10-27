import { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const prisma = new PrismaClient();

async function seed() {
  const contents = await readFile(resolve("skill/shuttle-booking/references/routes-fares.csv"), "utf8");
  const [header, ...rows] = contents.trim().split(/\r?\n/);
  if (header !== "origin,destination,fare_pesewas,seats,date,departs") {
    throw new Error("Unexpected routes-fares.csv header.");
  }

  for (const [index, row] of rows.entries()) {
    const [origin, destination, fare, seats, date, departs] = row.split(",");
    const farePesewas = Number(fare);
    const seatsTotal = Number(seats);
    if (!origin || !destination || !date || !departs || !Number.isInteger(farePesewas) ||
      farePesewas < 1 || !Number.isInteger(seatsTotal) || seatsTotal < 1 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`Invalid route row ${index + 2} in routes-fares.csv.`);
    }

    await prisma.trip.upsert({
      where: {
        origin_destination_travelDate_departs: {
          origin,
          destination,
          travelDate: new Date(`${date}T00:00:00.000Z`),
          departs,
        },
      },
      create: {
        origin,
        destination,
        travelDate: new Date(`${date}T00:00:00.000Z`),
        departs,
        farePesewas,
        seatsTotal,
      },
      update: { farePesewas, seatsTotal },
    });
  }
}

seed()
  .catch((error: unknown) => {
    console.error("Database seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
