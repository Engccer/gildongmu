import pc from "picocolors";
import type { CliConfig } from "./config.js";
import { ExitCode } from "./exit-codes.js";

/** 웹 src/lib/format.ts joinText 동형 — 한 줄=한 객체, 구분자는 쉼표. */
export function joinText(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(", ");
}

export function resolveOutputMode(flag: string | undefined, cfg: CliConfig): "text" | "json" {
  if (flag === "json" || flag === "text") return flag;
  if (cfg.output) return cfg.output;
  return process.stdout.isTTY ? "text" : "json";
}

/** json 모드: 구조화 데이터 그대로. text 모드: 항목당 한 줄 산문(스피너·표 금지). */
export function emit(data: unknown, lines: string[], mode: "text" | "json"): void {
  if (mode === "json") {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    return;
  }
  process.stdout.write(lines.join("\n") + "\n");
}

export function fail(message: string, code: ExitCode): never {
  process.stderr.write((process.env.NO_COLOR ? message : pc.red(message)) + "\n");
  process.exit(code);
}
