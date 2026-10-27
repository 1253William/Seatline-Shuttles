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

The server pings its `/health` endpoint through `RENDER_EXTERNAL_URL` every 13 minutes to reduce free-instance spin-downs. Render provides `RENDER_EXTERNAL_URL` automatically. This in-process cron can help while the service is running, but it is not an external wake-up mechanism and cannot guarantee availability if the service has already spun down. The first request after a spin-down can take about a minute. Keeping a free instance awake can consume nearly all of Render's 750 monthly free instance hours for a workspace, so use a paid instance if reliable always-on service is required.

## Connect to Chord

Set `MCP_SERVER_URL`, `MCP_BEARER_TOKEN`, `CHORD_API_TOKEN`, `CHORD_REGISTER_ENDPOINT`, `CHORD_ASSIGN_ENDPOINT`, and `CHORD_TEAMMATE_ID`, then run `bash scripts/register-chord.sh`. The script health-checks the server, registers only the five booking tools, and assigns the resulting server ID to the teammate. The two Chord endpoint variables must be the API endpoints for your workspace; the script expects the registration response to contain an `id` or `server.id`.

## Test the full conversation

Happy path: search Accra to Kumasi on a seeded date, choose a departure, hold a seat, create a payment link, complete the Paystack test payment, then verify using the returned payment reference. Confirm that a ticket reference is returned only after verification. For a failure path, select a fully occupied trip or attempt to pay after a hold expires; the tool returns a structured error with a safe next action.


## Scenario 1: Happy path (the main demo)

**Customer:** Hi, any seat to Kumasi tomorrow 6am?
**Expect:** The agent calls `find_trips`, then returns with no results for the set time date tomorrow.

**Customer:** Book me one seat in November.
**Expect:** The agent asks for a date, finds seats availability in November and asks you to choose.

**Customer:** Seat [2]. Number is 09000000000.
**Expect:** `hold_seat` runs. The agent says the seat is held for 10 minutes. `create_payment_link` runs and it sends the Paystack link.

**Customer:** (Opens the link and pays with a Paystack test card, then returns to the chat) I've paid.
**Expect:** `verify_payment` runs against Paystack. The agent confirms the payment and gives a ticket reference.

**Customer:** Can you send my booking details again?
**Expect:** `get_booking` runs. The agent repeats the trip, seat, amount and ticket reference.

## Scenario 2: No trips found

**Customer:** Any seat to Tamale tomorrow 6am?
**Expect:** The `no trips found` case. The agent says there is no such trip and offers nearby times or the routes it does serve. It does not invent a trip.

## Scenario 3: Sold out

**Customer:** One seat to Kumasi at [a fully booked time], please.
**Expect:** The `sold out` case. The agent says the trip is full and suggests the next available trip.

## Scenario 4: Seat already taken (double-booking protection)

Use two chat links, one for Customer A and one for Customer B.

**Customer A:** Hold seat [7] on the Kumasi 6am for me.
**Expect:** Seat 7 is held.

**Customer B:** I want seat [7] on the same trip.
**Expect:** The agent says seat 7 is unavailable and offers other free seats. This shows the unique constraint working.

## Scenario 5: Hold expires

**Customer:** Hold seat [9] on the Kumasi 6am. (Do not pay. Wait more than 10 minutes.)
**Customer:** Okay, I'm ready to pay now.
**Expect:** The `hold expired` case. The agent says the hold has lapsed. If the seat is still free, it offers to hold it again with a new link. If not, it offers alternatives.

## Scenario 6: Payment abandoned or pending

**Customer:** Hold seat [10]. (Open the payment link but close it without paying.)
**Customer:** I've paid.
**Expect:** `verify_payment` returns abandoned or pending. The agent does not confirm the seat. It says it can't see the payment yet, and offers to check again or send a fresh link.



## Status

| Item | Status |
|---|---|
| MCP server and tools | Implemented |
| Paystack integration and failure paths | Implemented (test-mode wiring; requires credentials) |
| Skill published | Local skill files ready for Chord |
| Simulator conversation | Not included |

## How I used AI tools

AI assistance was used for planning the project and scaffolding the project, reviewing code. Testing was handled first in Postman collections by myself, and then via Chord Chat Simulator

## Known limitations

Refunds, cancellations, group bookings, a staff admin UI, background hold cleanup, database-backed readiness checks, and proactive WhatsApp notifications are not implemented. Expired holds are cleaned lazily on availability/hold operations.

## Further reading

- [Problem statement](docs/problem-statement.md)
- [Deployment field notes](docs/field-notes.md)
- [Go-live note](docs/go-live-note.md)