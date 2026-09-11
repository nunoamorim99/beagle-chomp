// OWNER: backend / tooling (IDEA-051)
//
// The ADMIN PORTAL's build. Deliberately a second, separate Vite config rather
// than another rollup input on the main one.
//
// Why separate, and not `rollupOptions.input: { game, admin }`:
//   * A shared build would put admin code in the players' bundle and, worse,
//     into the PWA precache — the exact thing vite.config.ts's header warns
//     about for /editor/. The dashboard reads every player's statistics; it has
//     no business being downloaded by every player.
//   * The portal must NOT be a PWA. It is an operator tool on a desk, not an
//     installable game, and a service worker caching a metrics dashboard would
//     serve yesterday's numbers with no obvious way to tell.
//   * STACK.md §1: a frontend is never served from the VPS. This builds to its
//     own directory and deploys as a SECOND Cloudflare Pages project pointed at
//     `dist-admin`, on its own subdomain — which is what makes Cloudflare Access
//     available in front of it as a second lock.
//
// `admin/index.html` also sits at the repo root, so `npm run dev` serves it at
// /admin/ with no config at all — same construction as /editor/ and /preview/.
// It is NOT an input to the game's build, so it can never ship to players.
//
// Remember to add the portal's origin to CORS_ORIGINS in Dokploy, or every
// panel will fail with a CORS error that looks like an auth bug.

import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(__dirname, "admin"),
  // Vite looks for .env files in `envDir`, which DEFAULTS TO `root` — so without
  // this it reads `admin/.env`, which does not exist, and the portal comes up
  // saying "VITE_API_URL is not set" with no way to reach the API. The deployed
  // build is unaffected (Cloudflare Pages supplies the variable through the
  // environment, and Vite picks VITE_-prefixed vars up from there), which is
  // exactly why this stayed invisible: it breaks only `npm run dev:admin`, the
  // one path nobody exercises after the portal is live.
  envDir: __dirname,
  // The app source lives in src/admin/, outside the Vite root, so the root
  // tsconfig typechecks it with everything else rather than needing its own.
  resolve: { alias: { "/src": resolve(__dirname, "src") } },
  // Relative, like the game's: a Pages deploy works from any path.
  base: "./",
  publicDir: false,
  build: {
    outDir: resolve(__dirname, "dist-admin"),
    emptyOutDir: true,
    // No manualChunks: this app has no three.js and no large vendor to split.
    // It is a few KB of hand-written SVG and fetch calls, on purpose.
  },
  server: {
    port: 5180,
    // Fail loudly rather than hopping ports — the same reasoning as the game's
    // strictPort, and here it also keeps CORS_ORIGINS predictable in dev.
    strictPort: true,
  },
});
