import { defineCommand } from "citty";
import { ApiError } from "../lib/api-client.js";
import { readConfig, writeConfig, configPath, type CliConfig } from "../lib/config.js";
import { geocodeQuery } from "../lib/resolve-location.js";
import { fail } from "../lib/output.js";
import { ExitCode } from "../lib/exit-codes.js";

const ALLOWED_KEYS = ["apiUrl", "output", "location"] as const;
type AllowedKey = (typeof ALLOWED_KEYS)[number];

function isAllowedKey(key: string): key is AllowedKey {
  return (ALLOWED_KEYS as readonly string[]).includes(key);
}

function printValue(value: unknown): void {
  process.stdout.write((typeof value === "string" ? value : JSON.stringify(value ?? null)) + "\n");
}

const getCommand = defineCommand({
  meta: { name: "get", description: "설정값 조회(키 생략 시 전체)" },
  args: {
    key: { type: "positional", description: "apiUrl|output|location", required: false },
  },
  async run({ args }) {
    const cfg = await readConfig();
    if (!args.key) {
      printValue(cfg);
      return;
    }
    if (!isAllowedKey(args.key)) {
      fail(`알 수 없는 설정 키: ${args.key} (apiUrl|output|location만 허용)`, ExitCode.Usage);
    }
    printValue(cfg[args.key]);
  },
});

/** `location`은 지오코딩해 {label,lat,lng}로 저장 — resolve-location.ts의 config.location 소비 형태와 일치. */
const setCommand = defineCommand({
  meta: { name: "set", description: "설정값 저장" },
  args: {
    key: { type: "positional", description: "apiUrl|output|location", required: true },
    value: { type: "positional", description: "값", required: true },
  },
  async run({ args }) {
    if (!isAllowedKey(args.key)) {
      fail(`알 수 없는 설정 키: ${args.key} (apiUrl|output|location만 허용)`, ExitCode.Usage);
    }
    if (args.key === "output" && args.value !== "text" && args.value !== "json") {
      fail(`output은 text|json만 허용합니다: ${args.value}`, ExitCode.Usage);
    }
    if (args.key === "location") {
      try {
        const g = await geocodeQuery(args.value);
        await writeConfig({ location: { label: g.label, lat: g.lat, lng: g.lng } });
        process.stdout.write(`기본 위치를 '${g.label}'(위도 ${g.lat}, 경도 ${g.lng})로 저장했습니다\n`);
      } catch (err) {
        // ApiError(네트워크·서버 오류)는 고유 exit 코드 보존, 지오코딩 0건(일반 Error)만 Usage(2).
        if (err instanceof ApiError) fail(err.message, err.exitCode);
        fail(err instanceof Error ? err.message : String(err), ExitCode.Usage);
      }
      return;
    }
    await writeConfig({ [args.key]: args.value } as Partial<CliConfig>);
    process.stdout.write(`${args.key} = ${args.value}\n`);
  },
});

const pathCommand = defineCommand({
  meta: { name: "path", description: "설정 파일 경로 출력" },
  async run() {
    process.stdout.write(configPath() + "\n");
  },
});

export const configCommand = defineCommand({
  meta: { name: "config", description: "CLI 설정 조회·저장(apiUrl·output·location)" },
  subCommands: { get: getCommand, set: setCommand, path: pathCommand },
});
