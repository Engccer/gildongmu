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

/** 기준 좌표로부터의 거리(m). 이름 매칭 오탐을 좌표로 가르기 위해 필요하다. */
function metersFrom(lat, lng) {
  const R = 6371000, rad = (d) => (d * Math.PI) / 180;
  const a = rad(Number(lat) - LAT), b = rad(Number(lng) - LNG);
  const h = Math.sin(a / 2) ** 2 + Math.cos(rad(LAT)) * Math.cos(rad(Number(lat))) * Math.sin(b / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const km = (m) => (Number.isFinite(m) ? `${(m / 1000).toFixed(1)}km` : "거리불명");

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
    // ⚠ 이름만으로 판정하지 않는다. 2026-07-26 실측에서 "연세도우리소아청소년과의원"이
    // 강남 개포동(6.9km)과 강동구(1.6km) 두 곳으로 존재해, 이름 매칭이 명부에 있는
    // 강남 기관을 제보 대상으로 착각했다 — 그대로 믿었으면 원인을 (B) 절단으로 잘못
    // 종결할 뻔했다. 매칭 결과는 반드시 주소·거리와 함께 출력하고, 복수 후보면
    // 판정을 사람에게 넘긴다(동명이원은 코드가 못 가른다).
    const hit = baby
      .map((c) => ({ ...c, d: metersFrom(c.wgs84Lat, c.wgs84Lon) }))
      .filter((c) => String(c.dutyName ?? "").includes(TARGET_NAME))
      .sort((a, b) => a.d - b.d);
    if (!hit.length) {
      console.log(`  🔎 "${TARGET_NAME}" 명부에 **없음** → 데이터셋 범위 문제 (A) 확정, 소스 확장(설계 §3)`);
    } else {
      console.log(`  🔎 "${TARGET_NAME}" 이름 매칭 ${hit.length}건 — 주소·거리로 동일 기관인지 직접 확인할 것:`);
      hit.forEach((c) => console.log(`     · ${km(c.d)} ${c.dutyName} | ${c.dutyAddr}`));
      if (hit.length > 1) console.log(`     ⚠ 동명이원 — 어느 쪽이 제보 대상인지 이름으로는 못 가린다.`);
    }
  }
  if (baby) {
    const noCoord = baby.filter((c) => !Number.isFinite(Number(c.wgs84Lat)));
    console.log(`  좌표 누락 행: ${noCoord.length}건`);
  }

  // ② 단계 1 후보 — 같은 서비스의 병의원 오퍼레이션.
  //    duty* 스키마를 공유하면 좌표+진료시간을 한 번에 얻어 파서를 재사용할 수 있다.
  //    ⚠ 오퍼레이션마다 활용신청이 독립이라 미신청이면 비정상 응답이 정상이다.
  await probe(
    "② NMC getHsptlMdcncLcinfoInqire (병의원 위치기반)",
    `${NMC}/getHsptlMdcncLcinfoInqire?serviceKey=${KEY}&WGS84_LON=${LNG}&WGS84_LAT=${LAT}&pageNo=1&numOfRows=10&_type=json`,
    "❌ 단계 1 후보 탈락(2026-07-26 실측): 좌표·distance는 주지만 요일별 dutyTime이 없고" +
      " (startTime/endTime 단일 쌍뿐), QD·QT·QN 어떤 필터를 붙여도 totalCount=239 고정으로 무시된다.",
  );
  await probe(
    "③ NMC getHsptlMdcncListInfoInqire (병의원 목록 — 소아청소년과 QD=D002)",
    `${NMC}/getHsptlMdcncListInfoInqire?serviceKey=${KEY}&Q0=${encodeURIComponent("서울특별시")}&Q1=${encodeURIComponent("강동구")}&QD=D002&pageNo=1&numOfRows=10&_type=json`,
    "★ 단계 1 정본: 좌표(wgs84Lat/Lon)+dutyTime 8칸을 함께 준다 → 기존 파서 재사용." +
      " QD=D002가 소아청소년과(강남구 코드 전수 스캔으로 역판정 — D009는 신경외과류로 소아 0건).",
  );

  // ③ 단계 2 후보 — 심평원. 목록에 진료시간이 없으면 상세 조인이 필요하다.
  await probe(
    "④ HIRA 병원정보서비스 getHospBasisList (단계 2 — 전국 병의원)",
    `${HIRA}/hospInfoServicev2/getHospBasisList?serviceKey=${KEY}&xPos=${LNG}&yPos=${LAT}&radius=3000&pageNo=1&numOfRows=5&_type=json`,
    "좌표·반경 파라미터 지원 여부 + 진료시간 필드 유무(없으면 상세 조인 필요)",
  );

  // ⑤ 커버리지 갭 — 단계 1의 값어치를 수치로 만든다.
  //    "달빛 명부에 없지만 오늘 요일에 문 여는 소아청소년과"가 몇 곳인가.
  //    ③이 시도+시군구 기반이라 반경을 덮으려면 인접 구를 훑어야 한다(--gu로 지정).
  const guArg = process.argv.indexOf("--gu");
  const GU = guArg >= 0 ? process.argv[guArg + 1].split(",") : ["강동구", "송파구", "광진구", "성동구"];
  const sidoArg = process.argv.indexOf("--sido"); // argOf는 Number 강제라 문자열엔 못 쓴다
  const SIDO = sidoArg >= 0 ? process.argv[sidoArg + 1] : "서울특별시";
  console.log(`\n── ⑤ 커버리지 갭 (${SIDO} ${GU.join("·")}, QD=D002)`);
  const kstDay = new Date(Date.now() + 9 * 3600 * 1000).getUTCDay(); // 0=일
  const idx = kstDay === 0 ? 7 : kstDay; // dutyTime 배열: 1=월..7=일
  const pool = [];
  for (const gu of GU) {
    const { json } = await getJson(
      `${NMC}/getHsptlMdcncListInfoInqire?serviceKey=${KEY}&Q0=${encodeURIComponent(SIDO)}&Q1=${encodeURIComponent(gu)}&QD=D002&pageNo=1&numOfRows=300&_type=json`,
    );
    items(json).forEach((c) => pool.push(c));
  }
  const babyHpid = new Set((baby ?? []).map((c) => c.hpid));
  const openToday = pool
    .map((c) => ({ ...c, d: metersFrom(c.wgs84Lat, c.wgs84Lon) }))
    .filter((c) => c.d <= 20000 && c[`dutyTime${idx}s`])
    .sort((a, b) => a.d - b.d);
  const missing = openToday.filter((c) => !babyHpid.has(c.hpid));
  console.log(`  소아청소년과 ${pool.length}곳 중 20km 내 오늘(요일 ${idx}) 진료 신고: ${openToday.length}곳`);
  console.log(`  그중 달빛 명부 중복 ${openToday.length - missing.length}곳 ⇒ **명부 누락 ${missing.length}곳**`);
  missing.slice(0, 10).forEach((c) =>
    console.log(`     · ${km(c.d)} ${c.dutyName} | ${c[`dutyTime${idx}s`]}~${c[`dutyTime${idx}c`]}`));
  console.log(
    "  ⚠ QD=D002는 '소아청소년과 전문'이 아니라 '진료과목 보유'다 — 이비인후과·내과가 섞인다(정밀도 대가, 설계 §6-1).",
  );

  console.log(
    "\n판정(2026-07-26 실측 완료): ③ getHsptlMdcncListInfoInqire + QD=D002로 단계 1 진행.",
  );
  console.log(
    "②는 진료과목 필터 무시·요일별 진료시간 부재로 탈락, ④ HIRA는 403(활용신청 전)이라 단계 2는 불필요.",
  );
  console.log(
    "남은 설계 과제: ③이 시군구 기반이라 반경 검색이 아니다 → 좌표를 coordToAddress로 역지오코딩해 인접 구를 병렬 조회.",
  );
}

await main();
