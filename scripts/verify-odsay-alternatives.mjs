#!/usr/bin/env node
// 실호출 게이트 — 대중교통 대안 경로 재구성(E50, spec `docs/superpowers/specs/2026-09-24-transit-alternatives-reasoned-design.md` §0·§8).
//
// 재는 것(원시 응답 층 — 우리 선정 단계가 표본을 자르기 전에 본다):
//   (a) 전체 조회 응답에 버스만(pathType 2)·지하철만(pathType 1) 경로가 이미 있는 비율 — 재조회 버튼이 얼마나 자주 뜨는가
//   (b) pathType ↔ leg 구성(비도보 subPath가 전부 버스/전부 지하철) 교차 대조 — 어긋남 0이어야 한다
//   (c) totalWalk 최소 경로가 1순위와 다른 비율, 그중 도보 분이 1순위보다 많아지는 모순 건수
//   (d) 재조회(SearchPathType 1·2)가 그 수단만 돌려주는가(필터 충실도), 결과 3-state 분포
// 그리고 provider 파이프라인(정규화 → 선정 → 라벨)을 저장 응답 위에서 그대로 태워 그 결과를 원시 층 사실과
// 독립적으로 대조한다: 수단 투영 = pathType ∧ 구간, 이름 붙은 축 = 전체 후보 위의 최선, 재조회 제안 = 원시 응답에
// 그 수단만 타는 경로가 없음. 재조회 "없음" 갈래는 표본에서 관측되지 않아 단위 테스트(odsay-pipeline)가 잠근다.
//
// ⚠ ODsay Flex는 호출당 과금이다. 실호출은 `--ledger`(호출 원장) 필수이고 원장 누적이 상한(40)에 닿으면
//   호출 전에 멈춘다. `--out` 디렉터리에 이미 있는 응답은 다시 부르지 않는다(재실행 = 재사용).
//
// 사용법:
//   live:    node scripts/verify-odsay-alternatives.mjs --out <dir> --ledger <file> [--requery]
//   offline: node scripts/verify-odsay-alternatives.mjs --from-corpus <dir>
//   (원시 응답은 사설 경로에 둔다 — 저장소에 커밋하지 않는다)
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CALL_CAP = 40;

try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* CI 등에서는 환경변수 직접 주입 */ }

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--requery") { opts.requery = true; continue; }
    if (!["--out", "--ledger", "--from-corpus"].includes(key)) throw new Error(`인자 오류: 모르는 인자 ${key}`);
    const value = argv[++i];
    if (!value) throw new Error(`인자 오류: ${key} 값 없음`);
    opts[key] = value;
  }
  if (opts["--from-corpus"] && (opts["--out"] || opts["--ledger"] || opts.requery)) {
    throw new Error("인자 오류: --from-corpus는 단독으로만(원본 읽기 전용, 호출 0)");
  }
  if (!opts["--from-corpus"] && !(opts["--out"] && opts["--ledger"])) {
    throw new Error("인자 오류: live는 --out과 --ledger가 모두 필요하다(호출 원장 없는 실호출 금지)");
  }
  return opts;
}

let opts;
try {
  opts = parseArgs(process.argv.slice(2));
} catch (e) {
  console.error(`FAIL: ${e.message}`);
  process.exit(2);
}
const corpusDir = resolve(opts["--from-corpus"] ?? opts["--out"]);
const offline = Boolean(opts["--from-corpus"]);
if (!offline) mkdirSync(corpusDir, { recursive: true });

