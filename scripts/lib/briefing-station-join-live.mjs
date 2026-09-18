// live 전용: 코퍼스 실행에서는 이 모듈을 import하지 않는다.
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export async function collectBriefingSamples(lang) {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch { /* CI 등에서는 환경변수 직접 주입 */ }

  /**
   * OD 쌍. 확인하려는 케이스(환승 2회 이상 · 버스↔지하철 혼합 · 도보 줄 없는 지하철 연속 · 지방 도시 ·
   * 순환선)를 겨냥해 고르되, **그 케이스가 실제로 나왔는지는 응답을 보고 판정한다** — 겨냥이 곧 존재는 아니다.
   */
  const PAIRS = [
    { name: "천호 → 여의도(5호선 직통)", origin: { lat: 37.5385, lng: 127.1235 }, dest: { lat: 37.5215, lng: 126.9243 } },
    { name: "김포공항 → 상봉(장거리 환승)", origin: { lat: 37.5629, lng: 126.8016 }, dest: { lat: 37.5964, lng: 127.0851 } },
    { name: "강남 → 잠실(2호선 순환)", origin: { lat: 37.4979, lng: 127.0276 }, dest: { lat: 37.5133, lng: 127.1 } },
    { name: "서울역 → 사당", origin: { lat: 37.5547, lng: 126.9707 }, dest: { lat: 37.4765, lng: 126.9816 } },
    { name: "수원역 → 판교역", origin: { lat: 37.2659, lng: 127.0003 }, dest: { lat: 37.3947, lng: 127.1112 } },
    { name: "부평역 → 인천시청", origin: { lat: 37.4894, lng: 126.7246 }, dest: { lat: 37.4574, lng: 126.7317 } },
    { name: "부산 서면 → 해운대", origin: { lat: 35.1579, lng: 129.0594 }, dest: { lat: 35.1631, lng: 129.1635 } },
    { name: "대구 반월당 → 동대구역", origin: { lat: 35.8656, lng: 128.5936 }, dest: { lat: 35.8797, lng: 128.6285 } },
    { name: "대전 정부청사 → 대전역", origin: { lat: 36.3612, lng: 127.3812 }, dest: { lat: 36.3323, lng: 127.4342 } },
    { name: "길동 주택가 → 천호(짧은 도보+지하철)", origin: { lat: 37.5372, lng: 127.1414 }, dest: { lat: 37.5385, lng: 127.1235 } },
    { name: "은평 주택가 → 종로3가(버스 혼합 기대)", origin: { lat: 37.6176, lng: 126.9227 }, dest: { lat: 37.5714, lng: 126.9917 } },
    { name: "과천 → 사당(경기-서울 경계)", origin: { lat: 37.4292, lng: 126.9897 }, dest: { lat: 37.4765, lng: 126.9816 } },
  ];

  const workDir = mkdtempSync(join(tmpdir(), "briefing-join-gate-"));
  const entryPath = join(workDir, "entry.ts");
  const bundlePath = join(workDir, "odsay.mjs");
  // next/cache는 Next 런타임 밖에 없다 — 통과 스텁으로 대체해 provider를 그대로 태운다(판정 로직 복제 금지).
  const stubPath = join(workDir, "next-cache-stub.mjs");
  writeFileSync(stubPath, "export const unstable_cache = (fn) => fn;\n");
  writeFileSync(entryPath, `export { getTransitRoute } from ${JSON.stringify(resolve("src/lib/providers/odsay"))};`);

  let quota = false;
  let providerError;
  const samples = [];
  try {
    execFileSync(
      "npx",
      ["esbuild", entryPath, "--bundle", "--format=esm", "--platform=node", `--alias:next/cache=${stubPath}`, `--outfile=${bundlePath}`],
      { stdio: "pipe" },
    );
    const { getTransitRoute } = await import(bundlePath);

    for (const pair of PAIRS) {
      if (quota) break;
      try {
        const result = await getTransitRoute({
          origin: pair.origin, dest: pair.dest, includeStops: true,
          ...(lang === "en" ? { lang: "en" } : {}),
        });
        if (!result) {
          console.log(`  · ${pair.name}: 경로 없음`);
          continue;
        }
        const routes = [result.recommended, ...result.alternatives];
        samples.push({ pair: pair.name, routes: routes.map((r) => ({ legs: r.legs })) });
        console.log(`  · ${pair.name}: ${routes.length}경로 / ${routes.reduce((n, r) => n + r.legs.length, 0)}구간`);
      } catch (e) {
        // ⚠ provider가 `kind`를 안 붙이는 경로도 있다 — 메시지로도 본다. 쿼터를 일반 실패로 접으면 남은 OD를
        //   계속 때려 그날 프로덕션 한도를 더 깎는다(2026-09-18 실측: 10번째 OD에서 429가 왔다).
        const message = String(e?.message ?? e);
        if (e?.kind === "quota" || /\b429\b|quota/i.test(message)) { quota = true; break; }
        console.log(`  · ${pair.name}: 실패 ${e?.kind ?? "?"} ${message.slice(0, 120)}`);
      }
    }
  } catch (e) {
    providerError = String(e?.message ?? e).slice(0, 200);
  }

  return { samples, quota, pairCount: PAIRS.length, providerError };
}
