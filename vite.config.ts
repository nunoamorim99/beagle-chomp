import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

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
