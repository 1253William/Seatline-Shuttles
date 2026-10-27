import { randomBytes, randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BookingStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { asError, asText, bookingError } from "../lib/errors.js";
import { initializePayment, verifyTransaction } from "../lib/paystack.js";
import { prisma } from "../lib/prisma.js";

//Hold duration for a seat in minutes before it expires
const HOLD_MINUTES = 10;

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function isRetryableDatabaseError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2034");
}


//Async function to confirm payment and update booking status
async function confirmPayment(reference: string) {
  const booking = await prisma.booking.findUnique({
    where: { paymentReference: reference },
    include: { trip: true },
  });
  if (!booking) {
    return { error: bookingError("HOLD_NOT_FOUND", "No booking matches this payment reference.", "Check the payment reference or create a new booking.") };
  }
  if (booking.status === BookingStatus.CONFIRMED) {
    return { booking };
  }

  const payment = await verifyTransaction(reference);
  if (payment.status !== "success") {
    return { error: bookingError("PAYMENT_FAILED", "Paystack has not marked this payment as successful.", "Wait briefly and verify again, or ask the passenger to complete payment.") };
  }
  if (payment.amount !== booking.trip.farePesewas || payment.currency !== "GHS" ||
    String(payment.metadata?.booking_id ?? "") !== booking.id) {
    return { error: bookingError("PAYMENT_MISMATCH", "Payment details do not match this booking.", "Do not confirm the ticket; refer the payment to staff.") };
  }

  const now = new Date();
  if (booking.expiresAt <= now) {
    return { error: bookingError("HOLD_EXPIRED", "The seat hold expired before the payment could be confirmed.", "Do not confirm this booking; refer the successful payment to staff.") };
  }

  const ticketReference = `SL-${randomBytes(6).toString("hex").toUpperCase()}`;
  try {
    const updated = await prisma.booking.updateMany({
      where: {
        id: booking.id,
        status: BookingStatus.PAYMENT_PENDING,
        expiresAt: { gt: now },
      },
      data: { status: BookingStatus.CONFIRMED, ticketReference },
    });
    if (updated.count === 0) {
      const current = await prisma.booking.findUnique({ where: { id: booking.id }, include: { trip: true } });
      if (current?.status === BookingStatus.CONFIRMED) return { booking: current };
      return { error: bookingError("HOLD_EXPIRED", "The seat hold expired before the payment could be confirmed.", "Do not confirm this booking; refer the successful payment to staff.") };
    }
  } catch (error) {
    if (!isRetryableDatabaseError(error)) throw error;
    const current = await prisma.booking.findUnique({ where: { id: booking.id }, include: { trip: true } });
    if (current?.status === BookingStatus.CONFIRMED) return { booking: current };
    throw error;
  }

  return {
    booking: await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
      include: { trip: true },
    }),
  };
}

//Async function to process Paystack webhook events
export async function processPaystackEvent(reference: string) {
  return confirmPayment(reference);
}

