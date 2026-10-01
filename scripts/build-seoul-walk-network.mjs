/**
 * 서울시 도보 네트워크(서울 열린데이터광장 OA-21208) 정적 seed 빌드 — 나들이 횡단보도 예고·교차로 예고
 * 원천(E58 ①③, spec `2026-09-26-outing-mode-design.md` §6.6). 출처 표시: "서울특별시 공공데이터".
 *
 * 받는 길은 **시트 CSV 한 파일**이다(약 112MB, CP949). ⚠ OpenAPI(`TbTraficWlkNet`)로 받지 않는다:
 * 페이지 순서가 안정적이지 않아 같은 범위를 다섯 번 훑어도 행이 빠지고(연구 §3.3), 서울 전역은 서울 열린데이터
 * 키의 하루 쿼터(따릉이·문화행사·혼잡도와 공유 1,000회)를 넘는다. CSV는 쿼터를 쓰지 않는다.
 *
 * 산출(`src/lib/data/seoul-walk-network.json`):
 * - `crosswalks`: 횡단보도 하나에 점 하나. 데이터는 횡단보도를 **양 끝이 횡단보도 노드(`CRSWK=1`)인 링크**로 그린다 —
 *   그 링크의 중점을 싣고, 짝 링크가 없는 횡단보도 노드는 노드 자체를 싣는다. 노드를 그대로 실으면 한 횡단보도를
 *   두 번 예고한다(연구 §7). ⚠ **링크 행의 시설 플래그 열(고가도로~건물내)은 믿지 않는다**: 짝 링크 16,020개 중
 *   11,430개가 `횡단보도`가 아니라 `건물내` 열에 1을 갖는다(2026-10-02 CSV 실측, 연구 §3.3의 "링크 CRSWK는 뜻이
 *   다르다"와 같은 현상). 그래서 횡단보도는 노드 플래그로만 읽고, 지하·건물 내 링크도 열로 거르지 않는다(지하철
 *   출입구에 닿는 링크가 서울 전체 157개뿐이라 지상 판정에 주는 영향이 작다).
 * - `junctions`: 보행 가능 링크(유형 코드 첫 자리 보행자 = 1)에서 횡단보도 링크를 뺀 그래프의
 *   3갈래 이상 노드. 갈래 부호는 `build-osm-walk-junctions.mjs`와 같다(kind × 36 + 방위/10). 차량 겸용 링크
 *   (둘째 자리 1)는 골목, 보행 전용은 보행로다. 이 자료에는 큰길 종류가 없다(큰길은 보도 링크로만 그려진다).
 * - `cells`: 노드가 하나라도 있는 0.01도 격자 칸 — 제공 범위. 서울 밖(경기)은 미제공이고 0건이 아니다.
 *
 * ⚠ **이 seed를 OSM seed(ODbL)와 한 파일로 합치지 말 것.** 병합은 런타임(`walk-infra.ts`)에서만.
 *
 * 실행: node scripts/build-seoul-walk-network.mjs [--csv <경로>] [--save-csv <경로>]
 *   --csv: 이미 받은 CSV를 쓴다(무호출 재생성). 없으면 열린데이터광장에서 한 번 받는다.
 * 갱신: 연 1회. 데이터 내용은 2020년 기준 구축이다(메타의 갱신 주기 "매일"은 재적재일 뿐이다).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";
import {
  BRANCH_REACH_METERS,
  STUB_METERS,
  KIND,
  bearingDegrees,
  encodeBranch,
  haversineMeters,
  walkAlong,
} from "./build-osm-walk-junctions.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(ROOT, "src/lib/data/seoul-walk-network.json");

const CSV_URL = "https://datafile.seoul.go.kr/bigfile/iot/sheet/csv/download.do";
const CSV_FORM = "srvType=S&infId=OA-21208&serviceKind=1&pageNo=1&strOrderby=&filterCol=%ED%95%84%ED%84%B0%EC%84%A0%ED%83%9D&txtFilter=";
const REFERER = "https://data.seoul.go.kr/dataList/OA-21208/S/1/datasetView.do";
/** 서버 총계(2026-10-02 실측 491,082). 이보다 적게 오면 부분 응답이다. */
const MIN_ROWS = 480_000;

