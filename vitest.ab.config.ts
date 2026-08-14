/**
 * 모델 A/B 실호출 하네스 전용 설정 — 기본 게이트 테스트(`npm run test:run`)와 분리한다.
 * 유료 API 실호출이라 매 커밋 레인에 들어가면 안 된다.
 */
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "next/cache": path.resolve(__dirname, "./src/__ab__/next-cache-stub.ts"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./src/__ab__/load-env.ts"],
    include: ["src/__ab__/*.spec.ts"],
    testTimeout: 60 * 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