//Function to create and configure the MCP server with registered tools
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "seatline-shuttles", version: "1.0.0" });

  //Tool for searching trips based on origin, destination, and date
  //1.find_trips
  server.registerTool(
    "find_trips",
    {
      title: "Find Trips",
      description: "Search published shuttle trips by origin, destination, and date. Use before holding a seat.",
      inputSchema: {
        origin: z.string().trim().min(2).max(80),
        destination: z.string().trim().min(2).max(80),
        date: z.string().refine(isValidDate, "Expected a real date in YYYY-MM-DD format."),
      },
    },
    async ({ origin, destination, date }) => {
      const trips = await prisma.trip.findMany({
        where: {
          origin: { equals: origin, mode: "insensitive" },
          destination: { equals: destination, mode: "insensitive" },
          travelDate: new Date(`${date}T00:00:00.000Z`),
        },
        orderBy: { departs: "asc" },
      });

      const availableTrips = await Promise.all(trips.map(async (trip) => {
        const now = new Date();
        await prisma.booking.deleteMany({
          where: { tripId: trip.id, status: { not: BookingStatus.CONFIRMED }, expiresAt: { lte: now } },
        });
        const occupied = await prisma.booking.count({ where: { tripId: trip.id } });
        return {
          id: trip.id,
          origin: trip.origin,
          destination: trip.destination,
          date,
          departs: trip.departs,
          farePesewas: trip.farePesewas,
          seatsLeft: Math.max(0, trip.seatsTotal - occupied),
        };
      }));

      return asText({
        ok: true,
        trips: availableTrips,
        ...(availableTrips.length === 0 ? { note: "No trips on that route and date. Offer another date or route." } : {}),
      });
    },
  );

  //Tool for holding a seat on a trip for 10 minutes after selection
  //2.hold_seat
  server.registerTool(
    "hold_seat",
    {
      title: "Hold Seat",
      description: "Hold one seat on a trip for 10 minutes after the passenger selects a trip.",
      inputSchema: {
        trip_id: z.string().min(1),
        passenger_phone: z.string().trim().min(8).max(20),
      },
    },
    async ({ trip_id, passenger_phone }) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const result = await prisma.$transaction(async (tx) => {
            const now = new Date();
            await tx.booking.deleteMany({
              where: { status: { not: BookingStatus.CONFIRMED }, expiresAt: { lte: now } },
            });
            const trip = await tx.trip.findUnique({ where: { id: trip_id } });
            if (!trip) return { error: bookingError("TRIP_NOT_FOUND", "The selected trip does not exist.", "Search for trips again and use an ID from the results.") };

            const occupied = await tx.booking.findMany({
              where: { tripId: trip.id },
              select: { seatNo: true },
            });
            const takenSeats = new Set(occupied.map(({ seatNo }) => seatNo));
            let seatNo = 1;
            while (seatNo <= trip.seatsTotal && takenSeats.has(seatNo)) seatNo += 1;
            if (seatNo > trip.seatsTotal) {
              return { error: bookingError("SOLD_OUT", "There are no seats left on this trip.", "Offer another departure or date.") };
            }

            const booking = await tx.booking.create({
              data: {
                tripId: trip.id,
                seatNo,
                passengerPhone: passenger_phone,
                expiresAt: new Date(now.getTime() + HOLD_MINUTES * 60_000),
              },
            });
            return { booking, farePesewas: trip.farePesewas };
          }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

          if ("error" in result && result.error !== undefined) return asError(result.error);
          return asText({
            ok: true,
            hold: {
              holdId: result.booking.id,
              tripId: result.booking.tripId,
              seatNo: result.booking.seatNo,
              phone: result.booking.passengerPhone,
              expiresAt: result.booking.expiresAt.toISOString(),
            },
            farePesewas: result.farePesewas,
          });
        } catch (error) {
          if (!isRetryableDatabaseError(error) || attempt === 2) throw error;
        }
      }
      throw new Error("Seat reservation retry limit reached.");
    },
  );

  //Tool for creating a Paystack payment link for an active seat hold
  //3.create_payment_link
  server.registerTool(
    "create_payment_link",
    {
      title: "Create Payment Link",
      description: "Create a Paystack payment link for an active seat hold.",
      inputSchema: {
        hold_id: z.string().min(1),
        email: z.string().email(),
      },
    },
    async ({ hold_id, email }) => {
      const booking = await prisma.booking.findUnique({ where: { id: hold_id }, include: { trip: true } });
      if (!booking || booking.status !== BookingStatus.HELD) {
        return asError(bookingError("HOLD_NOT_FOUND", "No active seat hold was found.", "Search for trips and hold a seat again."));
      }
      if (booking.expiresAt <= new Date()) {
        await prisma.booking.deleteMany({ where: { id: booking.id, status: BookingStatus.HELD } });
        return asError(bookingError("HOLD_EXPIRED", "The 10-minute seat hold has expired.", "Search for trips and hold an available seat again."));
      }
      if (!process.env.PAYSTACK_SECRET_KEY) {
        return asError(bookingError("PAYMENT_NOT_CONFIGURED", "Online payment is not available right now.", "Ask the passenger to try later or contact staff."));
      }

      const paymentReference = `seatline_${booking.id}_${randomUUID()}`;
      const publicBaseUrl = process.env.PUBLIC_BASE_URL;
      if (!publicBaseUrl) throw new Error("PUBLIC_BASE_URL is not configured.");
      try {
        const payment = await initializePayment({
          email,
          amountPesewas: booking.trip.farePesewas,
          reference: paymentReference,
          callbackUrl: `${publicBaseUrl.replace(/\/$/, "")}/payment/callback`,
          bookingId: booking.id,
        });
        const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60_000);
        const updated = await prisma.booking.updateMany({
          where: { id: booking.id, status: BookingStatus.HELD, expiresAt: { gt: new Date() } },
          data: { status: BookingStatus.PAYMENT_PENDING, paymentReference, expiresAt },
        });
        if (updated.count === 0) {
          return asError(bookingError("HOLD_EXPIRED", "The seat hold expired while preparing payment.", "Do not use the payment link; search and hold a seat again."));
        }
        return asText({
          ok: true,
          payment_url: payment.authorization_url,
          payment_reference: payment.reference,
          amountPesewas: booking.trip.farePesewas,
          expiresAt: expiresAt.toISOString(),
        });
      } catch (error) {
        console.error("Paystack payment initialization failed:", error);
        return asError(bookingError("PAYMENT_INITIALIZATION_FAILED", "Could not create a Paystack payment link.", "Retry once; if the problem continues, contact staff.", true));
      }
    },
  );

  //Tool for verifying a Paystack payment and confirming the associated booking
  //4.verify_payment
  server.registerTool(
    "verify_payment",
    {
      title: "Verify Payment",
      description: "Verify a Paystack transaction server-side and confirm the associated booking.",
      inputSchema: { payment_reference: z.string().min(1) },
    },
    async ({ payment_reference }) => {
      try {
        const result = await confirmPayment(payment_reference);
        if (result.error) return asError(result.error);
        const booking = result.booking;
        if (!booking) throw new Error("Confirmed booking result is missing.");
        return asText({
          ok: true,
          confirmed: true,
          ticket_reference: booking.ticketReference,
          booking: {
            tripId: booking.tripId,
            origin: booking.trip.origin,
            destination: booking.trip.destination,
            date: booking.trip.travelDate.toISOString().slice(0, 10),
            departs: booking.trip.departs,
            seatNo: booking.seatNo,
            passengerPhone: booking.passengerPhone,
          },
        });
      } catch (error) {
        console.error("Paystack verification failed:", error);
        return asError(bookingError("PAYMENT_FAILED", "Could not verify the payment with Paystack.", "Wait briefly and retry verification.", true));
      }
    },
  );

  //Tool for looking up a confirmed booking using its ticket reference and passenger phone
  //5.get_booking
  server.registerTool(
    "get_booking",
    {
      title: "Get Booking",
      description: "Look up a confirmed booking using both its ticket reference and passenger phone.",
      inputSchema: {
        ticket_reference: z.string().min(1),
        passenger_phone: z.string().trim().min(8).max(20),
      },
    },
    async ({ ticket_reference, passenger_phone }) => {
      const booking = await prisma.booking.findFirst({
        where: {
          ticketReference: { equals: ticket_reference, mode: "insensitive" },
          passengerPhone: passenger_phone,
          status: BookingStatus.CONFIRMED,
        },
        include: { trip: true },
      });
      if (!booking) {
        return asError(bookingError("BOOKING_NOT_FOUND", "No confirmed booking matched those details.", "Check the ticket reference and phone number, or contact staff."));
      }
      return asText({
        ok: true,
        ticket_reference: booking.ticketReference,
        booking: {
          origin: booking.trip.origin,
          bookingStatus: booking.status,
          destination: booking.trip.destination,
          date: booking.trip.travelDate.toISOString().slice(0, 10),
          departs: booking.trip.departs,
          seatNo: booking.seatNo,
          passengerPhone: booking.passengerPhone,
        },
      });
    },
  );

  return server;
}