/** 따옴표 CSV 한 줄 → 칸. 칸 안 쉼표(WKT)는 따옴표가 감싼다. */
export function parseCsvLine(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let j = i + 1;
      let s = "";
      for (;;) {
        const k = line.indexOf('"', j);
        if (k < 0) throw new Error("닫히지 않은 따옴표");
        s += line.slice(j, k);
        if (line[k + 1] === '"') {
          s += '"';
          j = k + 2;
          continue;
        }
        i = k + 1;
        break;
      }
      out.push(s);
    } else {
      const k = line.indexOf(",", i);
      out.push(line.slice(i, k < 0 ? line.length : k));
      i = k < 0 ? line.length : k;
    }
    if (line[i] === ",") i += 1;
    else break;
  }
  return out;
}

const nums = (wkt) => (wkt.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
/** `POINT(lng lat)` → [lat, lng]. */
export function parsePoint(wkt) {
  const v = nums(wkt);
  return [v[1], v[0]];
}
/** `LINESTRING(lng lat, …)` → [[lat, lng], …]. */
export function parseLine(wkt) {
  const v = nums(wkt);
  const pts = [];
  for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i + 1], v[i]]);
  return pts;
}

/** 링크 유형 코드(보행자·차량·자전거·PM 네 자리) → 갈래 종류. 보행 불가면 null. */
export function linkKind(code) {
  if (code?.[0] !== "1") return null;
  return code[1] === "1" ? KIND.alley : KIND.path;
}

const cellKey = (lat, lng) => Math.floor(lat * 100) * 100_000 + Math.floor(lng * 100);

/**
 * CSV 행(헤더 제외) → seed(순수).
 * @param {string[][]} rows
 */
