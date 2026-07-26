// 소아 진료 커버리지 확장 — 후보 데이터 소스 실호출 검증 (spec
// 2026-07-26-clinic-coverage-expansion-design.md §5 게이트).
//
// 이 저장소는 "fixture green ≠ 실계약 검증"을 원칙으로 삼는다. 커버리지 확장은
// **어느 API가 좌표와 진료시간을 실제로 함께 주는가**에 전부 달려 있는데, 그건
// 문서가 아니라 응답 본문으로만 확정된다. 이 스크립트는 추정을 배제하고
// 후보 엔드포인트를 차례로 두드려 **필드 유무를 사실대로 출력**한다.
//
// 사용법:
//   DATA_GO_KR_API_KEY=... node scripts/verify-clinic-sources.mjs
//   DATA_GO_KR_API_KEY=... node scripts/verify-clinic-sources.mjs --name "연세도우리소아청소년과"
//
// 출력은 판정(PASS/FAIL)이 아니라 관측이다 — 어떤 오퍼레이션이 활용신청되어
// 있고, 무엇을 주는지 눈으로 확인한 뒤 설계 §3의 분기를 고른다.

const KEY = process.env.DATA_GO_KR_API_KEY;
if (!KEY) {
  console.error("DATA_GO_KR_API_KEY 환경변수가 필요합니다.");
  process.exit(1);
}

const nameArgIndex = process.argv.indexOf("--name");
const TARGET_NAME = nameArgIndex >= 0 ? process.argv[nameArgIndex + 1] : null;

// 기본 좌표: 서울 강동구청(회귀 제보 지점). --lat/--lng로 덮을 수 있다.
const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
const LAT = argOf("--lat", 37.5301);
const LNG = argOf("--lng", 127.1238);

const NMC = "https://apis.data.go.kr/B552657/HsptlAsembySearchService";
const HIRA = "https://apis.data.go.kr/B551182";

/** JSON 요청 — 비정상 응답도 삼키지 않고 그대로 돌려준다(원인 진단이 목적). */
async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) return { error: `HTTP ${res.status}`, body: text.slice(0, 300) };
  try {
    return { json: JSON.parse(text) };
  } catch {
    // data.go.kr은 미신청·키오류를 XML/HTML로 돌려주는 경우가 잦다.
    return { error: "JSON 아님(미신청·키오류 가능)", body: text.slice(0, 300) };
  }
}

function items(json) {
  const body = json?.response?.body;
  const raw = body?.items;
  if (!raw || typeof raw === "string") return [];
  const item = raw.item;
  if (item == null) return [];
  return Array.isArray(item) ? item : [item];
}

function resultCode(json) {
  const h = json?.response?.header;
  return String(h?.resultCode ?? h?.resultMsg ?? "?");
}

/** 한 건 샘플에서 우리가 필요로 하는 필드가 실제로 오는지 관측. */
function fieldReport(sample) {
  if (!sample) return "  (샘플 없음)";
  const has = (k) => (sample[k] != null && String(sample[k]).trim() !== "" ? "✓" : "✗");
  const hoursKeys = Array.from({ length: 8 }, (_, i) => `dutyTime${i + 1}s`);
  const hoursPresent = hoursKeys.filter((k) => has(k) === "✓").length;
  return [
    `  좌표 wgs84Lat/Lon: ${has("wgs84Lat")}/${has("wgs84Lon")}`,
    `  진료시간 dutyTime1s..8s: ${hoursPresent}/8칸`,
    `  이름/주소/전화: ${has("dutyName")}/${has("dutyAddr")}/${has("dutyTel1")}`,
    `  키 목록: ${Object.keys(sample).join(", ")}`,
  ].join("\n");
}

