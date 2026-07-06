import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/*.png"],
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
