/**
 * TAGO 버스 보유 도시 seed 빌드 (스펙 `2026-08-02-bus-uncovered-region-design.md` §6).
 *
 * `getCtyCodeList`는 국토부 TAGO가 **자기가 데이터를 가진 도시**를 스스로 선언한 목록이라
 * 커버리지 판정에 추정이 끼지 않는다. 다만 코드가 있다고 데이터가 있는 건 아니어서
 * (양양군 32410은 코드만 있고 등록 정류소 0개) 도시마다 `getSttnNoList` totalCount를
 * 함께 굳혀 `stops > 0`만 커버로 친다.
 *
 * 실행: node scripts/build-tago-cities.mjs
 * ⚠ data.go.kr 일 1,000회 공유 쿼터를 139콜 쓴다. 상시 실행용이 아니라 연 1회 갱신용.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "src/lib/providers/data/tago-cities.json");
const BASE = "http://apis.data.go.kr/1613000/BusSttnInfoInqireService";

/** 가드 임계: 응답 구조가 바뀌면 조용한 축소가 아니라 빌드 실패가 되게 한다. */
const MIN_CITIES = 130;
const MIN_WITH_STOPS = 130;
/**
 * golden 3종. 강릉 부재가 이 seed의 존재 이유이므로 그것부터 못 박는다
 * (TAGO가 나중에 강릉을 추가하면 빌드가 깨지고, 그때는 기쁘게 golden을 지운다).
 */
const GOLDEN_PRESENT = "춘천시";
const GOLDEN_ABSENT = "강릉시";
const GOLDEN_ZERO = "양양군";

function apiKey() {
  const env = readFileSync(resolve(ROOT, ".env.local"), "utf-8");
  const m = env.match(/^DATA_GO_KR_API_KEY=["']?([^"'\n]+)/m);
  if (!m) throw new Error(".env.local에 DATA_GO_KR_API_KEY가 없다");
  return m[1];
}

/**
 * ⚠ `res.json()`을 쓰지 않는다: 키가 만료·미신청이면 `_type=json`이어도 HTTP 200 +
 * XML 본문이 와서 원인이 `Unexpected token '<'`로 가려진다(공용 파서와 같은 이유).
 */
async function fetchJson(url, label) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  if (text.trimStart().startsWith("<")) {
    throw new Error(`${label} XML 응답: 키 만료·미신청 의심: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

function body(json) {
  return json?.response?.body ?? {};
}

async function cityCodes(key) {
  const url = `${BASE}/getCtyCodeList?serviceKey=${key}&_type=json&numOfRows=500`;
  const items = body(await fetchJson(url, "getCtyCodeList")).items?.item ?? [];
  return Array.isArray(items) ? items : [items];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function stopCountOnce(key, code) {
  const p = new URLSearchParams({
    serviceKey: key, _type: "json", numOfRows: "1", cityCode: String(code),
  });
  const json = await fetchJson(`${BASE}/getSttnNoList?${p}`, `getSttnNoList(${code})`);
  return Number(body(json).totalCount ?? 0);
}

/**
 * 그 도시의 등록 정류소 수.
 *
 * ⚠ **0을 그대로 믿으면 안 된다.** 0은 "코드만 있고 데이터 없음"이라는 뜻이고 그대로
 * 미커버 판정이 되는데, upstream이 장애를 **예외가 아니라 HTTP 200 + `totalCount:0`**으로
 * 낸다(실측 2026-08-02: 한 빌드에서 천안시·함평군·산청군이 0으로 잡혔고 즉시 재조회하니
 * 각각 2,443·1,043·435였다). 예외만 재시도하는 흔한 구현은 이걸 못 잡고, 결과는
 * **멀쩡한 도시를 "정류소 정보 미제공 지역"으로 굳히는 것**이라 증상이 조용하다.
 * 그래서 0은 확정 전에 반드시 재확인하고, 연속으로 0일 때만 진짜 0으로 받아들인다.
 */
async function stopCount(key, code) {
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(500 * attempt);
    try {
      const n = await stopCountOnce(key, code);
      if (n > 0) return n;
      // 0 재확인: 세 번 더 물어 전부 0이어야 0으로 확정한다.
      for (let confirm = 0; confirm < 3; confirm++) {
        await sleep(400);
        const again = await stopCountOnce(key, code);
        if (again > 0) return again;
      }
      return 0;
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`getSttnNoList(${code}) 4회 실패: ${last?.message}`);
}

/** 동시 실행 제한: 공유 쿼터를 쓰는 API라 과하게 몰지 않는다. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function main() {
  const key = apiKey();
  const codes = await cityCodes(key);
  const counts = await mapLimit(codes, 6, (c) => stopCount(key, c.citycode));

  const cities = codes.map((c, i) => ({
    code: Number(c.citycode),
    // "원주시/횡성군"·"대전광역시/계룡시" 묶음은 여기서 분해한다: 런타임이 구분자를
    // 다시 파싱하게 두면 소비자마다 규칙이 갈린다.
    names: String(c.cityname).split("/").map((s) => s.trim()).filter(Boolean),
    stops: counts[i],
  }));

  const withStops = cities.filter((c) => c.stops > 0);
  const allNames = cities.flatMap((c) => c.names);

  if (cities.length < MIN_CITIES) {
    throw new Error(`도시 수 부족: ${cities.length} < ${MIN_CITIES} - 응답 구조 변경 의심`);
  }
  if (withStops.length < MIN_WITH_STOPS) {
    throw new Error(`등록 있는 도시 부족: ${withStops.length} < ${MIN_WITH_STOPS}`);
  }
  // stops=0은 곧 미커버 판정이라 **정확히 golden 하나**여야 한다. 수치 하한(위)만으로는
  // 일시 0이 서넛 섞여도 통과한다(실측: 134/138로 통과했고 그중 셋이 가짜 0이었다).
  const zeros = cities.filter((c) => c.stops === 0);
  const unexpected = zeros.filter((c) => !c.names.includes(GOLDEN_ZERO));
  if (unexpected.length > 0) {
    throw new Error(
      `예상 밖 stops=0: ${unexpected.map((c) => `${c.code}(${c.names.join("/")})`).join(", ")} - ` +
        `일시 0(HTTP 200 + totalCount:0)일 가능성이 크다. 재실행해 재현되면 그 도시가 ` +
        `실제로 데이터를 잃은 것이니 golden을 갱신하라`,
    );
  }
  if (!allNames.includes(GOLDEN_PRESENT)) {
    throw new Error(`golden 부재: ${GOLDEN_PRESENT}가 목록에 없다`);
  }
  if (allNames.includes(GOLDEN_ABSENT)) {
    throw new Error(
      `golden 위반: ${GOLDEN_ABSENT}가 목록에 생겼다: TAGO가 커버를 넓혔다면 ` +
        `이 seed의 전제가 바뀐 것이니 스펙과 테스트를 함께 갱신하라`,
    );
  }
  const zero = cities.find((c) => c.names.includes(GOLDEN_ZERO));
  if (!zero || zero.stops !== 0) {
    throw new Error(
      `golden 위반: ${GOLDEN_ZERO} stops=${zero?.stops}: "코드는 있고 데이터는 없다"는 ` +
        `상태가 사라졌다면 stops 필드의 존재 이유를 재검토하라`,
    );
  }

  writeFileSync(OUT, `${JSON.stringify({ cities }, null, 1)}\n`, "utf-8");
  const total = cities.reduce((a, c) => a + c.stops, 0);
  console.log(
    `도시 ${cities.length}개(등록 있음 ${withStops.length}) · 정류소 합계 ${total.toLocaleString()}개 → ${OUT}`,
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
