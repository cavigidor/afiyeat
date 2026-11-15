# Owner check on statuses and categories

1. **Production, read-only:** `owner-check-verification.sql`, queries V0 to V6, run through Lovable one at a time.
   They return policy text, flags, privileges and counts only: no user ids, names or content.
2. **Isolated backend, two real test accounts:** `owner-check.isolated.mjs`.
   Run with `--expect gap` before the addendum is applied there, then `--expect fixed` after.
   It refuses the production project and deletes only the lists it created in that run.
3. If production shows the gap, a separate security PR and deployment plan go to the PM.
   Nothing here applies the fix or changes existing rows.
