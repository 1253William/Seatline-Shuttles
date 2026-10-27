# Go-live note

This repository is a test-mode demonstration, not authorization to accept live payments. Before a production launch:

- Confirm routes, fares, seat capacity, customer terms, and data-retention requirements with the operator.
- Provision production PostgreSQL, secure backups, and deploy using TLS.
- Configure and verify production Paystack credentials and the signed webhook URL.
- Set a strong `MCP_BEARER_TOKEN`; limit tool access and verify the Chord teammate's configuration.
- Run end-to-end payment tests, including pending, failed, duplicate webhook, expired hold, and successful payment cases.
- Agree on staff ownership for payment disputes, refunds, cancellations, and customer privacy requests.
- Add monitoring, alerting, an incident-response procedure, and a tested rollback/migration plan.

Do not switch to live credentials until these checks and the operator's approval are complete.