export function buildSeoulWalkNetwork(rows, header) {
  const col = (name) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`열 없음: ${name}`);
    return i;
  };
  const C = {
    kind: col("노드링크 유형"), nodeWkt: col("노드 WKT"), nodeId: col("노드 ID"), linkWkt: col("링크 WKT"),
    linkCode: col("링크 유형 코드"), from: col("시작노드 ID"), to: col("종료노드 ID"),
    crosswalk: col("횡단보도"),
  };
  /** @type {Map<string, {pt:[number,number], cw:boolean}>} */
  const nodes = new Map();
  const links = [];
  for (const r of rows) {
    if (r[C.kind] === "NODE") {
      nodes.set(r[C.nodeId], { pt: parsePoint(r[C.nodeWkt]), cw: r[C.crosswalk] === "1" });
    } else if (r[C.kind] === "LINK") {
      links.push(r);
    }
  }

  const crosswalkPts = [];
  const pairedNodes = new Set();
  /** @type {Map<string, Array<{pts:Array<[number,number]>, kind:number, other:string}>>} */
  const ends = new Map();
  for (const r of links) {
    const kind = linkKind(r[C.linkCode]);
    if (kind === null) continue;
    const a = nodes.get(r[C.from]);
    const b = nodes.get(r[C.to]);
    if (!a || !b) continue;
    if (a.cw && b.cw) {
      crosswalkPts.push([(a.pt[0] + b.pt[0]) / 2, (a.pt[1] + b.pt[1]) / 2]);
      pairedNodes.add(r[C.from]);
      pairedNodes.add(r[C.to]);
      continue;
    }
    let pts = parseLine(r[C.linkWkt]);
    if (pts.length < 2) pts = [a.pt, b.pt];
    // WKT 방향이 시작 노드에서 출발한다는 보장이 없다 — 가까운 끝으로 맞춘다.
    const startsAtA =
      haversineMeters(pts[0][0], pts[0][1], a.pt[0], a.pt[1]) <=
      haversineMeters(pts[0][0], pts[0][1], b.pt[0], b.pt[1]);
    const fwd = startsAtA ? pts : [...pts].reverse();
    const push = (id, line, other) => {
      if (!ends.has(id)) ends.set(id, []);
      ends.get(id).push({ pts: line, kind, other });
    };
    push(r[C.from], [a.pt, ...fwd.slice(1)], r[C.to]);
    push(r[C.to], [b.pt, ...[...fwd].reverse().slice(1)], r[C.from]);
  }
  for (const [id, n] of nodes) if (n.cw && !pairedNodes.has(id)) crosswalkPts.push(n.pt);

  const degree = (id) => ends.get(id)?.length ?? 0;
  /** 갈래를 2갈래 노드를 지나 이어 가며 `BRANCH_REACH_METERS`까지(또는 분기·막다른 점까지) 따라간다. */
  const trace = (id, first) => {
    let pts = first.pts;
    let prev = id;
    let at = first.other;
    let len = 0;
    for (let i = 1; i < pts.length; i += 1) len += haversineMeters(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    while (degree(at) === 2 && len < BRANCH_REACH_METERS) {
      const next = ends.get(at).find((e) => e.other !== prev) ?? null;
      if (!next) break;
      for (let i = 1; i < next.pts.length; i += 1) {
        len += haversineMeters(next.pts[i - 1][0], next.pts[i - 1][1], next.pts[i][0], next.pts[i][1]);
      }
      pts = [...pts, ...next.pts.slice(1)];
      prev = at;
      at = next.other;
    }
    return { pts, len, deadEnd: degree(at) === 1 };
  };

  const junctions = [];
  for (const [id, list] of ends) {
    if (list.length < 3) continue;
    const pt = nodes.get(id).pt;
    const codes = [];
    for (const e of list) {
      const t = trace(id, e);
      if (t.deadEnd && t.len < STUB_METERS) continue;
      const { point } = walkAlong(t.pts, BRANCH_REACH_METERS);
      codes.push(encodeBranch(e.kind, bearingDegrees(pt[0], pt[1], point[0], point[1])));
    }
    const unique = [...new Set(codes)].sort((a, b) => a - b);
    if (unique.length >= 3) junctions.push([Number(pt[0].toFixed(5)), Number(pt[1].toFixed(5)), unique]);
  }

  const round = ([lat, lng]) => [Number(lat.toFixed(5)), Number(lng.toFixed(5))];
  const seen = new Set();
  const crosswalks = [];
  for (const p of crosswalkPts.map(round)) {
    const k = `${p[0]},${p[1]}`;
    if (seen.has(k)) continue;
    seen.add(k);
    crosswalks.push(p);
  }
  const cells = [...new Set([...nodes.values()].map((n) => cellKey(n.pt[0], n.pt[1])))].sort((a, b) => a - b);
  return {
    crosswalks: crosswalks.sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    junctions: junctions.sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    cells,
    counts: { rows: rows.length, nodes: nodes.size, links: links.length },
  };
}

// 가드(2026-10-02 실측 약 75% 선).
const MIN_CROSSWALKS = 7_000;
const MIN_JUNCTIONS = 60_000;
/** 서울 25개 구 대표 좌표가 제공 칸 안인가(구청 기준 근사). 칸 결손 = 부분 응답. */
export const GOLDEN_DISTRICTS = [
  [37.5735, 126.979], [37.5636, 126.9976], [37.5326, 126.9905], [37.5634, 127.0369], [37.5384, 127.0822],
  [37.5744, 127.0396], [37.6063, 127.0925], [37.5894, 127.0167], [37.6396, 127.0257], [37.6688, 127.0471],
  [37.6543, 127.0568], [37.6027, 126.9291], [37.5791, 126.9368], [37.5663, 126.9019], [37.5169, 126.8664],
  [37.5509, 126.8495], [37.4955, 126.8875], [37.4569, 126.8955], [37.5264, 126.8962], [37.5124, 126.9393],
  [37.4784, 126.9516], [37.4837, 127.0324], [37.5172, 127.0473], [37.5145, 127.1059], [37.5301, 127.1238],
];
/** 바깥 표본(경기) — 제공 칸이 아니어야 한다. */
export const GOLDEN_OUTSIDE = [[37.4138, 127.5183], [37.2636, 127.0286]];

