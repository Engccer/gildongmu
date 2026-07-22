// 서울시 음향신호기 seed 생성 (spec 2026-07-22-walk-infrastructure-design.md §2-A)
// 재생성 절차:
//   1) curl -sL -o /tmp/audio-signal.zip -A "Mozilla/5.0" -X POST \
//      "https://datafile.seoul.go.kr/bigfile/iot/inf/nio_download.do?&useCache=false" \
//      --data "infId=OA-15543&infSeq=3&seq=11"   (seq는 변동 가능, OA-15543 페이지에서 확인)
//   2) unzip -o /tmp/audio-signal.zip -d /tmp/audio-signal
//   3) node scripts/build-audio-signals.mjs "/tmp/audio-signal/<폴더>/<파일>.dbf"
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname } from "node:path";
import proj4 from "proj4";

const EPSG5186 = "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs";
const REQUIRED_FIELDS = ["MGRNU", "XCE", "YCE", "STAT_CDE"];
// pyproj(독립 도구)로 산출한 대조점: 5181·2097·축 교환 오변환은 수백 m 이상 어긋나 즉시 검출.
export const GOLDEN = [
  { x: 187968.299999927, y: 549055.306243806, lat: 37.5409278, lng: 126.8638597 },
  { x: 205994.858585621, y: 553916.705437931, lat: 37.5847878, lng: 127.0678724 },
  { x: 190423.974999942, y: 553317.881244307, lat: 37.5793622, lng: 126.8915903 },
  { x: 209521.207296075, y: 546845.954115851, lat: 37.5210509, lng: 127.1077052 },
  { x: 204606.600000029, y: 552616.993744226, lat: 37.5730855, lng: 127.0521467 },
];

export function parseDbf(buf) {
  const nrec = buf.readUInt32LE(4);
  const hdrlen = buf.readUInt16LE(8);
  const reclen = buf.readUInt16LE(10);
  const fields = [];
  for (let off = 32; buf[off] !== 0x0d; off += 32) {
    const name = buf.subarray(off, off + 11).toString("latin1").split("\0")[0];
    fields.push({ name, len: buf[off + 16] });
  }
  const decoder = new TextDecoder("euc-kr");
  const rows = [];
  for (let i = 0; i < nrec; i++) {
    const base = hdrlen + i * reclen;
    let off = base + 1;
    const row = {};
    for (const f of fields) {
      row[f.name] = decoder.decode(buf.subarray(off, off + f.len)).trim();
      off += f.len;
    }
    rows.push(row);
  }
  return { fields: fields.map((f) => f.name), rows };
}

export function buildSeed({ fields, rows }, { now, baseDate, dbfSha256 }) {
  for (const req of REQUIRED_FIELDS) {
    if (!fields.includes(req)) throw new Error(`필수 필드 누락: ${req}`);
  }
  if (rows.length < 20000) throw new Error(`총행수 이상: ${rows.length}`);
  const toWgs = proj4(EPSG5186, "WGS84");
  for (const g of GOLDEN) {
    const [lng, lat] = toWgs.forward([g.x, g.y]);
    const errM = Math.hypot((lat - g.lat) * 111320, (lng - g.lng) * 88000);
    if (errM > 1) throw new Error(`golden 좌표 오차 ${errM.toFixed(1)}m, 좌표계 정의 회귀 의심`);
  }
  let noCoord = 0,
    statExcluded = 0;
  const signals = [];
  for (const row of rows) {
    const x = Number(row.XCE),
      y = Number(row.YCE);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      noCoord++;
      continue;
    }
    if (row.STAT_CDE !== "1") {
      statExcluded++;
      continue;
    }
    const [lng, lat] = toWgs.forward([x, y]);
    if (lat < 37.4 || lat > 37.72 || lng < 126.73 || lng > 127.2) {
      throw new Error(`서울 bbox 이탈: ${lat},${lng}, 좌표계 회귀 의심`);
    }
    signals.push([Number(lat.toFixed(5)), Number(lng.toFixed(5))]);
  }
  const coordValidRatio = (rows.length - noCoord) / rows.length;
  if (coordValidRatio < 0.7) {
    throw new Error(`좌표 유효율 이상: ${(coordValidRatio * 100).toFixed(1)}%`);
  }
  if (signals.length < 15000) throw new Error(`유효 건수 부족: ${signals.length}`);
  const cLat = signals.reduce((s, p) => s + p[0], 0) / signals.length;
  const cLng = signals.reduce((s, p) => s + p[1], 0) / signals.length;
  if (cLat < 37.5 || cLat > 37.6 || cLng < 126.9 || cLng > 127.1) {
    throw new Error(`centroid 이탈: ${cLat},${cLng}`);
  }
  signals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return {
    meta: {
      source: "seoul-open-data OA-15543",
      baseDate,
      fetchedAt: now,
      dbfSha256,
      counts: { total: rows.length, noCoord, statExcluded, kept: signals.length },
    },
    signals,
  };
}

const isMain = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (isMain) {
  const dbfPath = process.argv[2];
  if (!dbfPath) {
    console.error("사용법: node scripts/build-audio-signals.mjs <dbf 경로>");
    process.exit(1);
  }
  const buf = readFileSync(dbfPath);
  // baseDate는 폴더명(20260528_…)에서 파싱, 수기 입력 금지(spec §2-A)
  const m = basename(dirname(dbfPath)).match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) throw new Error("폴더명에서 기준일을 파싱할 수 없음");
  const seed = buildSeed(parseDbf(buf), {
    now: new Date().toISOString(),
    baseDate: `${m[1]}-${m[2]}-${m[3]}`,
    dbfSha256: createHash("sha256").update(buf).digest("hex"),
  });
  writeFileSync("src/lib/data/audio-signals.json", JSON.stringify(seed));
  console.log("생성 완료:", seed.meta.counts);
}
