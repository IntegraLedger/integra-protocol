/**
 * The settler: an x402 facilitator, `GET /supported`, `POST /verify` and `POST /settle` over `node:http`, on x402's
 * facilitator class, with one module per configured chain form. It checks a payment against its requirements and its
 * pairing's profile, asks the configured node to validate or simulate, submits what the payer signed, records each
 * instrument once in Postgres, and answers what the chain shows.
 */
import { serveSettler, type SettlerConfig } from "./core.js";
import { MODULES, type ModulesConfig } from "./modules/index.js";

export type { FeeBudgetConfig } from "./core.js";

/** The settler's configuration: the core's members, and each module's own member, named for the module. */
export type ProfileFacilitatorConfig = SettlerConfig & ModulesConfig;

/** Starts the settler; `close` stops it and closes what it opened. */
export function serveProfileFacilitator(c: ProfileFacilitatorConfig): Promise<{ close(): Promise<void> }> {
  return serveSettler(c, MODULES);
}
