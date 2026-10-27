# Seatline Booking Agent

A WhatsApp seat-booking agent built on [Chord](https://www.chordhq.xyz). It turns a seat request into a **paid, confirmed ticket** without staff, and it only confirms a seat when Paystack has verified the payment.

> Fictional business, made-up routes and fares, Paystack test mode only.

## The problem

Seatline Shuttles runs fixed-route trips and takes bookings on WhatsApp. Staff check availability by hand, collect Mobile Money screenshots, and confirm seats manually. That causes slow replies out of hours, double-booked seats, forgeable payment proof, and seats held and never released.

The gap is between **seat inventory** and **verified payment**. This agent closes it.

## What it does / does not do

| Does | Does not (hands off to a human) |
|---|---|
| Finds trips by route and date | Refunds and cancellations |
| Holds a seat for 10 minutes | Group bookings |
| Sends a Paystack payment link | Price negotiation |
| Verifies payment with Paystack | General questions outside booking |
| Issues a ticket reference | |

## Architecture

```
WhatsApp simulator -> Chord teammate (skill files)
                         | MCP (Streamable HTTP, bearer)
                         v
              Express MCP server (this repo)
                |                       ^
                v                       | webhook (HMAC-SHA512)
        Neon Postgres (Prisma)     Paystack (test mode)
```

## Key decisions

- **Express over NestJS:** smallest surface for a time-boxed build.
- **Stateless MCP over Streamable HTTP:** survives restarts, no session store.
- **Database-enforced seat integrity:** `UNIQUE(trip_id, seat_no)` inside a transaction.
- **Lazy hold expiry:** no cron, holds past `expires_at` count as free.
- **Paystack verify is the source of truth;** the webhook is a backup.
- **Integer pesewas** for all money.

## Tools

| Tool | Purpose |
|---|---|
| `find_trips` | Search trips by origin, destination, date |
| `hold_seat` | Reserve a seat for 10 minutes |
| `create_payment_link` | Initialize a Paystack transaction |
| `verify_payment` | Verify with Paystack, confirm the booking, issue the ticket |
| `get_booking` | Look up a booking (reference + phone must match) |

Errors return `{ ok: false, code, retryable, next_action }` so the agent can recover.

## Run locally

```bash
cp .env.example .env
npm install
npm run db:push
npm run db:seed
npm run dev
```

Set `DATABASE_URL` to a PostgreSQL connection string, `PAYSTACK_SECRET_KEY` to a Paystack test secret, `MCP_BEARER_TOKEN` to a long random token, and `PUBLIC_BASE_URL` to the public HTTPS origin of this server. `PORT` defaults to `3000`. Never use a real payment key for local/demo testing.

The Paystack webhook endpoint is `POST /webhooks/paystack`; configure it in the Paystack dashboard. `GET /health` is a liveness check and does not check database connectivity. The MCP endpoint is `POST /mcp` and requires `Authorization: Bearer <MCP_BEARER_TOKEN>`.

## Deploy (Render)

Build command: `npm run build`. Start command: `npm start`. Health-check path: `/health`. Set the environment variables listed above in the hosting provider's secret manager and expose the webhook over HTTPS.

## Connect to Chord

Set `MCP_SERVER_URL`, `MCP_BEARER_TOKEN`, `CHORD_API_TOKEN`, `CHORD_REGISTER_ENDPOINT`, `CHORD_ASSIGN_ENDPOINT`, and `CHORD_TEAMMATE_ID`, then run `bash scripts/register-chord.sh`. The script health-checks the server, registers only the five booking tools, and assigns the resulting server ID to the teammate. The two Chord endpoint variables must be the API endpoints for your workspace; the script expects the registration response to contain an `id` or `server.id`.

## Test the full conversation

Happy path: search Accra to Kumasi on a seeded date, choose a departure, hold a seat, create a payment link, complete the Paystack test payment, then verify using the returned payment reference. Confirm that a ticket reference is returned only after verification. For a failure path, select a fully occupied trip or attempt to pay after a hold expires; the tool returns a structured error with a safe next action.

## Status

| Item | Status |
|---|---|
| MCP server and tools | Implemented |
| Paystack integration and failure paths | Implemented (test-mode wiring; requires credentials) |
| Skill published | Local skill files ready for Chord |
| Simulator conversation | Not included |

## How I used AI tools

AI assistance was used to scaffold the service layout and implementation. The Prisma schema, tool flow, validation paths, and documentation should be reviewed against the operator's production requirements before go-live. Run `npm run build` and the test-mode payment flow before deployment.

## Known limitations

Refunds, cancellations, group bookings, a staff admin UI, background hold cleanup, database-backed readiness checks, and proactive WhatsApp notifications are not implemented. Expired holds are cleaned lazily on availability/hold operations.

## Further reading

- [Problem statement](docs/problem-statement.md)
- [Deployment field notes](docs/field-notes.md)
- [Go-live note](docs/go-live-note.md)