async function probe(label, url, note) {
  console.log(`\n── ${label}`);
  if (note) console.log(`   ${note}`);
  const { json, error, body } = await getJson(url);
  if (error) {
    console.log(`  ❌ ${error}`);
    if (body) console.log(`  ${body.replace(/\s+/g, " ").slice(0, 200)}`);
    return null;
  }
  const list = items(json);
  console.log(`  resultCode=${resultCode(json)} totalCount=${json?.response?.body?.totalCount ?? "?"} 수신=${list.length}`);
  console.log(fieldReport(list[0]));
  return list;
}

async function main() {
  console.log(`좌표 기준: ${LAT}, ${LNG}${TARGET_NAME ? ` / 대상 기관: ${TARGET_NAME}` : ""}`);

  // ① 현재 정본 — 달빛어린이병원 명부에 대상 기관이 있는가?
  //    있으면 원인은 표시 절단(수정 완료), 없으면 데이터셋 범위 문제로 확정된다.
  const baby = await probe(
    "① NMC getBabyListInfoInqire (현재 정본 — 달빛어린이병원·소아전문센터)",
    `${NMC}/getBabyListInfoInqire?serviceKey=${KEY}&pageNo=1&numOfRows=200&_type=json`,
  );
  if (baby && TARGET_NAME) {
    const hit = baby.filter((c) => String(c.dutyName ?? "").includes(TARGET_NAME));
    console.log(
      hit.length
        ? `  🔎 "${TARGET_NAME}" 명부에 있음: ${hit.map((c) => `${c.dutyName}(${c.dutyAddr})`).join(" / ")}`
        : `  🔎 "${TARGET_NAME}" 명부에 **없음** → 소스 확장 필요(설계 §3)`,
    );
  }
  if (baby) {
    const noCoord = baby.filter((c) => !Number.isFinite(Number(c.wgs84Lat)));
    console.log(`  좌표 누락 행: ${noCoord.length}건`);
  }

  // ② 단계 1 후보 — 같은 서비스의 병의원 오퍼레이션.
  //    duty* 스키마를 공유하면 좌표+진료시간을 한 번에 얻어 파서를 재사용할 수 있다.
  //    ⚠ 오퍼레이션마다 활용신청이 독립이라 미신청이면 비정상 응답이 정상이다.
  await probe(
    "② NMC getHsptlMdcncLcinfoInqire (병의원 위치기반 — 단계 1 1순위)",
    `${NMC}/getHsptlMdcncLcinfoInqire?serviceKey=${KEY}&WGS84_LON=${LNG}&WGS84_LAT=${LAT}&pageNo=1&numOfRows=10&_type=json`,
    "좌표 파라미터를 직접 받는지 + dutyTime 동반 여부가 관건",
  );
  await probe(
    "③ NMC getHsptlMdcncListInfoInqire (병의원 목록 — 소아청소년과 필터)",
    `${NMC}/getHsptlMdcncListInfoInqire?serviceKey=${KEY}&Q0=${encodeURIComponent("서울특별시")}&Q1=${encodeURIComponent("강동구")}&QD=${encodeURIComponent("D009")}&pageNo=1&numOfRows=10&_type=json`,
    "QD=진료과목 코드(D009=소아청소년과 추정 — 응답으로 확인할 것)",
  );

  // ③ 단계 2 후보 — 심평원. 목록에 진료시간이 없으면 상세 조인이 필요하다.
  await probe(
    "④ HIRA 병원정보서비스 getHospBasisList (단계 2 — 전국 병의원)",
    `${HIRA}/hospInfoServicev2/getHospBasisList?serviceKey=${KEY}&xPos=${LNG}&yPos=${LAT}&radius=3000&pageNo=1&numOfRows=5&_type=json`,
    "좌표·반경 파라미터 지원 여부 + 진료시간 필드 유무(없으면 상세 조인 필요)",
  );

  console.log(
    "\n판단 기준: ②·③ 중 하나가 정상 응답 + dutyTime 8칸을 주면 단계 1로 진행(파서 재사용).",
  );
  console.log(
    "둘 다 미신청/무진료시간이면 ④ + 기관별 상세(ykiho 조인)로 단계 2 — 비용이 크므로 설계 §4를 먼저 읽을 것.",
  );
}

await main();
