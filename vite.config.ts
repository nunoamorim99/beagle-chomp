import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { writeFileSync } from "node:fs";
import { resolve, normalize } from "node:path";

// NOTE: the character editor (editor/index.html + src/editor/*) is DEV-ONLY by
// construction: `vite` dev serves any root-level .html (so /editor/ works with no
// config), while `vite build` bundles only the rollup inputs — which default to
// index.html alone. Do NOT add editor/index.html to rollupOptions.input, or it
// (and lil-gui) would ship to players and land in the PWA precache.

// IDEA-032: a DEV-ONLY save-to-file endpoint for the editor's export surfaces.
// `configureServer` only runs under `vite` (the dev server) — it is NOT part of
// the production build, so this middleware can never reach the shipped PWA. It
// writes the exact source files the three editor modes generate, and NOTHING
// else: the target path is whitelisted against a fixed allow-list, so a
// malformed/hostile request can't write outside these three files (defends the
// dev box even though the editor is local-only). This replaces the copy-paste
// "paste in the right place" footgun that shipped a broken beagle
// (editor-residue-hazard) — the editor now writes the whole file itself.
const EDITOR_SAVABLE_FILES = [
  "src/render/characters.ts",
  "src/game/themes.ts",
  "src/game/props.ts",
] as const;

function editorSaveFile(): Plugin {
  const projectRoot = normalize(resolve());
  return {
    name: "editor-save-file",
    apply: "serve", // dev server only — never in `vite build`
    configureServer(server) {
      server.middlewares.use("/__save-file", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("POST only");
          return;
        }
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          try {
            const { path: relPath, contents } = JSON.parse(body) as { path?: string; contents?: string };
            if (typeof relPath !== "string" || typeof contents !== "string") {
              res.statusCode = 400;
              res.end("bad payload");
              return;
            }
            // Whitelist + containment: the requested path must be one of the
            // three known editor targets AND resolve inside the project root.
            const allowed = (EDITOR_SAVABLE_FILES as readonly string[]).includes(relPath);
            const abs = normalize(resolve(projectRoot, relPath));
            if (!allowed || !abs.startsWith(projectRoot)) {
              res.statusCode = 403;
              res.end("path not allowed");
              return;
            }
            writeFileSync(abs, contents, "utf-8");
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, path: relPath }));
          } catch (err) {
            res.statusCode = 500;
            res.end(String(err));
          }
        });
      });
    },
  };
}

export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      output: {
        // Split three.js into its own vendor chunk. It's the bulk of the
        // bundle and changes far less often than our game code, so isolating
        // it lets the browser keep three.js cached across app updates (only
        // the small app chunk re-downloads when we ship a change). Also clears
        // the >500 kB single-chunk size warning by separating the two.
        manualChunks: {
          three: ["three"],
        },
      },
    },
  },
  plugins: [
    editorSaveFile(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon-32.png", "favicon-180.png", "icons/*.png"],
      manifest: {
        name: "Beagle Chomp",
        short_name: "BeagleChomp",
        description: "Guide the beagle, munch the biscuits, dodge the ghosts.",
        theme_color: "#0b0b16",
        background_color: "#0b0b16",
        display: "standalone",
        orientation: "any",
        start_url: "./",
        scope: "./",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        // precache the whole app so it plays fully offline once installed
        globPatterns: ["**/*.{js,css,html,png,svg,woff2,glb,gltf,mp3,ogg}"]
      },
      devOptions: { enabled: true }
    })
  ]
});
