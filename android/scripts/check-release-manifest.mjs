#!/usr/bin/env node
/**
 * APK의 **최종 병합 매니페스트**를 읽어 실험판 봉인의 매니페스트 축을 검사한다(iOS `check-release-artifact.mjs` 동형).
 *
 * 소스 가드(`AppSourceGuardTest`)는 소스셋 파일만 본다. 병합 규칙·빌드 타입 매핑이 어긋나면 정식 APK에 전경 서비스가 들어가는데
 * 빌드는 성공하고 전경 동작도 정상이라 산출물을 읽는 검사 말고는 드러나지 않는다.
 *
 * 사용:
 *   node android/scripts/check-release-manifest.mjs <apk 경로>                 # 정식판 기대: 봉인 항목 0, 패키지에 .dev 없음
 *   node android/scripts/check-release-manifest.mjs <apk 경로> --experimental  # 실험판 기대: 봉인 항목 전부, 패키지 .dev
 *
 * `aapt2 dump xmltree`(`$ANDROID_HOME/build-tools/<ver>/aapt2`)로 읽는다. 어긋나면 exit 1.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PACKAGE = "space.dodoplanet.gildongmu";
const SEALED = ["android.permission.FOREGROUND_SERVICE", "android.permission.FOREGROUND_SERVICE_LOCATION", "android.permission.WAKE_LOCK", "android.permission.ACTIVITY_RECOGNITION"];

const apk = process.argv[2];
const experimental = process.argv.includes("--experimental");
if (!apk || !existsSync(apk)) { console.error("사용: check-release-manifest.mjs <apk> [--experimental]"); process.exit(2); }

const sdk = process.env.ANDROID_HOME || join(homedir(), "Library", "Android", "sdk");
const tools = readdirSync(join(sdk, "build-tools")).sort().reverse();
const aapt2 = join(sdk, "build-tools", tools[0], "aapt2");
const tree = execFileSync(aapt2, ["dump", "xmltree", "--file", "AndroidManifest.xml", apk], { encoding: "utf8" });

const problems = [];
const pkg = /package="([^"]+)"/.exec(tree)?.[1] ?? "";
if (experimental ? !pkg.endsWith(".dev") : pkg !== PACKAGE) problems.push(`패키지 ${pkg} (기대 ${experimental ? PACKAGE + ".dev" : PACKAGE})`);
for (const p of SEALED) {
  const has = tree.includes(p);
  if (experimental && !has) problems.push(`실험판에 ${p} 없음`);
  if (!experimental && has) problems.push(`정식판에 ${p} 있음`);
}
const hasService = /foregroundServiceType/.test(tree) || tree.includes("GuideForegroundService");
if (experimental && !hasService) problems.push("실험판에 전경 서비스 선언 없음");
if (!experimental && hasService) problems.push("정식판에 전경 서비스 선언 있음(도보 안내 봉인 위반)");

if (problems.length) { console.error(`FAIL ${apk}\n- ${problems.join("\n- ")}`); process.exit(1); }
console.log(`OK ${apk}: ${experimental ? "실험판 — 봉인 항목 전부 존재" : "정식판 — 봉인 항목 0"}, 패키지 ${pkg}`);