// 표본: 수도권 6 + 광역시 4. 좌표는 역·공공 지점(자택 좌표 금지).
export const PAIRS = [
  { id: "gildong-seoulstn", name: "길동→서울역", origin: { lat: 37.5384, lng: 127.1408 }, dest: { lat: 37.5547, lng: 126.9707 } },
  { id: "gildong-gangdong", name: "길동→강동역", origin: { lat: 37.5384, lng: 127.1408 }, dest: { lat: 37.5358, lng: 127.1323 } },
  { id: "gildong-gangnam", name: "길동→강남", origin: { lat: 37.5384, lng: 127.1408 }, dest: { lat: 37.4979, lng: 127.0276 } },
  { id: "gimpo-sinnonhyeon", name: "김포공항→신논현", origin: { lat: 37.5623, lng: 126.8012 }, dest: { lat: 37.5045, lng: 127.0249 } },
  { id: "gildong-hanam", name: "길동→하남", origin: { lat: 37.5384, lng: 127.1408 }, dest: { lat: 37.5395, lng: 127.214 } },
  { id: "hongdae-jamsil", name: "홍대입구→잠실", origin: { lat: 37.5572, lng: 126.9236 }, dest: { lat: 37.5133, lng: 127.1001 } },
  { id: "busan-seomyeon-haeundae", name: "부산 서면→해운대", origin: { lat: 35.1579, lng: 129.0592 }, dest: { lat: 35.1631, lng: 129.1586 } },
  { id: "daejeon-stn-yuseong", name: "대전역→유성온천", origin: { lat: 36.3326, lng: 127.4345 }, dest: { lat: 36.3537, lng: 127.344 } },
  { id: "daegu-dongdaegu-banwoldang", name: "동대구역→반월당", origin: { lat: 35.8793, lng: 128.6282 }, dest: { lat: 35.8656, lng: 128.5935 } },
  { id: "gwangju-songjeong-cityhall", name: "광주송정역→광주시청", origin: { lat: 35.1374, lng: 126.7932 }, dest: { lat: 35.16, lng: 126.8514 } },
];

/** 필터 충실도 표본 — 재조회 제안 밖이라 실사용 버튼과 무관하고, ODsay 필터 자체의 성질만 본다(호출 2건) */
const FIDELITY_PROBES = [
  { pairId: "gildong-seoulstn", axis: "busOnly" },
  { pairId: "gildong-hanam", axis: "subwayOnly" },
];

function ledgerCount() {
  if (!existsSync(opts["--ledger"])) return 0;
  return readFileSync(opts["--ledger"], "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#")).length;
}

/** 저장본이 있으면 읽고, 없으면(live) 한 번 부르고 저장한다. offline에서 없으면 throw. */
async function loadOrFetch(file, pair, searchPathType) {
  const path = join(corpusDir, file);
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  if (offline) throw new Error(`코퍼스에 ${file}이 없다`);
  const used = ledgerCount();
  if (used + 1 > CALL_CAP) throw new Error(`호출 상한 ${CALL_CAP} 도달(원장 ${used}건) — 멈추고 보고한다`);
  const q = new URLSearchParams({
    SX: String(pair.origin.lng),
    SY: String(pair.origin.lat),
    EX: String(pair.dest.lng),
    EY: String(pair.dest.lat),
    OPT: "0",
  });
  if (searchPathType) q.set("SearchPathType", searchPathType);
  const res = await fetch(`https://api.odsay.com/v1/api/searchPubTransPathT?${q}&apiKey=${process.env.ODSAY_API_KEY ?? ""}`, {
    headers: { Referer: "https://gildongmu.dodoplanet.space/" },
  });
  appendFileSync(
    opts["--ledger"],
    `${new Date().toISOString()}\t#${used + 1}\tverify-odsay-alternatives\t${pair.id}\tSearchPathType=${searchPathType ?? "0"}\tHTTP ${res.status}\n`,
  );
  if (!res.ok) throw new Error(`ODsay HTTP ${res.status} (${pair.id})`);
  const body = await res.json();
  writeFileSync(path, JSON.stringify(body));
  return body;
}

