# Attribution

This repository contains an extraction of the **BOS (Bridge Orchestration Service)
payout subsystem** from the CineX project, published standalone as `payout-rail`.

## Source project

- **Origin repo:** `https://github.com/OmenaiVIC/CineX.git`
- **Origin commit (extraction source):** `8985b4142be4e12b845098d7485b048b26222e04`
- **License:** MIT — Copyright (c) 2026 Victor Omenai (see `LICENSE`)

## What was extracted

The following tree was copied from `backend/` and adapted for standalone operation:

- `src/services/bos/*` — BOS state machine, workers, adapters, guards, actions, monitoring
- `src/routes/bosMonitoring.js`, `src/routes/webhooks.js`
- `src/config/chainConfig.js` (renamed from `backend/src/config/chain.js`; env names rewritten to `PAYOUT_*`)
- `migrations/001_bos_schema.sql`, `002_bos_monitoring.sql`, `003_payout_gates.sql`,
  `004_bos_e2e.sql` (copied from `backend/src/migrations/006_bos_schema.sql` and
  `009_bos_e2e.sql` and adapted; see `EXTRACTION_REPORT.md`)

## Originating files in CineX (for cross-reference)

All BOS code originates from files under `backend/src/services/bos/`,
`backend/src/routes/`, `backend/src/config/chain.js`,
`backend/src/migrations/006_bos_schema.sql`, and `backend/src/migrations/009_bos_e2e.sql`
in the origin commit listed above.

## License notice

Per the MIT license terms of the source material, this notice is reproduced in both
`LICENSE` and the file header comments of copied sources. Derivative additions
(new files written for the extraction — `src/database.js`, `src/index.js`,
`src/services/bos/RecipientRegistry.js`, `package.json`, this file, and the
extraction report) carry the same MIT license.