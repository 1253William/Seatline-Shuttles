#!/usr/bin/env bash
set -euo pipefail

required_vars=(MCP_SERVER_URL MCP_BEARER_TOKEN CHORD_API_TOKEN CHORD_REGISTER_ENDPOINT CHORD_ASSIGN_ENDPOINT CHORD_TEAMMATE_ID)
for name in "${required_vars[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    printf 'Missing required environment variable: %s\n' "$name" >&2
    exit 1
  fi
done

command -v curl >/dev/null || { echo "curl is required." >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required." >&2; exit 1; }

base_url="${MCP_SERVER_URL%/}"
curl --fail-with-body --silent --show-error "${base_url}/health" >/dev/null

registration="$(jq -n \
  --arg name "Seatline Shuttles" \
  --arg url "${base_url}/mcp" \
  --arg token "$MCP_BEARER_TOKEN" \
  '{
    name: $name,
    url: $url,
    transport: "streamable-http",
    authentication: { type: "bearer", token: $token },
    enabled_tools: [
      "find_trips",
      "hold_seat",
      "create_payment_link",
      "verify_payment",
      "get_booking"
    ]
  }')"

response="$(curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer ${CHORD_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$registration" \
  "$CHORD_REGISTER_ENDPOINT")"
server_id="$(jq -er '.id // .server.id' <<<"$response")"

assignment="$(jq -n \
  --arg teammate_id "$CHORD_TEAMMATE_ID" \
  --arg server_id "$server_id" \
  '{teammate_id: $teammate_id, mcp_server_id: $server_id}')"
curl --fail-with-body --silent --show-error \
  -X POST \
  -H "Authorization: Bearer ${CHORD_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$assignment" \
  "$CHORD_ASSIGN_ENDPOINT" >/dev/null

printf 'Registered Seatline server (%s) and assigned it to teammate %s.\n' "$server_id" "$CHORD_TEAMMATE_ID"
