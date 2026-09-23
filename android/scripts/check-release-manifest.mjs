#!/usr/bin/env node
/**
 * APK의 **최종 병합 매니페스트**를 읽어 빌드 구성 계약을 검사한다(iOS `check-release-artifact.mjs` 동형).
 *
 * 소스 가드(`AppSourceGuardTest`)는 소스셋 파일만 본다. 병합 규칙·빌드 타입 매핑이 어긋나면 도보 안내의 전경 서비스가 정식 APK에서
 * 빠지는데 빌드는 성공하고 전경 동작도 정상이라(화면을 끄면 안내가 죽는다) 산출물을 읽는 검사 말고는 드러나지 않는다.
 *
 * 사용:
 *   node android/scripts/check-release-manifest.mjs <apk 경로>                 # 정식판 기대: 패키지에 .dev 없음
 *   node android/scripts/check-release-manifest.mjs <apk 경로> --experimental  # 실험판 기대: 패키지 .dev
 * 두 구성 모두: 도보 안내 전경 서비스(location)·권한 전부 있음, 백그라운드 위치 권한 없음(D11).
 *
 * `aapt2 dump xmltree`(`$ANDROID_HOME/build-tools/<ver>/aapt2`)로 읽는다. 어긋나면 exit 1.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PACKAGE = "space.dodoplanet.gildongmu";
const WALK_GUIDANCE = ["android.permission.FOREGROUND_SERVICE", "android.permission.FOREGROUND_SERVICE_LOCATION", "android.permission.WAKE_LOCK", "android.permission.ACTIVITY_RECOGNITION"];
// foregroundServiceType 비트 location = 0x8(`ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION`). aapt2는 플래그 속성을 정수로 찍는다.
const LOCATION_TYPE = 0x8;

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
for (const p of WALK_GUIDANCE) if (!tree.includes(`"${p}"`)) problems.push(`${p} 없음(도보 안내)`);
if (tree.includes("ACCESS_BACKGROUND_LOCATION")) problems.push("ACCESS_BACKGROUND_LOCATION 있음(D11 — 백그라운드 위치는 요청하지 않는다)");

// 서비스 요소 하나의 블록(다음 요소 줄 전까지)에서 이름과 유형을 함께 본다.
const service = tree.split(/\n(?=\s*E: )/).find((block) => /^\s*E: service/.test(block) && block.includes("GuideForegroundService"));
if (!service) problems.push("GuideForegroundService 선언 없음(도보 안내)");
else {
  const type = /foregroundServiceType\([^)]*\)=(?:\(type [^)]*\))?(0x[0-9a-f]+|\d+)/i.exec(service)?.[1];
  if (type === undefined || (Number(type) & LOCATION_TYPE) === 0) problems.push(`GuideForegroundService의 foregroundServiceType에 location 없음(${type ?? "속성 없음"})`);
}

if (problems.length) { console.error(`FAIL ${apk}\n- ${problems.join("\n- ")}`); process.exit(1); }
console.log(`OK ${apk}: ${experimental ? "실험판" : "정식판"} — 도보 안내 전경 서비스·권한 존재, 백그라운드 위치 0, 패키지 ${pkg}`);
