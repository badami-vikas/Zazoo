/**
 * VOCAB3 compatibility for the independently deployed Helpdesk Supabase schema.
 * Version 1 is read/write wire compatibility only; application contracts stay
 * canonical. Remove after every supported deployment reports the Organization
 * schema and the old table/column no longer contain rows.
 */
export const HELP_DESK_ORGANIZATIONS_TABLE = "helpdesk_workspaces";
export const ORGANIZATION_ID_COLUMN = "workspace_id";
