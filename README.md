# Afiyeat

Save the restaurants you want to try and the ones you've loved, see them on your own map, keep lists and recipes, and share them with friends.

- **Website:** https://afiyeat.com, built and published from [Lovable](https://lovable.dev).
- **iPhone app:** the same React app wrapped with Capacitor 8 (`ios/`).
- **Backend:** Supabase via Lovable Cloud: Postgres with row-level security, Auth, Storage and Edge Functions (`supabase/`).

## Where to look

| Need | Go to |
|---|---|
| How the code is organised, the rules, the roadmap | [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md) |
| Shipping a release to the App Store | [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md) |
| Testing on a phone before release | [`docs/USER_TEST_CHECKLIST.md`](docs/USER_TEST_CHECKLIST.md) |
| App Store text, review notes, privacy answers | `docs/APP_STORE_METADATA.md`, `docs/APP_REVIEW_NOTES.md`, `docs/APP_PRIVACY_LABELS.md` |

## Working on it

```sh
npm install
npm run dev          # website at http://localhost:8080
npm run typecheck    # the real type check (the root tsconfig checks nothing)
npm run build        # production build into dist/
```

**iPhone app:**
```sh
npm run build && npx cap sync ios
npx cap open ios     # then Run in Xcode
```

**Database changes** are new files in `supabase/migrations/`, applied by pasting the SQL into Lovable exactly as written. Never edit `src/integrations/supabase/types.ts` by hand; Lovable regenerates it.

**Pushing:**
```sh
git pull --no-rebase --no-edit && git push
```
