// 카카오 분류 세그먼트 코퍼스 수집(A28) — 사전 `src/lib/data/kakao-category-en.json`의 번역 작업 목록을 만든다.
// spec docs/superpowers/specs/2026-08-31-kakao-category-en-design.md §8.
//
// 카카오 로컬 API를 **직접** 부른다(`.env.local`의 KAKAO_REST_API_KEY, 무료 쿼터 일 100,000 — dodo 앱 공유).
// 전국 대표 좌표 × 카테고리 검색 18코드(반경 20km, 3페이지) + 키워드 검색(일반 명사, 1페이지).
// 호출 수를 세고 `--max-calls`에서 멈춘다. 번역은 이 스크립트가 하지 않는다 — 사람이 사전에 쓴다.
//
// 출력: stdout에 통계 + **사전 미등재 세그먼트를 빈도순으로**(예시 경로 1건). 코퍼스(경로·빈도·예시 장소명)는
// `--out` 파일에만 쓴다 — 장소 데이터를 포함하므로 저장소에 넣지 않는다(spec §3 약관 판정).
//
// 사용법: node scripts/build-kakao-category-en.mjs [--max-calls 4000] [--out /tmp/kakao-category-corpus.json]
//         [--dict src/lib/data/kakao-category-en.json] [--concurrency 4]
//         --from-corpus <file>  이미 모은 코퍼스로 커버리지·미등재만 다시 계산한다(호출 0 — 사전 보강 루프용).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const MAX_CALLS = Number(arg("--max-calls", "4000"));
const OUT = arg("--out", join(tmpdir(), "kakao-category-corpus.json"));
const DICT_PATH = arg("--dict", "src/lib/data/kakao-category-en.json");
const CONCURRENCY = Number(arg("--concurrency", "4"));
const FROM_CORPUS = arg("--from-corpus", null);

function readKey() {
  if (process.env.KAKAO_REST_API_KEY) return process.env.KAKAO_REST_API_KEY;
  if (existsSync(".env.local")) {
    const m = readFileSync(".env.local", "utf8").match(/^KAKAO_REST_API_KEY=(.*)$/m);
    if (m) return m[1].trim().replace(/^"|"$/g, "");
  }
  throw new Error("KAKAO_REST_API_KEY가 없다(.env.local 또는 환경변수)");
}
const KEY = FROM_CORPUS ? null : readKey();

/** 사전(없으면 빈 객체) — 미등재 판정용. */
const dict = existsSync(DICT_PATH) ? JSON.parse(readFileSync(DICT_PATH, "utf8")) : {};

// 전국 대표 좌표 — 도심·교외·관광지를 섞는다(시도 17 + 서울·경기 보강).
const COORDS = [
  ["서울 강남역", 37.4979, 127.0276],
  ["서울 강동구청", 37.5301, 127.1238],
  ["서울 홍대입구", 37.5573, 126.9245],
  ["서울 종로", 37.5704, 126.9922],
  ["서울 노원", 37.6542, 127.0568],
  ["경기 수원역", 37.2659, 126.9997],
  ["경기 일산", 37.6584, 126.7719],
  ["경기 양평", 37.4913, 127.4876],
  ["인천 부평", 37.4893, 126.7245],
  ["강원 춘천", 37.8813, 127.7298],
  ["강원 강릉", 37.7519, 128.8761],
  ["충북 청주", 36.6424, 127.489],
  ["충남 천안", 36.8151, 127.1139],
  ["대전 둔산", 36.3504, 127.3845],
  ["세종", 36.48, 127.289],
  ["전북 전주", 35.8242, 127.148],
  ["전남 여수", 34.7604, 127.6622],
  ["광주 상무", 35.1531, 126.8514],
  ["경북 안동", 36.5684, 128.7294],
  ["경북 경주", 35.8562, 129.2247],
  ["대구 동성로", 35.8694, 128.5949],
  ["울산 삼산", 35.5392, 129.3114],
  ["경남 창원", 35.2281, 128.6811],
  ["부산 서면", 35.1578, 129.0593],
  ["부산 해운대", 35.1587, 129.1604],
  ["제주 시내", 33.4996, 126.5312],
  ["제주 서귀포", 33.2541, 126.56],
];

