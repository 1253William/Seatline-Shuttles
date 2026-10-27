# Deployment field notes

## Local setup

1. Use Node.js 20 or later and PostgreSQL (Neon is suitable).
2. Copy `.env.example` to `.env`; provide `DATABASE_URL`, `PAYSTACK_SECRET_KEY` (test key), `MCP_BEARER_TOKEN`, and `PUBLIC_BASE_URL`.
3. Run `npm install`, `npm run db:push`, and `npm run db:seed`.
4. Start with `npm run dev`. `GET /health` checks liveness; `POST /mcp` requires a bearer token.

The application uses Prisma against PostgreSQL. `DATABASE_URL` can include the provider's recommended pooled connection string; for schema changes use a direct connection if required by the provider.

## Paystack

- Use Paystack test credentials until live payment processing has been explicitly approved.
- Configure the Paystack webhook destination as `PUBLIC_BASE_URL/webhooks/paystack`.
- The webhook must be publicly reachable over HTTPS. The raw request body is used to validate Paystack's HMAC-SHA512 signature.
- Treat the return/callback URL as user experience only; call `verify_payment` to confirm payment.

## Hosting

Use `npm run build` as the build command, `npm start` as the start command, and `/health` as the health-check path. Set all runtime variables from `.env.example` in the host's secret manager; never commit `.env` or test/live secret keys.

## Operational cautions

- Back up PostgreSQL and restrict its network access.
- Use a long, unique MCP bearer token and rotate it if exposed.
- Monitor server errors and Paystack webhook delivery. The webhook handler is idempotent for a payment reference.
- Add migrations and a controlled release process before changing a production schema.
- This sample does not provide refund processing, a staff admin UI, or proactive WhatsApp notifications.