export function validateSeoulWalkNetwork(seed) {
  if (seed.crosswalks.length < MIN_CROSSWALKS) throw new Error(`S1 횡단보도 ${seed.crosswalks.length} < ${MIN_CROSSWALKS}`);
  if (seed.junctions.length < MIN_JUNCTIONS) throw new Error(`S2 교차점 ${seed.junctions.length} < ${MIN_JUNCTIONS}`);
  const cells = new Set(seed.cells);
  for (const [lat, lng] of GOLDEN_DISTRICTS) {
    if (!cells.has(cellKey(lat, lng))) throw new Error(`S3 서울 표본 (${lat}, ${lng})이 제공 칸 밖 — 자치구 결손`);
  }
  for (const [lat, lng] of GOLDEN_OUTSIDE) {
    if (cells.has(cellKey(lat, lng))) throw new Error(`S4 서울 밖 표본 (${lat}, ${lng})이 제공 칸 안`);
  }
  for (const [, , br] of seed.junctions) {
    if (br.length < 3 || br.some((c) => !Number.isInteger(c) || c < 0 || c >= 108)) throw new Error(`S5 갈래 부호 이상 ${br}`);
  }
}

async function downloadCsv() {
  const res = await fetch(CSV_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: REFERER, "User-Agent": "Mozilla/5.0" },
    body: CSV_FORM,
  });
  if (!res.ok) throw new Error(`CSV HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : null;
  };
  const csvPath = arg("--csv");
  const buf = csvPath ? readFileSync(csvPath) : await downloadCsv();
  const save = arg("--save-csv");
  if (save && !csvPath) writeFileSync(save, buf);
  const text = new TextDecoder("euc-kr").decode(buf);
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map(parseCsvLine);
  if (rows.length < MIN_ROWS) throw new Error(`S0 CSV ${rows.length}행 < ${MIN_ROWS} — 부분 응답`);
  const built = buildSeoulWalkNetwork(rows, header);
  validateSeoulWalkNetwork(built);
  const collected = rows.reduce((max, r) => (r[r.length - 1] > max ? r[r.length - 1] : max), "");
  const seed = {
    meta: {
      source: "서울특별시 공공데이터(서울 열린데이터광장 OA-21208 서울시 자치구별 도보 네트워크 공간정보)",
      attribution: "서울특별시 공공데이터",
      license: "공공누리 제1유형(출처표시)",
      licenseUrl: "https://www.kogl.or.kr/info/licenseType1.do",
      datasetUrl: REFERER,
      basis: "2020년 기준 구축",
      collectedAt: collected.slice(0, 10),
      cellDegrees: 0.01,
      branch: { reachMeters: BRANCH_REACH_METERS, stubMeters: STUB_METERS, encoding: "kind*36+round(bearing/10)", kinds: KIND },
      counts: { ...built.counts, crosswalks: built.crosswalks.length, junctions: built.junctions.length, cells: built.cells.length },
    },
    crosswalks: built.crosswalks,
    junctions: built.junctions,
    cells: built.cells,
  };
  const body = `${JSON.stringify(seed)}\n`;
  writeFileSync(OUT, body);
  console.log(
    `완료: 횡단보도 ${built.crosswalks.length} · 교차점 ${built.junctions.length} · 칸 ${built.cells.length} · ${(body.length / 1e6).toFixed(2)}MB → ${OUT}`,
  );
}

const isMain = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (isMain) {
  main().catch((e) => {
    console.error("실패:", e.message);
    process.exit(1);
  });
}
