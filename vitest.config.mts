import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";

import { mockOrigin } from "./test/mock-origin";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        outboundService: (request: Request) => mockOrigin(request),
      },
    }),
  ],
});