const GROUP_CODES = [
  "MT1", "CS2", "PS3", "SC4", "AC5", "PK6", "OL7", "SW8", "BK9", "CT1",
  "AG2", "PO3", "AT4", "AD5", "FD6", "CE7", "HP8", "PM9",
];

// 일반 명사 키워드 — 카테고리 검색 18코드가 못 닿는 가지(종교·생활·스포츠·서비스·교통)를 넓힌다.
const KEYWORDS = [
  "학교", "병원", "의원", "치과", "한의원", "동물병원", "약국", "보건소", "요양원", "산부인과",
  "교회", "성당", "절", "사찰", "공원", "시장", "전통시장", "백화점", "쇼핑몰", "아울렛",
  "호텔", "모텔", "펜션", "게스트하우스", "캠핑장", "리조트", "미용실", "네일", "피부관리", "안경",
  "세탁소", "헬스장", "수영장", "요가", "필라테스", "골프", "볼링", "당구장", "탁구장", "스크린골프",
  "은행", "우체국", "경찰서", "소방서", "주민센터", "구청", "시청", "세무서", "법원", "도서관",
  "서점", "문구", "장난감", "가구", "전자제품", "휴대폰", "꽃집", "빵집", "정육점", "철물점",
  "카센터", "세차장", "주유소", "충전소", "주차장", "택시", "버스터미널", "기차역", "공항", "항구",
  "영화관", "박물관", "미술관", "공연장", "체육관", "축구장", "야구장", "스케이트장", "노래방", "PC방",
  "찜질방", "사우나", "목욕탕", "마사지", "학원", "유치원", "어린이집", "놀이터", "키즈카페", "마트",
  "편의점", "카페", "식당", "치킨", "피자", "분식", "국밥", "횟집", "고기집", "술집",
  "해수욕장", "등산로", "산", "호수", "온천", "농장", "낚시", "골프장", "장례식장", "아파트",
  "오피스텔", "부동산", "공장", "회사", "사무실", "공유오피스", "스튜디오", "사진관", "인쇄", "세탁",
  "반려동물", "애견", "안과", "정형외과", "피부과", "소아과", "응급실", "복지관", "경로당", "문화센터",
];

const paths = new Map(); // path -> { count, example }
let calls = 0;
let docs = 0;
let failed = 0;
let stopped = false;

