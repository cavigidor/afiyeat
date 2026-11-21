// Test fixture for the schema proposals. In-process Postgres only: never connects to Supabase or Lovable.
// Baseline: main's migrations (nine repaired per lib/repairs.json), then the integration stack's
// five pending migrations from STACK_REF, which Schema A depends on.
import { buildDatabase } from '../../lib/migrations.mjs';
export const STACK_REF = process.env.E0_STACK_REF ?? 'origin/stack/14-photo-records-owner-check';
export const MAIN_REF = process.env.E0_MAIN_REF ?? 'origin/main';
export const fixture = () => buildDatabase({ mainRef: MAIN_REF, stackRef: STACK_REF });
