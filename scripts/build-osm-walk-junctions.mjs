/**
 * OSM 도로망 교차점(갈림길) 정적 seed 빌드 — 나들이 교차로 예고(E58 ①, spec
 * `2026-09-26-outing-mode-design.md` §6.6) 원천.
 *
 * 교차점 = 보행 가능한 way 그래프에서 **3갈래 이상이 만나는 노드**. 갈래마다 그 노드에서 way를
 * 따라 `BRANCH_REACH_METERS` 간 지점의 방위(10도 단위)와 길 종류(골목·큰길·보행로)를 싣는다.
 * 좌우는 seed가 정하지 않는다 — 런타임이 갈래 끝점을 만들어 Kit `outingProject`로 판정한다.
 *
 * 원천은 **BBBike 서울 추출본**(`Seoul.osm.gz`, OSM XML, 주 1회 갱신, osmium 산출이라 경계를 걸친 way는 완전하다)이다.
 * ⚠ 공개 Overpass로 받지 않는다: 서울 bbox 0.05도 타일 63개를 2026-10-02에 받으려다 504·429가 이어져 40분에
 * 14타일에서 멈췄다(같은 날 다른 공개 인스턴스는 닿지 않았다). 추출본은 한 파일이고 같은 OSM 데이터(ODbL)다.
 *
 * ⚠ **범위는 서울 bbox다(`REGION`, 추출본 경계 안쪽).** 전국 교차점은 상한 약 290만 점이라(연구
 * `RESEARCH-2026-10-02-outing-walk-network.md` §2.4) 한 파일로 함수 번들에 싣지 못한다. 서울을 먼저 내고
 * 크기를 쟀다(빌드 출력의 바이트 수). 범위 밖은 0건이 아니라 미제공이다(`osm-walk-junctions.ts`가 `meta.region`으로 판정).
 *
 * ⚠ **이 seed를 서울 도보 네트워크 seed(공공데이터)와 한 파일로 합치지 말 것.** 병합본은 ODbL상
 * Derivative Database가 된다(`build-osm-walk-nodes.mjs` 머리말과 같은 이유). 병합은 런타임에서만.
 *
 * 실행: node scripts/build-osm-walk-junctions.mjs [--osm <Seoul.osm.gz 경로>]
 *   --osm: 이미 받은 추출본을 쓴다(무호출 재생성). 없으면 BBBike에서 한 번 받는다(약 113MB).
 * 산출: src/lib/data/osm-walk-junctions.json
 * 갱신: 연 1회(`osm-walk-nodes.json`과 같은 주기).
 */