async function kakao(endpoint, params) {
  if (calls >= MAX_CALLS) {
    stopped = true;
    return [];
  }
  calls++;
  const url = new URL(`https://dapi.kakao.com/v2/local/search/${endpoint}.json`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  // 네트워크 오류(HTTP/2 GOAWAY 등)는 한 번 재시도하고 그래도 실패하면 그 호출만 버린다 — 3,800회째
  // 한 번의 소켓 오류가 전체 결과를 날린 실측(2026-08-31)이 있어 예외를 밖으로 내지 않는다.
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(url, { headers: { Authorization: `KakaoAK ${KEY}` } });
      break;
    } catch (e) {
      if (attempt >= 1) {
        console.error(`fetch 실패(재시도 후 포기) ${endpoint} ${JSON.stringify(params)}: ${e?.cause?.code ?? e}`);
        failed++;
        return [];
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (res.status === 429) {
    stopped = true;
    console.error("429 — 쿼터 소진, 중단");
    return [];
  }
  if (!res.ok) {
    console.error(`HTTP ${res.status} ${endpoint} ${JSON.stringify(params)}`);
    return [];
  }
  const data = await res.json();
  return Array.isArray(data?.documents) ? data.documents : [];
}

function record(doc) {
  const path = (doc.category_name ?? "").trim();
  if (!path) return;
  docs++;
  const cur = paths.get(path);
  if (cur) cur.count++;
  else paths.set(path, { count: 1, example: doc.place_name });
}

const jobs = [];
for (const [, lat, lng] of COORDS) {
  for (const code of GROUP_CODES) {
    for (const page of [1, 2, 3]) {
      jobs.push(() =>
        kakao("category", { category_group_code: code, x: lng, y: lat, radius: 20000, size: 15, page }),
      );
    }
  }
  for (const q of KEYWORDS) {
    jobs.push(() => kakao("keyword", { query: q, x: lng, y: lat, size: 15 }));
  }
}

let idx = 0;
async function worker() {
  while (idx < jobs.length && !stopped) {
    const job = jobs[idx++];
    const result = await job();
    for (const d of result) record(d);
    if (calls % 200 === 0) console.error(`… ${calls}회 호출, 경로 ${paths.size}개`);
  }
}
if (FROM_CORPUS) {
  const saved = JSON.parse(readFileSync(FROM_CORPUS, "utf8"));
  for (const [path, v] of Object.entries(saved.paths)) paths.set(path, { count: v.count, example: v.example });
  calls = saved.calls;
  docs = saved.docs;
} else {
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

// 리뷰 #1(세그먼트 뜻의 문맥 의존) 관측: 같은 세그먼트가 서로 다른 부모 아래 등장하면 평탄 사전이
// 두 문맥에 같은 영문을 준다. 실측(2026-08-31, 경로 1,176개) 0건 — 재스윕에서 늘면 그 세그먼트를 사전에서 뺀다.
const parents = new Map();
for (const path of paths.keys()) {
  const segs = path.split(">").map((s) => s.trim());
  segs.forEach((seg, i) => {
    if (!parents.has(seg)) parents.set(seg, new Set());
    parents.get(seg).add(i === 0 ? "(root)" : segs[i - 1]);
  });
}
const multiParent = [...parents].filter(([, ps]) => ps.size > 1);

// 세그먼트 집계.
const segments = new Map(); // seg -> { count, example }
for (const [path, { count }] of paths) {
  for (const seg of path.split(">").map((s) => s.trim().normalize("NFC")).filter(Boolean)) {
    const cur = segments.get(seg);
    if (cur) cur.count += count;
    else segments.set(seg, { count, example: path });
  }
}
const missing = [...segments].filter(([seg]) => !(seg in dict)).sort((a, b) => b[1].count - a[1].count);
const coveredPaths = [...paths].filter(([p]) =>
  p.split(">").map((s) => s.trim().normalize("NFC")).filter(Boolean).every((s) => s in dict),
);
const coveredDocs = coveredPaths.reduce((n, [, v]) => n + v.count, 0);

if (!FROM_CORPUS) writeFileSync(
  OUT,
  JSON.stringify(
    {
      collectedAt: new Date().toISOString(),
      calls,
      docs,
      paths: Object.fromEntries([...paths].sort((a, b) => b[1].count - a[1].count)),
      segments: Object.fromEntries([...segments].sort((a, b) => b[1].count - a[1].count)),
    },
    null,
    1,
  ),
);

console.log(`호출 ${calls}회${stopped ? "(상한/쿼터로 중단)" : ""}(실패 ${failed}), 장소 ${docs}건, 고유 경로 ${paths.size}개, 고유 세그먼트 ${segments.size}개`);
console.log(`사전 등재 ${segments.size - missing.length}/${segments.size} 세그먼트 · 커버 경로 ${coveredPaths.length}/${paths.size} · 커버 장소 ${coveredDocs}/${docs} (${((coveredDocs / Math.max(docs, 1)) * 100).toFixed(1)}%)`);
console.log(FROM_CORPUS ? `코퍼스 ← ${FROM_CORPUS}` : `코퍼스 → ${OUT}`);
console.log(`부모가 둘 이상인 세그먼트 ${multiParent.length}개${multiParent.length ? ": " + multiParent.map(([s, ps]) => `${s}(${[...ps].join("|")})`).join(", ") : ""}`);
if (missing.length) {
  console.log(`\n미등재 세그먼트 ${missing.length}개(빈도순):`);
  for (const [seg, { count, example }] of missing) console.log(`${count}\t${seg}\t${example}`);
}