const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: Boolean(cond) });
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${detail ? ` (${detail})` : ""}`);
}

/** 원시 path의 비도보 subPath 교통 종류 집합 → "bus"|"subway"|"mixed"|"other" */
function legModeOf(path) {
  const kinds = new Set(path.subPath.filter((sp) => sp.trafficType !== 3).map((sp) => sp.trafficType));
  if (kinds.size === 1 && kinds.has(2)) return "bus";
  if (kinds.size === 1 && kinds.has(1)) return "subway";
  if ([...kinds].every((k) => k === 1 || k === 2)) return "mixed";
  return "other";
}
const PATHTYPE_MODE = { 1: "subway", 2: "bus", 3: "mixed" };

// provider를 그대로 태운다(판정 로직 복제 금지, verify-odsay-lang 동형).
const workDir = mkdtempSync(join(tmpdir(), "odsay-alt-gate-"));
const entryPath = join(workDir, "entry.ts");
const bundlePath = join(workDir, "odsay.mjs");
const stubPath = join(workDir, "next-cache-stub.mjs");
writeFileSync(stubPath, "export const unstable_cache = (fn) => fn;\n");
writeFileSync(
  entryPath,
  [
    `export { normalizeOdsayRoutes } from ${JSON.stringify(resolve("src/lib/providers/odsay"))};`,
    `export { selectTransitRoutes, annotateHighlights, modeRequeryOffers, filterRoutesByMode } from ${JSON.stringify(resolve("src/lib/providers/odsay-select"))};`,
  ].join("\n"),
);

let exitCode = 0;
try {
  execFileSync(
    "npx",
    ["esbuild", entryPath, "--bundle", "--format=esm", "--platform=node", `--alias:next/cache=${stubPath}`, `--outfile=${bundlePath}`],
    { stdio: "pipe" },
  );
  const { normalizeOdsayRoutes, selectTransitRoutes, annotateHighlights, modeRequeryOffers, filterRoutesByMode } = await import(bundlePath);

  const rows = [];
  for (const pair of PAIRS) {
    const data = await loadOrFetch(`full-${pair.id}.json`, pair, null);
    const paths = data.result?.path;
    if (!Array.isArray(paths) || paths.length === 0) {
      console.log(`SKIP — ${pair.name}: 경로 없음·오류 (${JSON.stringify(data.error ?? null).slice(0, 120)})`);
      rows.push({ pair, paths: [] });
      continue;
    }
    rows.push({ pair, paths, data });
  }

  // (b) pathType ↔ leg 구성
  let mismatch = 0;
  let total = 0;
  const pathTypeHist = {};
  for (const { pair, paths } of rows) {
    for (const [i, p] of paths.entries()) {
      total++;
      pathTypeHist[p.pathType] = (pathTypeHist[p.pathType] ?? 0) + 1;
      const expected = PATHTYPE_MODE[p.pathType];
      const actual = legModeOf(p);
      if (expected !== actual) {
        mismatch++;
        console.log(`  불일치 ${pair.name} path[${i}]: pathType=${p.pathType} legs=${actual}`);
      }
    }
  }
  console.log(`(b) 경로 ${total}개 pathType 분포 ${JSON.stringify(pathTypeHist)}, pathType↔leg 불일치 ${mismatch}건`);
  check("(b) pathType과 leg 구성이 모든 경로에서 일치", mismatch === 0, `${mismatch}/${total}`);

  // (a) 버스만·지하철만 경로 존재 비율(1순위 포함 전체 응답 기준)
  const answered = rows.filter((r) => r.paths.length > 0);
  const hasBus = answered.filter((r) => r.paths.some((p) => p.pathType === 2));
  const hasSubway = answered.filter((r) => r.paths.some((p) => p.pathType === 1));
  console.log(`(a) 응답 ${answered.length}쌍 중 버스만 경로 보유 ${hasBus.length}, 지하철만 경로 보유 ${hasSubway.length}`);
  for (const r of answered) {
    const counts = r.paths.reduce((acc, p) => ({ ...acc, [p.pathType]: (acc[p.pathType] ?? 0) + 1 }), {});
    console.log(`    ${r.pair.name}: 경로 ${r.paths.length}개 ${JSON.stringify(counts)} 1순위 pathType=${r.paths[0].pathType}`);
  }

  // (c) totalWalk 최소 경로 vs 1순위(강등 전 ODsay 순서 기준)
  let walkDiffers = 0;
  let walkMinuteContradiction = 0;
  const walkMinutesOf = (p) => p.subPath.filter((sp) => sp.trafficType === 3).reduce((s, sp) => s + (sp.sectionTime ?? 0), 0);
  for (const { pair, paths } of answered) {
    const base = paths[0];
    let best = null;
    for (const p of paths.slice(1)) {
      if (!(p.info.totalWalk < base.info.totalWalk)) continue;
      if (!best || p.info.totalWalk < best.info.totalWalk) best = p;
    }
    if (!best) {
      console.log(`    ${pair.name}: 도보 최소 축 없음(1순위 ${base.info.totalWalk}m가 최소)`);
      continue;
    }
    walkDiffers++;
    const contradiction = walkMinutesOf(best) > walkMinutesOf(base);
    if (contradiction) walkMinuteContradiction++;
    console.log(
      `    ${pair.name}: 1순위 ${base.info.totalWalk}m·도보 ${walkMinutesOf(base)}분 → 최소 ${best.info.totalWalk}m·도보 ${walkMinutesOf(best)}분${contradiction ? " ⚠ 분은 더 많다" : ""}`,
    );
  }
  console.log(`(c) 도보 최소 축이 1순위와 다른 쌍 ${walkDiffers}/${answered.length}, 그중 도보 분 모순 ${walkMinuteContradiction}`);

  // 파이프라인(정규화 → 선정 → 라벨)을 원시 층 사실과 **독립적으로** 대조한다(설계 리뷰 #3 — 함수 정의를 되묻는
  // 술어는 데이터에 대해 아무것도 증명하지 못한다). 게이트는 강등을 태우지 않으므로 후보 전부가 축 후보다.
  const KEY = {
    fastest: (r) => [r.summary.totalMinutes, r.summary.transfers],
    fewestTransfers: (r) => [r.summary.transfers, r.summary.totalMinutes],
    leastWalk: (r) => [r.summary.walkMeters, r.summary.walkMinutes, r.summary.totalMinutes],
    busOnly: (r) => [r.summary.totalMinutes, r.summary.transfers],
    subwayOnly: (r) => [r.summary.totalMinutes, r.summary.transfers],
  };
  const lexLess = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
  for (const { pair, data } of answered) {
    const raw = data.result.path;
    const routes = normalizeOdsayRoutes(data, { includeStops: false, lang: "ko" });
    // (c′) 수단 투영이 원시 pathType ∧ 구간 구성과 경로마다 같다(교차 확인이 살아 있는가)
    const vehicleOk = routes.every((r, i) => {
      const want = PATHTYPE_MODE[raw[i].pathType] === legModeOf(raw[i]) && ["bus", "subway"].includes(legModeOf(raw[i])) ? legModeOf(raw[i]) : undefined;
      return r.vehicle === want;
    });
    check(`${pair.name}: 수단 투영이 원시 pathType·구간과 일치`, vehicleOk);
    const result = annotateHighlights(selectTransitRoutes(routes), routes);
    const base = routes[0];
    // (a′) 이름 붙은 축마다 그 경로가 전체 후보 위의 최선이다(부분 집합이 아니라 전체)
    for (const alt of result.alternatives) {
      for (const axis of alt.highlight ?? []) {
        const better = routes.slice(1).some((r) => {
          if (r.routeKey === alt.routeKey) return false;
          const eligible =
            axis === "busOnly" ? r.vehicle === "bus" && base.vehicle !== "bus"
            : axis === "subwayOnly" ? r.vehicle === "subway" && base.vehicle !== "subway"
            : axis === "leastWalk" ? r.summary.walkMeters < base.summary.walkMeters && r.summary.walkMinutes <= base.summary.walkMinutes
            : lexLess(KEY[axis](r).slice(0, 1), KEY[axis](base).slice(0, 1));
          return eligible && lexLess(KEY[axis](r), KEY[axis](alt));
        });
        check(`${pair.name}: ${axis} 이름을 받은 경로가 전체 후보 위의 최선`, !better, alt.routeKey);
      }
    }
    check(`${pair.name}: 번호만 붙는 대안 0`, result.alternatives.every((a) => a.highlight?.length > 0),
      `대안 ${result.alternatives.length}개 ${result.alternatives.map((a) => a.highlight.join("+")).join(" / ") || "(없음)"}`);
    // (b′) 재조회 제안이 원시 층(파이프라인 밖)의 "그 수단만 타는 경로가 응답에 있는가"와 일치
    const offers = modeRequeryOffers(result);
    const rawHas = (pt, mode) => raw.some((p) => p.pathType === pt && legModeOf(p) === mode);
    check(
      `${pair.name}: 재조회 제안이 원시 응답과 일치`,
      offers.includes("busOnly") === !rawHas(2, "bus") && offers.includes("subwayOnly") === !rawHas(1, "subway"),
      `제안 ${offers.join(",") || "없음"}`,
    );
  }

  // (d) 재조회 — 제안된 수단(버튼이 뜨는 조건과 같은 표본) + 필터 충실도 표본(제안 밖이라도 그 수단이
  //     원시 응답에 있는 쌍: 재조회가 전체 조회보다 그 수단 경로를 더 주는지, 그 수단만 주는지)
  if (opts.requery || offline) {
    const outcome = { found: 0, none: 0, failed: 0 };
    for (const { pair, data } of answered) {
      const routes = normalizeOdsayRoutes(data, { includeStops: false, lang: "ko" });
      const offers = modeRequeryOffers(annotateHighlights(selectTransitRoutes(routes), routes));
      const probes = FIDELITY_PROBES.filter((f) => f.pairId === pair.id && !offers.includes(f.axis)).map((f) => f.axis);
      for (const axis of [...offers, ...probes]) {
        const spt = axis === "busOnly" ? "2" : "1";
        const file = `pt${spt}-${pair.id}.json`;
        if (offline && !existsSync(join(corpusDir, file))) continue;
        let body;
        try {
          body = await loadOrFetch(file, pair, spt);
        } catch (e) {
          if (/호출 상한/.test(e.message)) throw e;
          outcome.failed++;
          console.log(`    ${pair.name} ${axis}: 실패 ${e.message}`);
          continue;
        }
        const paths = body.result?.path;
        if (!Array.isArray(paths) || paths.length === 0) {
          outcome.none++;
          console.log(`    ${pair.name} ${axis}: 없음 (${JSON.stringify(body.error ?? null).slice(0, 100)})`);
          continue;
        }
        const wanted = spt === "2" ? 2 : 1;
        const stray = paths.filter((p) => p.pathType !== wanted || legModeOf(p) !== PATHTYPE_MODE[wanted]);
        check(`${pair.name} ${axis}: 재조회 응답이 그 수단만`, stray.length === 0, `경로 ${paths.length}개, 섞임 ${stray.length}`);
        const kept = filterRoutesByMode(normalizeOdsayRoutes(body, { includeStops: false, lang: "ko" }), axis === "busOnly" ? "bus" : "subway");
        if (kept.length > 0) outcome.found++;
        else outcome.none++;
        const inFull = data.result.path.filter((p) => p.pathType === wanted).length;
        console.log(`    ${pair.name} ${axis}${offers.includes(axis) ? "" : "(충실도 표본)"}: 찾음 ${kept.length}개(전체 조회엔 ${inFull}개), 1순위 ${kept[0]?.summary.totalMinutes ?? "-"}분·환승 ${kept[0]?.summary.transfers ?? "-"}회`);
      }
    }
    console.log(`(d) 재조회 결과 찾음 ${outcome.found} · 없음 ${outcome.none} · 실패 ${outcome.failed}`);
  }

  if (!offline) console.log(`호출 원장 누적 ${ledgerCount()}/${CALL_CAP}건 (${opts["--ledger"]})`);
  const failed = results.filter((r) => !r.pass);
  console.log(failed.length === 0 ? `\n전부 통과 (${results.length}건)` : `\nFAIL ${failed.length}/${results.length}건`);
  exitCode = failed.length === 0 ? 0 : 1;
} catch (e) {
  console.error(`FAIL: ${e.message}`);
  exitCode = 1;
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
process.exit(exitCode);
