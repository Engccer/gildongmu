/**
 * 서울교통공사 빠른하차 seed 빌드 (스펙 `2026-08-08-subway-quick-exit-design.md` §3).
 *
 * 하차역·방향별로 계단·엘리베이터에 가장 가까운 칸·문 번호를 준다. `crtrYmd`가 전 행
 * `20241231`인 **연 1회 스냅숏**이고 전체가 2,358행뿐이라, 세션 중에 조회할 이유가 없다.
 * seed로 굳히면 공유 쿼터 소비 0·지연 0·장애 노출 0이다.
 *
 * 실행: node scripts/build-subway-quick-exit.mjs
 * ⚠ data.go.kr 일 1,000회 공유 쿼터를 5콜 쓴다. 연 1회 갱신용.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "src/lib/data/subway-quick-exit.json");
const STATIONS = resolve(ROOT, "src/lib/data/subway-stations.json");
const BASE = "https://apis.data.go.kr/B553766/inout/getFstExit";
const PAGE_SIZE = 500;

/** 서울교통공사가 운영하는 노선 전부. 이 밖이 오면 커버 범위가 바뀐 것이다. */
const LINES = new Set(["1호선", "2호선", "3호선", "4호선", "5호선", "6호선", "7호선", "8호선"]);
const FACILITIES = new Set(["계단", "엘리베이터", "에스컬레이터"]);
const DIRECTIONS = new Set(["상행", "하행"]);

/** 문 번호 문법: `6-4` · `3-2,3-3 사이` · `NA-NA`(정보 없음을 문자열로 채운 것). */
const DOOR = /^\d+-\d+$/;
const BETWEEN = /^\d+-\d+,\d+-\d+ 사이$/;

/**
 * `drtnInfo`(그 방향 다음 역)가 `stnNo` 인접역과 어긋나는 알려진 4건.
 *
 * 전부 **번호 순서와 실제 선로 위상이 다른 곳**이다: 응암순환(응암→역촌→…→구산→응암→새절)은
 * 번호가 응암 610·역촌 611 … 구산 615·새절 616이라 루프 구간에서 번호 증감이 진행 방향과
 * 어긋나고, 강동 5호선 하행은 길동(549)·둔촌동(P549)으로 갈라지는 분기라 번호 인접이
 * 한쪽만 가리킨다. 위상이 바뀌거나 데이터가 오염되면 **이 목록 밖의 어긋남**으로 나타난다.
 */
const ADJACENCY_EXCEPTIONS = new Set([
  "5호선|548|하행|둔촌동",
  "6호선|610|하행|새절",
  "6호선|615|하행|응암",
  "6호선|616|상행|응암",
]);

