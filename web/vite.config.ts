import { defineConfig } from "vitest/config";

export default defineConfig({
  server: { host: "127.0.0.1", port: 8376, strictPort: true },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});