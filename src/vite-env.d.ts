/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Base URL of the Beagle Chomp API (IDEA-019).
   *
   *  Set per environment, never hardcoded:
   *    local dev  → .env             http://localhost:3001
   *    production → Cloudflare Pages https://beaglechomp-api.nunoamorim.dev
   *
   *  Not a secret — it ends up in the client bundle by design; it's a public
   *  URL. Secrets live only in the API's Dokploy env vars (STACK.md §2.6).
   *
   *  net/api.ts throws loudly at boot if this is missing, rather than silently
   *  resolving relative URLs against the Pages origin. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
