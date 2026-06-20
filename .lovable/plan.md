# Turn Afiyeat into a Native Mobile App (Capacitor)

Afiyeat stays the same React web app, but we wrap it with Capacitor so it can be built and published to the Apple App Store and Google Play with full access to native phone features (camera, contacts, notifications, etc.).

## What I'll do

1. **Install Capacitor packages**
   - `@capacitor/core`, `@capacitor/ios`, `@capacitor/android`
   - `@capacitor/cli` (dev dependency)

2. **Create `capacitor.config.ts`** in the project root with:
   - `appId`: `app.lovable.3d2b473654fe4bd39ad75de7fdca9ad2`
   - `appName`: `afiyeat`
   - `webDir`: `dist`
   - A `server.url` pointing at the live sandbox preview so the app hot-reloads from Lovable while you develop:
     ```
     https://3d2b4736-54fe-4bd3-9ad7-5de7fdca9ad2.lovableproject.com?forceHideBadge=true
     ```
     with `cleartext: true`.

3. **Confirm the build output** works for native (`webDir: dist`, Vite build).

That's the core setup. After this is in place, you run a few commands locally to put it on a real device or emulator (details below).

## Running on a device (you do this locally, after the setup)

Capacitor needs native build tools that only exist on your own machine:
- **iOS** requires a Mac with **Xcode**.
- **Android** requires **Android Studio**.

Steps once the setup above is committed:
1. Export the project to your own GitHub repo (the "Export to GitHub" button) and `git pull` it.
2. `npm install`
3. Add platforms: `npx cap add ios` and/or `npx cap add android`
4. `npx cap update ios` / `npx cap update android`
5. `npm run build`
6. `npx cap sync`
7. `npx cap run ios` or `npx cap run android`

Each time you pull new changes from Lovable, re-run `npm run build` and `npx cap sync`.

## Optional native features to consider (not in this first step)

These can be added later as separate requests, each pulling in a Capacitor plugin and a small amount of code:
- **Contacts** — your memory already references a Capacitor contacts integration for finding friends; we can wire it up natively.
- **Sign in with Apple** — recommended/required for App Store apps that have social login.
- **Push notifications**, **camera** for restaurant photos, **geolocation** for the Mapbox proximity features.

If you want any of these in this first pass, tell me and I'll fold them into the build.

## Technical notes

- The hot-reload `server.url` means the native shell loads your live Lovable preview. For a production store build you'll later remove/replace `server.url` so the app ships the bundled `dist` assets instead.
- No changes to existing app logic, routes, auth, or backend are required for this setup.
- Auth redirect URLs (Google/Apple OAuth) may need a native deep-link scheme added later when you wire up store builds; I'll handle that when we get to publishing.

After you approve, I'll install Capacitor and add the config, then point you to the blog post on native mobile development with Lovable.
