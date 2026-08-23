// 전국횡단보도표준데이터(공공데이터포털 15028201) seed 생성
// spec docs/superpowers/specs/2026-08-23-crosswalk-lanes-length-design.md §2
//
// 재생성(반기 갱신 데이터 — 연 1~2회):
//   DATA_GO_KR_API_KEY=… node scripts/build-crosswalk-seed.mjs
//   (.env.local이 있으면 거기서 키를 읽는다)
//
// ⚠ 봉투는 `response` 래퍼 없는 `{header, body}` 최상위다 — 공용 datagokr-envelope
// 파서 스코프 밖이라 여기서 직접 읽는다. 빈 값은 공백 한 칸(" ")이라 trim 없이는
// "채워져 있다"로 보인다. 범위 밖 페이지는 resultCode "03" NODATA_ERROR + body null.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

export const ENDPOINT = "https://api.data.go.kr/openapi/tn_pubr_public_crosswalk_api";
const PAGE_SIZE = 1000;
const MAX_PAGES = 200; // 실측 59페이지 — 무한 페이지(프록시·캐시 오류) 방어
const MIN_TOTAL = 50_000;
const MIN_SIDO = 15;
const MIN_PARSE_RATIO = 0.99;
/** 연장(et) 타당 범위. 실측 최대 302m(오기) — 1차로 7m ~ 9차로 30m가 중위. */
export const LENGTH_MIN_M = 1;
export const LENGTH_MAX_M = 60;
// 한국 상자(coverage.ts isInKorea와 같은 값 — 스크립트는 src를 import하지 않는다)
const KOREA = { latMin: 31.43, latMax: 44.35, lngMin: 122.37, lngMax: 132.0 };

/** 한 페이지 봉투를 읽는다. 끝 신호(03 NODATA)는 빈 배열, 그 외 오류는 throw. */
export function readPage(data) {
  if (typeof data !== "object" || data === null) {
    throw new Error("JSON이 아닌 본문(키 만료·게이트웨이 오류 의심)");
  }
  const code = data.header?.resultCode;
  if (code === "03") return { items: [], totalCount: 0 };
  if (code !== "00") throw new Error(`resultCode ${code}: ${data.header?.resultMsg ?? ""}`);
  const item = data.body?.items?.item;
  const items = Array.isArray(item) ? item : item ? [item] : [];
  return { items, totalCount: Number(data.body?.totalCount ?? 0) };
}

function num(v) {
  const s = typeof v === "string" ? v.trim() : "";
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const round = (v, d) => Number(v.toFixed(d));

/** 행 목록 → seed. 가드는 전부 throw(조용한 열화 금지). */
export function buildSeed(rows, { now }) {
  if (rows.length < MIN_TOTAL) throw new Error(`총건수 이상: ${rows.length} < ${MIN_TOTAL}`);
  const sidos = new Set(rows.map((r) => (r.ctprvnNm ?? "").trim()).filter(Boolean));
  if (sidos.size < MIN_SIDO) throw new Error(`시도 수 이상: ${sidos.size} < ${MIN_SIDO}`);

  let unparsed = 0, lengthOutOfRange = 0, duplicates = 0;
  const seen = new Set();
  const crosswalks = [];
  for (const r of rows) {
    const lat = num(r.latitude), lng = num(r.longitude);
    const lanes = num(r.cartrkCo), length = num(r.et);
    if (lat === null || lng === null || lanes === null || length === null) {
      unparsed++;
      continue;
    }
    if (lat < KOREA.latMin || lat > KOREA.latMax || lng < KOREA.lngMin || lng > KOREA.lngMax) {
      throw new Error(`한국 상자 밖 좌표: ${lat},${lng} (좌표계 회귀 의심)`);
    }
    if (length < LENGTH_MIN_M || length > LENGTH_MAX_M || lanes < 1) {
      lengthOutOfRange++;
      continue;
    }
    const tuple = [round(lat, 5), round(lng, 5), Math.round(lanes), round(length, 1)];
    const key = tuple.join(",");
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    crosswalks.push(tuple);
  }
  const parseRatio = (rows.length - unparsed) / rows.length;
  if (parseRatio < MIN_PARSE_RATIO) {
    throw new Error(`차로·연장 파싱률 이상: ${(parseRatio * 100).toFixed(2)}%`);
  }
  crosswalks.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return {
    meta: {
      source: "data.go.kr 15028201 전국횡단보도표준데이터 (tn_pubr_public_crosswalk_api)",
      fetchedAt: now,
      counts: { total: rows.length, unparsed, lengthOutOfRange, duplicates, kept: crosswalks.length },
    },
    crosswalks,
  };
}

export async function fetchAll(key, fetchImpl = fetch) {
  const rows = [];
  for (let page = 1; ; page++) {
    if (page > MAX_PAGES) throw new Error(`페이지 ${MAX_PAGES} 초과 — upstream 페이지네이션 이상`);
    const url = `${ENDPOINT}?serviceKey=${key}&pageNo=${page}&numOfRows=${PAGE_SIZE}&type=json`;
    const res = await fetchImpl(url);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`페이지 ${page} JSON 파싱 실패(HTTP ${res.status}): ${text.slice(0, 120)}`);
    }
    const { items } = readPage(data);
    if (items.length === 0) break;
    rows.push(...items);
    process.stderr.write(`페이지 ${page}: 누적 ${rows.length}\n`);
    if (items.length < PAGE_SIZE) break;
  }
  return rows;
}

function readKey() {
  if (process.env.DATA_GO_KR_API_KEY) return process.env.DATA_GO_KR_API_KEY;
  if (existsSync(".env.local")) {
    const m = readFileSync(".env.local", "utf8").match(/^DATA_GO_KR_API_KEY=(.*)$/m);
    if (m) return m[1].trim().replace(/^"|"$/g, "");
  }
  throw new Error("DATA_GO_KR_API_KEY 없음");
}

const isMain = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (isMain) {
  const rows = await fetchAll(readKey());
  const seed = buildSeed(rows, { now: new Date().toISOString() });
  writeFileSync("src/lib/data/crosswalks.json", JSON.stringify(seed));
  console.log("생성 완료:", seed.meta.counts);
}
