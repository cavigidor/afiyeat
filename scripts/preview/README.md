# Demo preview (Lists V2 development)

A click-through build of the real app with an in-browser fake backend (`src/demo/`), for checking screens
at iPhone widths and for tapping through on a phone. It is **not** the app: no request leaves the
browser, data lives in this browser's storage only, and a "DEMO" marker shows on every screen.

```sh
npm run build:demo          # -> dist-demo/ (relative paths; hash routing)
npm run preview:shots       # screenshots at 320 and 390 pt into preview-shots/
```

`?reset` on the URL, or the Reset button, restores the starting data.

What is real: every page, component, query and save path of the app. What is stood in: Supabase
(PostgREST subset, auth, storage, RPC and Edge Function answers in `src/demo/backend.ts`), Apple Maps
search (a few invented places in `src/demo/places.ts`) and the map itself (`src/demo/fakeMapKit.ts`,
a grid with real pins). Row-level security is not emulated, so privacy is tested elsewhere (e0/ and
the isolated backend), never here.

Production builds are unchanged: the demo client is only aliased in `--mode demo` (vite.config.ts).
