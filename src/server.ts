import "dotenv/config";
import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import cron from "node-cron";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { processPaystackEvent, createMcpServer } from "./mcp/tools.js";
import { isValidWebhookSignature } from "./lib/paystack.js";

//Port and token validation
const PORT = Number(process.env.PORT ?? 3000);
const TOKEN = process.env.MCP_BEARER_TOKEN;
if (!TOKEN) throw new Error("MCP_BEARER_TOKEN is not set in the environment.");
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error("PORT must be a valid TCP port.");

const app = express();

//Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});


//Paystack webhook endpoint
app.post(
  "/webhooks/paystack",
  express.raw({ type: "application/json", limit: "256kb" }),
  async (req: Request, res: Response) => {
    if (!Buffer.isBuffer(req.body)) {
      res.status(400).json({ ok: false, error: "Expected a JSON request body." });
      return;
    }
    if (!isValidWebhookSignature(req.body, req.header("x-paystack-signature"))) {
      res.status(401).json({ ok: false, error: "Invalid webhook signature." });
      return;
    }

    let payload: { event?: unknown; data?: { reference?: unknown } };
    try {
      payload = JSON.parse(req.body.toString("utf8")) as typeof payload;
    } catch {
      res.status(400).json({ ok: false, error: "Invalid JSON payload." });
      return;
    }
    if (payload.event !== "charge.success" || typeof payload.data?.reference !== "string") {
      res.status(200).json({ ok: true, ignored: true });
      return;
    }

    try {
      const result = await processPaystackEvent(payload.data.reference);
      if (result.error) {
        console.warn("Paystack event could not confirm a booking:", result.error.code);
      }
      res.status(200).json({ ok: true });
    } catch (error) {
      console.error("Paystack webhook processing failed:", error);
      res.status(500).json({ ok: false, error: "Webhook processing failed." });
    }
  },
);

//Middleware to parse JSON bodies for the MCP endpoint, with a limit of 1MB
app.use(express.json({ limit: "1mb" }));

//Bearer token authentication middleware for the MCP endpoint
function requireBearer(req: Request, res: Response, next: NextFunction) {
  const received = req.header("authorization") ?? "";
  const expected = `Bearer ${TOKEN}`;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    });
    return;
  }
  next();
}

//MCP endpoint
//@route POST /mcp
app.post("/mcp", requireBearer, async (req: Request, res: Response) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request failed:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal Server Error" },
        id: null,
      });
    }
  }
});

const methodNotAllowed = (_req: Request, res: Response) => {
  res.status(405).set("Allow", "POST").json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method Not Allowed" },
    id: null,
  });
};

app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

app.get("/payment/callback", (_req: Request, res: Response) => {
  res.status(200).send("Payment received. Return to the booking assistant to verify your ticket.");
});

app.listen(PORT, () => {
  console.log(`Seatline MCP server listening on port ${PORT}`);

  const baseUrl = process.env.RENDER_EXTERNAL_URL ?? `http://127.0.0.1:${PORT}`;
  const healthUrl = new URL("/health", baseUrl);

  cron.schedule(
    "*/13 * * * *",
    async () => {
      try {
        const response = await fetch(healthUrl, {
          signal: AbortSignal.timeout(8_000),
          headers: { "x-ping-source": "seatline-keep-alive" },
        });
        await response.body?.cancel();
        if (response.ok) {
          console.log(`Keep-alive ping succeeded: ${response.status}`);
        } else {
          console.warn(`Keep-alive ping returned HTTP ${response.status}`);
        }
      } catch (error) {
        console.error("Keep-alive ping failed:", error);
      }
    },
    { noOverlap: true },
  );
});