function apiKey() {
  const env = readFileSync(resolve(ROOT, ".env.local"), "utf-8");
  const m = env.match(/^DATA_GO_KR_API_KEY=["']?([^"'\n]+)/m);
  if (!m) throw new Error(".env.local에 DATA_GO_KR_API_KEY가 없다");
  return m[1];
}

/**
 * 가드는 전부 순수 함수로 내보낸다 — 가드가 있다는 사실과 가드가 실제로 잡는다는 사실은
 * 다르고, 후자는 변이를 주입해 봐야만 안다([[mutation-proves-test-detection-power]]).
 * 네트워크가 필요한 수집만 빼면 빌드 전체가 테스트에서 재현된다.
 */

/**
 * 역명 매칭 키. `src/lib/station-match.ts`의 `normalizeStationName`과 같은 규칙이다
 * (빌드 스크립트는 mjs라 TS를 import할 수 없어 규칙만 옮긴다 — 어긋나면 G8 조인이 깨진다).
 */
function normalizeStationName(name) {
  return String(name)
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/(?:\s+(?:\S*(?:선|철도)|GTX-\S*))+$/i, "")
    .trim()
    .replace(/\s*station$/i, "")
    .replace(/역$/, "")
    .trim()
    .toLowerCase();
}

/**
 * ⚠ **이 엔드포인트의 JSON 파라미터는 `dataType=json`이다.** 우리 다른 data.go.kr provider
 * 9종이 전부 쓰는 `_type=json`은 무시되고 XML이 오는데, `resultCode 00`에 실데이터가 실려
 * 오므로 키 문제로 오진하기 쉽다(`type=json`·`resultType=json`도 XML). 실호출로만 알 수 있다.
 */
async function fetchPage(key, pageNo) {
  const p = new URLSearchParams({
    serviceKey: key,
    dataType: "json",
    numOfRows: String(PAGE_SIZE),
    pageNo: String(pageNo),
  });
  const res = await fetch(`${BASE}?${p}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`getFstExit p${pageNo} HTTP ${res.status}`);
  if (text.trimStart().startsWith("<")) {
    throw new Error(`getFstExit p${pageNo} XML 응답(키 만료·미신청 의심): ${text.slice(0, 200)}`);
  }
  const json = JSON.parse(text);
  const code = json?.response?.header?.resultCode;
  if (code !== "00") {
    throw new Error(`getFstExit p${pageNo} resultCode=${code} ${json?.response?.header?.resultMsg}`);
  }
  const body = json?.response?.body ?? {};
  const item = body.items?.item ?? body.items ?? [];
  return { rows: Array.isArray(item) ? item : [item], total: Number(body.totalCount ?? 0) };
}

/** G1·G2 수집 완전성: 부분 응답과 페이징 사고가 조용한 축소로 굳는 것을 막는다. */
export function checkCollected(rows, total) {
  if (rows.length !== total) {
    throw new Error(`G1 수집 불완전: ${rows.length}행 수집 / totalCount ${total}`);
  }
  const ids = new Set(rows.map((r) => r.qckgffMngNo));
  if (ids.size !== rows.length) {
    throw new Error(`G2 qckgffMngNo 중복: 고유 ${ids.size} / 행 ${rows.length}`);
  }
}

async function collect(key) {
  const first = await fetchPage(key, 1);
  const total = first.total;
  const rows = [...first.rows];
  const pages = Math.ceil(total / PAGE_SIZE);
  for (let p = 2; p <= pages; p++) {
    rows.push(...(await fetchPage(key, p)).rows);
  }
  checkCollected(rows, total);
  return rows;
}

export function checkSyntax(rows) {
  for (const r of rows) {
    const door = r.qckgffVhclDoorNo;
    // G4 문 번호: 관용 파싱하면 새 스냅숏의 전각 문자·공백·범위 표기가 NaN 정렬이나
    // 원문 오발화로 조용히 새어 나간다. 모르는 형태는 빌드를 세우는 것이 정답이다.
    if (!DOOR.test(door) && !BETWEEN.test(door) && door !== "NA-NA") {
      throw new Error(`G4 미지 문 번호 형태: ${JSON.stringify(door)} (${r.lineNm} ${r.stnNm})`);
    }
    if (!FACILITIES.has(r.plfmCmgFac)) {
      throw new Error(`G5 미지 시설: ${JSON.stringify(r.plfmCmgFac)} (${r.lineNm} ${r.stnNm})`);
    }
    if (!DIRECTIONS.has(r.upbdnbSe)) {
      throw new Error(`G6 미지 방향: ${JSON.stringify(r.upbdnbSe)} (${r.lineNm} ${r.stnNm})`);
    }
  }
  // G3 스냅숏 경계: 여러 기준일이 섞이면 이 seed가 언제 것인지 말할 수 없다.
  const ymd = new Set(rows.map((r) => r.crtrYmd));
  if (ymd.size !== 1) throw new Error(`G3 crtrYmd가 여러 값: ${[...ymd].join(", ")}`);
  return [...ymd][0];
}

export function checkLines(rows) {
  const lines = new Set(rows.map((r) => r.lineNm));
  const unexpected = [...lines].filter((l) => !LINES.has(l));
  const missing = [...LINES].filter((l) => !lines.has(l));
  if (unexpected.length || missing.length) {
    throw new Error(
      `G7 노선 집합 변화: 예상 밖 [${unexpected.join(", ")}] 누락 [${missing.join(", ")}]`,
    );
  }
}

export function checkStationJoin(combos) {
  const stations = JSON.parse(readFileSync(STATIONS, "utf-8"));
  const known = new Set(stations.map((s) => `${normalizeStationName(s.name)}|${s.lineName}`));
  const missing = [...combos].filter((c) => !known.has(c));
  if (missing.length) {
    throw new Error(
      `G8 역 seed 미조인 ${missing.length}건: ${missing.slice(0, 5).join(", ")} - ` +
        `역명 개정·신설역이면 subway-stations를 먼저 갱신하라`,
    );
  }
}

/**
 * G10: `drtnInfo`가 `stnNo` 인접역과 일치하는가.
 *
 * 이 검사가 §4 방향 판정의 전제다 — `drtnInfo`가 "그 방향 다음 역"이 아니면 직전역 대조가
 * 무의미해진다. 검사 밖으로 두는 셋은 예외가 아니라 **검사 대상이 아니다**: 인접역이
 * 서교공 목록 밖이면(서울역→남영 등 코레일 구간) 대조할 상대가 없고, 종착 방향은
 * `drtnInfo`가 자기 역명이며, 지선 번호(`211-1`·`P549`)는 증감 자체가 정의되지 않는다.
 */
export function checkAdjacency(rows) {
  const byNo = new Map();
  for (const r of rows) {
    byNo.set(`${r.lineNm}|${r.stnNo}`, normalizeStationName(r.stnNm));
  }
  const violations = new Set();
  let checked = 0;
  for (const r of rows) {
    const toward = r.drtnInfo == null ? null : normalizeStationName(r.drtnInfo);
    if (toward == null || toward === normalizeStationName(r.stnNm)) continue;
    if (!/^\d+$/.test(String(r.stnNo))) continue;
    const neighbor = String(Number(r.stnNo) + (r.upbdnbSe === "상행" ? -1 : 1));
    const name = byNo.get(`${r.lineNm}|${neighbor}`);
    if (name === undefined) continue;
    checked++;
    if (name === toward) continue;
    const key = `${r.lineNm}|${r.stnNo}|${r.upbdnbSe}|${r.drtnInfo}`;
    if (!ADJACENCY_EXCEPTIONS.has(key)) violations.add(`${key}(번호 인접=${name})`);
  }
  if (violations.size) {
    throw new Error(
      `G10 방면 불일치 ${violations.size}건: ${[...violations].slice(0, 5).join(", ")} - ` +
        `노선 위상이 바뀌었으면 ADJACENCY_EXCEPTIONS를 갱신하고, 아니면 데이터 오염이다`,
    );
  }
  return checked;
}

/**
 * G11: 직전 seed 대비 축소 금지.
 *
 * G7~G10은 한쪽이 통째로 비어도 자명하게 참이 된다(노선 8종 검사는 모든 노선에 최소 1행만
 * 있으면 통과한다). 커버가 조용히 줄어드는 것은 집합 대조로만 잡힌다.
 */
export function checkNoShrink(stations, facilityCounts, prev) {
  if (!prev) return;
  const prevKeys = new Set(
    Object.entries(prev.stations ?? {}).flatMap(([k, dirs]) =>
      dirs.map((d) => `${k}|${d.up ? "상행" : "하행"}`),
    ),
  );
  const nowKeys = new Set(
    Object.entries(stations).flatMap(([k, dirs]) =>
      dirs.map((d) => `${k}|${d.up ? "상행" : "하행"}`),
    ),
  );
  const lost = [...prevKeys].filter((k) => !nowKeys.has(k));
  if (lost.length) {
    throw new Error(
      `G11 (역·노선·방향) ${lost.length}건 소실: ${lost.slice(0, 5).join(", ")} - ` +
        `의도된 변화면 직전 seed를 지우고 다시 빌드하라`,
    );
  }
  for (const [fac, count] of Object.entries(facilityCounts)) {
    const before = prev.meta?.facilityCounts?.[fac] ?? 0;
    if (count < before) {
      throw new Error(`G11 ${fac} 행 수 감소: ${before} → ${count}`);
    }
  }
}

/**
 * 수집된 원본 행 → seed. 네트워크를 빼면 빌드 전체가 이 함수다(가드 포함).
 *
 * @param rows 원본 행
 * @param prev 직전 seed(없으면 null) — G11 대조 기준
 * @param today 빌드 일자(`YYYY-MM-DD`) — 주입 가능해야 테스트가 결정론이 된다
 */
export function buildSeed(rows, prev = null, today = new Date().toISOString().slice(0, 10)) {
  {
    const crtrYmd = checkSyntax(rows);
    checkLines(rows);
    const checked = checkAdjacency(rows);

    // 정제 ①: 에스컬레이터는 위원장 제외 판정이라 seed에 싣지 않는다(진입 타이밍 판단이
    // 필요해 흰지팡이 사용자에게 선택지로 제시할 값이 아니다).
    const kept = rows.filter((r) => r.plfmCmgFac !== "에스컬레이터");
    // 정제 ②: NA-NA는 정보 없음을 문자열로 채운 것이라 그대로 실으면 "NA-NA 문"이 낭독된다.
    const naRows = kept.filter((r) => r.qckgffVhclDoorNo === "NA-NA");
    const usable = kept.filter((r) => r.qckgffVhclDoorNo !== "NA-NA");
    // 정제 ③: 완전 중복(같은 역·노선·방향·방면·문·시설이 두 번 들어 있다).
    const seen = new Set();
    const unique = usable.filter((r) => {
      const k = [r.stnCd, r.lineNm, r.upbdnbSe, r.drtnInfo, r.qckgffVhclDoorNo, r.plfmCmgFac].join("|");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const groups = new Map();
    for (const r of unique) {
      const key = `${normalizeStationName(r.stnNm)}|${r.lineNm}`;
      const up = r.upbdnbSe === "상행";
      const id = `${key}|${up}`;
      let g = groups.get(id);
      if (!g) {
        g = { key, up, toward: new Set(), elevator: new Set(), stairs: new Set() };
        groups.set(id, g);
      }
      // ⚠ 방면이 null인 행이 있다(응암 6호선 상행). 방면을 모르면 그 방향은 직전역 대조로
      // 배제될 수 없어 "남은 하나"로 조용히 선택될 수 있다 — 판정 함수가 toward 1개일 때만
      // 채택하므로 여기서는 빈 집합으로 두는 것으로 충분하다.
      if (r.drtnInfo != null) g.toward.add(normalizeStationName(r.drtnInfo));
      (r.plfmCmgFac === "엘리베이터" ? g.elevator : g.stairs).add(r.qckgffVhclDoorNo);
    }

    // G9 두 방향의 방면 교집합 0 — §4.1 배제 판정의 전제다. 겹치면 같은 직전역이 양쪽을
    // 배제해 모든 판정이 사라지거나, 더 나쁘게는 반대 방향이 선택된다.
    const byStation = new Map();
    for (const g of groups.values()) {
      if (!byStation.has(g.key)) byStation.set(g.key, []);
      byStation.get(g.key).push(g);
    }
    for (const [key, dirs] of byStation) {
      if (dirs.length !== 2) continue;
      const [a, b] = dirs;
      const shared = [...a.toward].filter((t) => b.toward.has(t));
      if (shared.length) throw new Error(`G9 두 방향 방면 교집합: ${key} → ${shared.join(", ")}`);
    }

    const stations = {};
    const sortDoors = (set) => [...set].sort();
    for (const [key, dirs] of [...byStation].sort(([a], [b]) => a.localeCompare(b))) {
      stations[key] = dirs
        .sort((x, y) => Number(y.up) - Number(x.up))
        .map((g) => ({
          up: g.up,
          toward: [...g.toward].sort(),
          elevator: sortDoors(g.elevator),
          stairs: sortDoors(g.stairs),
        }));
    }

    const facilityCounts = {
      엘리베이터: unique.filter((r) => r.plfmCmgFac === "엘리베이터").length,
      계단: unique.filter((r) => r.plfmCmgFac === "계단").length,
    };
    checkStationJoin(new Set(Object.keys(stations)));
    checkNoShrink(stations, facilityCounts, prev);

    const directions = Object.values(stations).flat();
    const seed = {
      meta: {
        crtrYmd,
        builtAt: today,
        rows: unique.length,
        stations: Object.keys(stations).length,
        directions: directions.length,
        facilityCounts,
      },
      stations,
    };
    return {
      seed,
      stats: {
        collected: rows.length,
        escalator: rows.length - kept.length,
        naDropped: naRows.length,
        duplicates: usable.length - unique.length,
        adjacencyChecked: checked,
        // "판정 불가로 남는 방향"은 침묵의 총량이다. 늘어나면 데이터가 나빠진 것이므로
        // 빌드 로그에 남겨 다음 갱신 때 눈에 띄게 한다.
        branching: directions.filter((d) => d.toward.length > 1).length,
        towardless: directions.filter((d) => d.toward.length === 0).length,
        facilityless: directions.filter((d) => !d.elevator.length && !d.stairs.length).length,
      },
    };
  }
}

async function main() {
  const rows = await collect(apiKey());
  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf-8")) : null;
  if (!prev) console.log("G11 직전 seed 없음 — 이번 산출물이 기준선이 된다");
  const { seed, stats } = buildSeed(rows, prev);
  writeFileSync(OUT, `${JSON.stringify(seed, null, 1)}\n`, "utf-8");
  console.log(
    `수집 ${stats.collected}행 → 채택 ${seed.meta.rows}행 ` +
      `(에스컬레이터 ${stats.escalator} 제외 · NA-NA ${stats.naDropped} 폐기 · ` +
      `중복 ${stats.duplicates} 제거)`,
  );
  console.log(
    `역·노선 ${seed.meta.stations}개 · 방향 ${seed.meta.directions}개 · ` +
      `방면 대조 ${stats.adjacencyChecked}건`,
  );
  console.log(
    `판정 불가로 남는 방향: 분기 ${stats.branching} · 방면 없음 ${stats.towardless} · ` +
      `시설 없음 ${stats.facilityless}`,
  );
  console.log(`기준일 ${seed.meta.crtrYmd} → ${OUT}`);
}

// import(테스트)로 들어올 땐 실행하지 않는다.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
