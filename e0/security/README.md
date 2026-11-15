# Security verification packages (E0-b)

Nothing here has been run against production or any hosted project. Every hosted script refuses without the
PM's approval file (`../lib/approved-target.mjs`).

## Owner check on statuses and categories

1. **Production, read-only:** `owner-check-verification.sql`, queries V0 to V6, run through Lovable one at a time
   by a separately authorized operator. Policy text, flags, privileges and counts only.
2. **Isolated project, two test accounts:** `owner-check.isolated.mjs --expect gap`, then `--expect fixed` after the
   fix is applied there (separate authorization).
3. The fix itself is an independent security draft: `owner-policy/` on its own branch and PR (see its README).

How to read V1 and V4 (corrected 2026-11-15):

* **V1** is read in full, not searched for words. Postgres ORs permissive policies, so one permissive policy that
  admits a foreign list keeps the gap open, whatever the others say.
* **V4 counts are integrity anomalies, not proof of exploitation.** A row whose owner differs from its list's
  owner can come from an old app bug, a data repair, an account merge, a changed list owner or a flow not yet
  identified; interpreting it needs row history that these queries deliberately do not read. Zero is not proof
  that the gap was never used either. Nothing is deleted or changed on the strength of these counts.

## Restaurants, moderation grants and Realtime

`production-diagnostics.sql`, queries P0 to P11, for the same separately authorized operator. All rehearsed
read-only on the reconstruction (main + stack); results there:

| Query | What it answers | Reconstruction (to be compared with production) |
| --- | --- | --- |
| P1-P3 | RLS flags, complete policies, table privileges of anon / authenticated / PUBLIC | RLS on everywhere; anon holds table privileges by default grants, so RLS alone decides |
| P4 | Column privileges on `restaurants` | none: a readable row is readable in every column, `details` included |
| P5 | Every function a policy calls (from `pg_depend`, not text) and who may execute it | the restrictive moderation policy calls `is_moderator()`, which anon cannot execute; that is the only reason signed-out reads of `restaurants` fail. `has_role(text)` is executable by anon |
| P6-P7 | Moderation helpers' flags and complete definitions | for reading who is a moderator and what `moderation_decide` may change |
| P8-P9 | Realtime publication membership and `realtime.messages` policies | no table is published in the reconstruction (no migration adds one); production may differ through Lovable or the dashboard |
| P10 | Integrity anomaly counts (photo owner vs place owner, orphans, role assignments) | 0 (empty reconstruction) |
| P11 | Which tables clients subscribe to, counts only | not present locally |

Interpretation rules: configuration, not behaviour. Behaviour is confirmed only by the signed-out / follower /
stranger / blocked tests in the isolated project with real Auth, the API and Storage, and on a physical device.
Counts are anomalies, not proof of exploitation.