import { createReadStream, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(ROOT, "src/lib/data/osm-walk-junctions.json");

const EXTRACT_URL = "https://download.bbbike.org/osm/bbbike/Seoul/Seoul.osm.gz";
const USER_AGENT = "gildongmu-seed-build/1.0 (+https://gildongmu.dodoplanet.space)";

/** seed가 담는 범위(서울 + 경계 여유, 연구 §2.4의 서울 bbox). 런타임 판정(`osm-walk-junctions.ts`)이 meta에서 읽는다. */
export const REGION = { latMin: 37.413, latMax: 37.715, lngMin: 126.764, lngMax: 127.184 };

/** 갈래 방위를 재는 거리(m). 갈래가 이보다 짧으면 끝 노드까지. */
export const BRANCH_REACH_METERS = 25;
/** 이보다 짧게 끝나는 막다른 갈래(건물 진입로·출입구 꼬리)는 갈래로 세지 않는다. */
export const STUB_METERS = 20;

/** 읽어 두는 `highway` 값(변형 비교용으로 넓게 받고, 갈래는 `wayKind`가 고른다). */
const HIGHWAY_VALUES = [
  "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link",
  "tertiary", "tertiary_link", "unclassified", "residential", "living_street", "service",
  "pedestrian", "footway", "path", "steps", "cycleway", "track", "corridor",
];

const MAJOR = new Set([
  "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link",
]);
const MINOR = new Set(["unclassified", "residential", "living_street", "service"]);
const FOOT = new Set(["pedestrian", "footway", "path"]);

/** 갈래 종류 코드(seed 정수의 몫). 0 골목(작은 차도) · 1 큰길(tertiary 이상) · 2 보행로. */
export const KIND = { alley: 0, road: 1, path: 2 };

/**
 * 이 way가 갈래가 되는가(변형 B, 연구 §7의 A·C 사이 — 재생 비교는 spec §11.2).
 * - 큰길·작은 차도·보행로(footway·pedestrian·path).
 * - ⚠ 계단(`steps`)은 뺀다: 문장에 "계단"이 없어 "오른쪽에 길"로 들은 사용자가 그쪽으로 틀면 계단이다(설계 리뷰 m5).
 * - ⚠ `footway=crossing`(횡단보도 선)·`footway=sidewalk`(따로 그린 보도)는 뺀다: 횡단보도 선은 차도를 가로질러
 *   "옆에 길"을 만들고, 보도 선은 차도 중심선과 같은 길을 한 번 더 세어 모퉁이마다 거짓 갈래를 만든다.
 * - `service`는 주차 통로·드라이브스루·진입로를 뺀다(골목이 아닌 곳에서 "골목" 문장이 난다, 연구 §7 ③).
 * - 자전거도로·농로(`track`)·건물 통로(`corridor`)·면(`area=yes`)은 뺀다.
 * - ⚠ 지상이 아닌 **보행로**(`indoor=yes`·`tunnel=yes|culvert`·음수 `layer`·음수 `level`)와 보행 금지(`foot=no`)는 뺀다:
 *   지상 보도를 걷는 사용자 바로 아래 지하상가·지하보도 통로의 교차점이 앞 20m에 들면 거짓 갈림길이 난다(구현 리뷰 m5).
 *   차도의 굴다리는 보행자도 지나는 길이라 남긴다(빼면 짧은 굴다리 진입부가 막다른 꼬리로 접혀 사거리가 삼거리가 된다).
 *   `tunnel=building_passage`(건물 1층을 지나는 통로)는 지상이라 남긴다. 육교(`bridge=yes`)도 남긴다 — 육교 보행로는
 *   지상 길과 계단·경사로 끝점에서만 노드를 공유해 그 자리(실제로 오르내리는 갈림길)에만 교차점을 만든다.
 */
export function wayKind(tags) {
  const hw = tags?.highway;
  if (!hw || tags.area === "yes") return null;
  if (tags.foot === "no") return null;
  const below = (v) => v !== undefined && Number.parseFloat(String(v).split(";")[0]) < 0;
  const underground =
    tags.indoor === "yes" || ["yes", "culvert"].includes(tags.tunnel) || below(tags.layer) || below(tags.level);
  if (underground && FOOT.has(hw)) return null;
  if (MAJOR.has(hw)) return KIND.road;
  if (MINOR.has(hw)) {
    if (hw === "service" && ["parking_aisle", "drive-through", "driveway", "emergency_access"].includes(tags.service)) {
      return null;
    }
    return KIND.alley;
  }
  if (FOOT.has(hw)) {
    if (tags.footway === "crossing" || tags.footway === "sidewalk") return null;
    return KIND.path;
  }
  return null;
}

export function haversineMeters(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const p1 = (aLat * Math.PI) / 180;
  const p2 = (bLat * Math.PI) / 180;
  const dp = ((bLat - aLat) * Math.PI) / 180;
  const dl = ((bLng - aLng) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearingDegrees(aLat, aLng, bLat, bLng) {
  const p1 = (aLat * Math.PI) / 180;
  const p2 = (bLat * Math.PI) / 180;
  const dl = ((bLng - aLng) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * 폴리라인 `pts`(첫 점 = 교차점)를 따라 `reach`m 간 지점(짧으면 끝점)과 실제 길이.
 * @param {Array<[number, number]>} pts
 */
export function walkAlong(pts, reach) {
  let acc = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const seg = haversineMeters(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    if (acc + seg >= reach && seg > 0) {
      const f = (reach - acc) / seg;
      return {
        point: [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f],
        length: reach,
      };
    }
    acc += seg;
  }
  return { point: pts[pts.length - 1], length: acc };
}

/** 갈래 하나 → seed 정수(kind × 36 + 방위/10). */
export function encodeBranch(kind, bearing) {
  return kind * 36 + (Math.round(bearing / 10) % 36);
}

/**
 * 교차점 계산(순수).
 * @param {Array<{id:number,nodes:number[],tags:object}>} ways
 * @param {Map<number,[number,number]>} coords 노드 id → [lat, lng]
 * @returns {Array<[number, number, number[]]>} [lat5, lng5, 갈래 정수(오름차순)]
 *
 * 갈래 = (way, 방향) 하나. 그 노드에서 way를 따라 다음 3갈래 이상 노드나 way 끝까지 간 거리가
 * `STUB_METERS`보다 짧고 그 끝이 막다른 점(차수 1)이면 갈래로 세지 않는다 — 건물 진입로·출입구 꼬리가
 * 갈림길로 들리지 않게 한다. 차수는 그 꼬리를 빼고 다시 센다(한 번). 같은 교차점의 같은 정수는 하나로.
 */
export function computeJunctions(ways, coords) {
  /** @type {Map<number, Array<{way:number, idx:number, dir:1|-1, kind:number}>>} */
  const ends = new Map();
  const walkWays = [];
  for (const w of ways) {
    const kind = wayKind(w.tags);
    if (kind === null) continue;
    const nodes = w.nodes.filter((n) => coords.has(n));
    if (nodes.length < 2) continue;
    const wi = walkWays.length;
    walkWays.push({ nodes, kind });
    nodes.forEach((n, i) => {
      if (!ends.has(n)) ends.set(n, []);
      if (i > 0) ends.get(n).push({ way: wi, idx: i, dir: -1, kind });
      if (i < nodes.length - 1) ends.get(n).push({ way: wi, idx: i, dir: 1, kind });
    });
  }
  const degree = (n) => ends.get(n)?.length ?? 0;

  /**
   * (n에서 출발한 갈래) → 폴리라인 점들, 길이, 막다른 끝인가. 차수 2 노드에서는 **다른 way로도 이어 간다** —
   * OSM은 태그가 바뀌는 자리(footway → steps 등)마다 way를 쪼개므로, way 끝에서 멈추면 두 조각으로 그려진 건물
   * 진입로가 막다른 꼬리로 잡히지 않는다(설계 리뷰 M3, 서울망 `trace`와 같은 규칙).
   */
  const trace = (n, first) => {
    const pts = [coords.get(n)];
    let e = first;
    let at = n;
    let len = 0;
    for (;;) {
      const w = walkWays[e.way];
      const next = e.idx + e.dir;
      const a = coords.get(at);
      const nb = w.nodes[next];
      const b = coords.get(nb);
      len += haversineMeters(a[0], a[1], b[0], b[1]);
      pts.push(b);
      at = nb;
      const deg = degree(at);
      if (deg !== 2 || len >= BRANCH_REACH_METERS) return { pts, len, deadEnd: deg === 1 };
      // 차수 2: 들어온 항목(같은 way의 반대 방향)이 아닌 나머지 하나로 계속.
      const cont = ends.get(at).find((x) => !(x.way === e.way && x.idx === next && x.dir === -e.dir));
      if (!cont || at === n) return { pts, len, deadEnd: false };
      e = cont;
    }
  };

  const out = [];
  for (const [n, list] of ends) {
    if (list.length < 3) continue;
    const branches = [];
    for (const e of list) {
      const t = trace(n, e);
      if (t.deadEnd && t.len < STUB_METERS) continue;
      const { point } = walkAlong(t.pts, BRANCH_REACH_METERS);
      const [lat, lng] = coords.get(n);
      branches.push(encodeBranch(e.kind, bearingDegrees(lat, lng, point[0], point[1])));
    }
    const unique = [...new Set(branches)].sort((a, b) => a - b);
    if (unique.length < 3) continue;
    const [lat, lng] = coords.get(n);
    out.push([Number(lat.toFixed(5)), Number(lng.toFixed(5)), unique]);
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

// 가드 기준(2026-10-02 서울 bbox 실측의 약 75% 선). 부분 응답·질의 오타를 잡는다.
const MIN_JUNCTIONS = 60_000;
/** 길동역 표본 — 주택가 골목 격자가 들어왔는가(역 주변은 골목 격자다). */
export const GOLDEN_GILDONG = { name: "길동역", lat: 37.5379, lng: 127.1400, radiusMeters: 200, min: 15 };

export function validateJunctions(junctions, region = REGION) {
  if (junctions.length < MIN_JUNCTIONS) throw new Error(`J1 교차점 ${junctions.length} < ${MIN_JUNCTIONS}`);
  for (const [lat, lng, br] of junctions) {
    if (lat < region.latMin || lat > region.latMax || lng < region.lngMin || lng > region.lngMax) {
      throw new Error(`J2 범위 밖 교차점 (${lat}, ${lng})`);
    }
    if (br.length < 3 || br.some((c) => !Number.isInteger(c) || c < 0 || c >= 108)) {
      throw new Error(`J3 갈래 부호 이상 (${lat}, ${lng}) ${br}`);
    }
  }
  const g = GOLDEN_GILDONG;
  const near = junctions.filter(([lat, lng]) => haversineMeters(g.lat, g.lng, lat, lng) <= g.radiusMeters).length;
  if (near < g.min) throw new Error(`J4 ${g.name} ${g.radiusMeters}m 안 교차점 ${near} < ${g.min} — 골목 결손 의심`);
  return { total: junctions.length, gildong: near };
}

/** OSM XML 속성 하나. */
const attr = (line, name) => {
  const m = line.match(new RegExp(` ${name}="([^"]*)"`));
  return m ? m[1] : null;
};

/** gz 추출본을 줄 단위로 훑는다(osmium XML은 원소·자식이 한 줄씩이다). */
async function eachLine(path, fn) {
  const rl = createInterface({ input: createReadStream(path).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) fn(line);
}

/**
 * 두 번 훑는다: ① way(태그·노드 목록, `HIGHWAY_VALUES`만) ② 그 way가 쓰는 노드 좌표. 추출본은 노드가 way보다 앞에
 * 오므로 한 번에 읽으면 서울 전체 노드를 다 들고 있어야 한다.
 */
export async function readExtract(path) {
  const keep = new Set(HIGHWAY_VALUES);
  const ways = [];
  let cur = null;
  await eachLine(path, (line) => {
    const t = line.trimStart();
    if (t.startsWith("<way ")) {
      cur = { id: Number(attr(t, "id")), nodes: [], tags: {} };
      if (t.endsWith("/>")) cur = null;
    } else if (cur && t.startsWith("<nd ")) {
      cur.nodes.push(Number(attr(t, "ref")));
    } else if (cur && t.startsWith("<tag ")) {
      cur.tags[attr(t, "k")] = attr(t, "v");
    } else if (cur && t.startsWith("</way>")) {
      if (keep.has(cur.tags.highway)) ways.push(cur);
      cur = null;
    }
  });
  const need = new Set();
  for (const w of ways) for (const n of w.nodes) need.add(n);
  const coords = new Map();
  await eachLine(path, (line) => {
    const t = line.trimStart();
    if (!t.startsWith("<node ")) return;
    const id = Number(attr(t, "id"));
    if (need.has(id)) coords.set(id, [Number(attr(t, "lat")), Number(attr(t, "lon"))]);
  });
  return { ways, coords };
}

async function download(to) {
  const res = await fetch(EXTRACT_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`추출본 HTTP ${res.status}`);
  const { createWriteStream } = await import("node:fs");
  const { pipeline } = await import("node:stream/promises");
  await pipeline(Readable.fromWeb(res.body), createWriteStream(to));
  return { lastModified: res.headers.get("last-modified") };
}

async function main() {
  const i = process.argv.indexOf("--osm");
  let path = i > 0 ? process.argv[i + 1] : null;
  let lastModified = null;
  let fileTime = null;
  if (path) {
    // 무호출 재생성도 시점을 남긴다(ODbL 파생 DB의 데이터 시점, 구현 리뷰 n8). 로컬 파일 시각은 추출본 시각이 아니라 받은 시각이라
    // 네트워크 경로의 `extractLastModified`(BBBike 서버 시각)와 필드를 가른다.
    const { statSync } = await import("node:fs");
    fileTime = statSync(path).mtime.toUTCString();
  } else {
    path = join(tmpdir(), "gildongmu-seoul.osm.gz");
    console.log("① BBBike 서울 추출본 받는 중(약 113MB)...");
    ({ lastModified } = await download(path));
  }
  console.log("② 추출본 훑는 중(두 번)...");
  const { ways, coords } = await readExtract(path);
  console.log(`   way ${ways.length} · 노드 ${coords.size}`);
  const r = REGION;
  const junctions = computeJunctions(ways, coords).filter(
    ([lat, lng]) => lat >= r.latMin && lat <= r.latMax && lng >= r.lngMin && lng <= r.lngMax,
  );
  const stats = validateJunctions(junctions);
  const seed = {
    meta: {
      source: "OpenStreetMap contributors",
      license: "ODbL 1.0",
      licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
      attribution: "https://www.openstreetmap.org/copyright",
      extract: EXTRACT_URL,
      extractLastModified: lastModified,
      extractFileTime: fileTime,
      region: REGION,
      branch: { reachMeters: BRANCH_REACH_METERS, stubMeters: STUB_METERS, encoding: "kind*36+round(bearing/10)", kinds: KIND },
      fetchedAt: new Date().toISOString(),
      counts: { junctions: stats.total, ways: ways.length },
    },
    junctions,
  };
  const body = `${JSON.stringify(seed)}\n`;
  writeFileSync(OUT, body);
  console.log(`완료: 교차점 ${stats.total} · ${GOLDEN_GILDONG.name} 표본 ${stats.gildong} · ${(body.length / 1e6).toFixed(2)}MB → ${OUT}`);
}

const isMain = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (isMain) {
  main().catch((e) => {
    console.error("실패:", e.message);
    process.exit(1);
  });
}
