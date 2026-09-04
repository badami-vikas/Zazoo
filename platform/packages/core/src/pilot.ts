/**
 * The single pilot Organization. Bridge is single-tenant until multi-tenancy
 * lands (decisions-log 2026-07-05 "single-tenant safety net"): every
 * Organization-scoped call carries this id and the server rejects any other
 * with FORBIDDEN. One declaration, shared by the API and the web client, so
 * the two can never drift apart silently.
 */
export const PILOT_ORGANIZATION = "b0000000-0000-4000-a000-000000000001";
