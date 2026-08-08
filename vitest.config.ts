import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // jsdom 환경에 빠져 있는 localStorage를 연결한다(node 환경에서는 no-op).
    setupFiles: ["./src/test-setup.ts"],
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "scripts/**/*.test.mjs",
    ],
  },
});
