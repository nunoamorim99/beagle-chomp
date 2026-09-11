import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
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
  // The maze pickups (bone, life bone, fruit, coin) are built here, and the
  // editor's Pickups tab edits them exactly as it edits a character.
  "src/render/board.ts",
  "src/game/themes.ts",
  "src/game/props.ts",
  // IDEA-062 v4: the Balance tab. config.ts is game-critical in a way the
  // others are not — it feeds the SERVER's plausibility bounds through
  // `npm run sync`, so a change here that is not synced makes honest runs
  // start failing SCORE_ITEM_MISMATCH in production. The editor cannot make
  // that impossible, so it makes it loud: the save button says so, and the
  // panel that follows a successful save gives the exact commands.
  "src/game/config.ts",
  // IDEA-062 v5: the World tab. The IDEA-060 garden machinery that no theme
  // palette can reach — the fence's picket geometry and the ground dressing's
  // scatter. Both expose a plain exported params object that the editor
  // rewrites in place, so the file stays the source of truth.
  "src/render/fence.ts",
  "src/render/groundDetail.ts",
] as const;

// IDEA-062: the editor's own writes must NOT trigger an HMR full reload.
//
// Every file above is in the editor page's own module graph, and nothing in
// src/ handles `import.meta.hot` — so Vite's fallback for a change to any of
// them is `full-reload`. That meant clicking Save in the Props tab silently
// destroyed every unsaved edit in the Board tab, both undo stacks, the
// camera and the selection. It is the single thing that made the editor feel
// like it was eating work, and it was doing exactly that.
//
// `handleHotUpdate` returning `[]` is Vite's documented "I handled this"
// signal: no modules to update, therefore no update and no reload.
//
// Keyed on CONTENT HASH rather than on a time window, deliberately. Under
// Docker the watcher polls at 250 ms (see `server.watch` below) and its
// latency is unbounded, so a timestamp either expires before the event
// arrives (the reload comes back and the bug is only intermittent, which is
// worse than always) or lingers long enough to swallow a genuine hand-edit.
// A hash is exact: it suppresses if and only if what is on disk is precisely
// what the editor just wrote.
//
// The cost, stated plainly: a hand-edit made in the window between the
// editor's write and the watcher's event would also be suppressed. That
// needs the two to collide within milliseconds on the same file, and the
// `[editor-save]` log line makes every suppression visible.
const EDITOR_WRITE_TTL_MS = 60_000;

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function editorSaveFile(): Plugin {
  const projectRoot = normalize(resolve());
  /** absolute path -> the hashes of the RECENT writes we made to it.
   *
   *  A LIST, not one entry, and that is load-bearing: two saves close together
   *  (a second save while the first write's watcher event is still in flight)
   *  would otherwise have the second overwrite the first's hash, and the
   *  late-arriving first event would match nothing and reload the page —
   *  exactly the data loss this plugin exists to prevent, made intermittent
   *  and therefore harder to trust than if it never worked at all. Entries are
   *  consumed on match and swept on TTL, so a write whose watcher event never
   *  arrives (an ignored path, a stopped watcher) cannot leak. */
  const editorWrites = new Map<string, { hash: string; at: number }[]>();

  function sweep(): void {
    const cutoff = Date.now() - EDITOR_WRITE_TTL_MS;
    for (const [key, recs] of editorWrites) {
      const live = recs.filter((r) => r.at >= cutoff);
      if (live.length === 0) editorWrites.delete(key);
      else editorWrites.set(key, live);
    }
  }

  return {
    name: "editor-save-file",
    apply: "serve", // dev server only — never in `vite build`
    handleHotUpdate(ctx) {
      sweep();
      const key = normalize(ctx.file);
      const recs = editorWrites.get(key);
      if (!recs || recs.length === 0) return undefined; // not ours — Vite's normal behaviour, untouched
      let onDisk: string;
      try {
        onDisk = readFileSync(key, "utf-8");
      } catch {
        return undefined; // can't confirm it's ours, so don't suppress
      }
      const hash = sha(onDisk);
      const idx = recs.findIndex((r) => r.hash === hash);
      if (idx === -1) return undefined; // content is none of ours — a real hand edit
      // Drop this hash AND every older one: the file's current content is the
      // newer write, so any still-pending event for an earlier write of ours
      // can only ever re-observe this same content.
      editorWrites.set(key, recs.slice(idx + 1));
      ctx.server.config.logger.info(`[editor-save] HMR suppressed for ${ctx.file}`);
      // Tell the editor page the write landed, so it can update its own
      // "saved to disk" chrome without a reload. Purely informational — the
      // editor already updated its in-memory source store from the bytes it
      // POSTed (src/editor/sourceStore.ts), so correctness does not depend
      // on this arriving.
      ctx.server.ws.send({ type: "custom", event: "editor:file-saved", data: { file: ctx.file } });
      return []; // no modules to update -> no HMR update, no full reload
    },
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
            // IDEA-062: keep ONE generation of backup beside every file the
            // editor overwrites. The editor has destroyed real work twice in
            // this project's history (the pasted-over beagle, and the prop
            // part edits that prompted this whole pass), and a sidecar costs
            // nothing on a dev box. It is deliberately NOT rotated: the
            // useful question is always "what did it look like before the
            // save I just regretted", and git answers everything older.
            if (existsSync(abs)) {
              try {
                writeFileSync(`${abs}.editorbak`, readFileSync(abs, "utf-8"), "utf-8");
              } catch {
                // A failed backup must never block the save the user asked
                // for — it is insurance, not a gate.
              }
            }
            writeFileSync(abs, contents, "utf-8");
            // Record what we wrote so handleHotUpdate can recognise its own
            // echo and suppress the reload (see the note above the plugin).
            editorWrites.set(abs, [...(editorWrites.get(abs) ?? []), { hash: sha(contents), at: Date.now() }]);
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
  server: {
    // Bind on all interfaces so the container's port mapping reaches the dev
    // server. Harmless on the host — Vite still prints localhost.
    host: true,
    port: 5173,
    // Fail loudly instead of hopping to 5174/5175 when the port is taken.
    //
    // This is here because of a real half-hour lost: two orphaned dev servers
    // (one ten days old) were squatting 5173 and 5175, and Vite's default
    // "just take the next port" meant nothing ever complained — you simply had
    // several copies of the game running and no idea which one you were
    // looking at. A refused start is the useful behaviour.
    strictPort: true,
    watch: {
      // Docker on Windows: file events do not cross the bind mount, so the
      // watcher has to poll or HMR silently never fires — you edit, nothing
      // happens, and it looks like your change did not work.
      //
      // Polling is genuinely worse (it burns CPU walking the tree), so it is
      // enabled ONLY inside the container, where it is the difference between
      // working and not. The host path is untouched and keeps native events.
      usePolling: process.env.DOCKER_DEV === "1",
      interval: 250,
    },
  },
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
        // The design system’s outline colour, matching index.html’s
        // theme-color meta — the OS chrome around an installed Beagle Chomp
        // should be the same ink line that frames everything inside it.
        theme_color: "#1B1512",
        background_color: "#151A16",
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
        globPatterns: ["**/*.{js,css,html,png,svg,woff2,glb,gltf,mp3,ogg}"],
        // IDEA-052b: the push + notificationclick listeners, pulled into the
        // GENERATED worker rather than replacing it.
        //
        // This is deliberately NOT `strategies: "injectManifest"`. That would
        // hand us the whole worker and, at this plugin version, three silent
        // failures with it: `workbox.globPatterns` above would be ignored (the
        // option is named differently under injectManifest) so the fonts and
        // audio would silently leave the precache; `registerType: "autoUpdate"`
        // would stop working after the first install, because generateSW is
        // what bakes in skipWaiting/clientsClaim and the auto register path
        // never sends it — pinning every player to an old bundle forever; and
        // the usual dev recipe's `devOptions.type: "module"` leaks into the
        // PRODUCTION registration, since the plugin keys that off
        // `devOptions.enabled` (true, just below) rather than serve-vs-build,
        // which breaks Firefox. importScripts buys the same listeners for none
        // of that. Full reasoning in public/push-sw.js.
        //
        // BUMP THE ?v= WHEN push-sw.js CHANGES. It is served from public/ and
        // is therefore NOT content-hashed, so a browser may hold the old copy.
        importScripts: ["push-sw.js?v=3"]
      },
      devOptions: { enabled: true }
    })
  ]
});
