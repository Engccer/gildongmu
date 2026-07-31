// 프로브 카탈로그. 유료 API는 무과금 경로만 쓴다(스펙 §3.3 실호출 확정)
import { STATUS, defaultJudge, maskSecrets } from "./usage-report-core.mjs";

const DEEPGRAM_PROJECT_ID = "9fe1af22-f34f-490f-9ecd-d6855e52c7d6";

// 프로브용 고정 좌표(강동역 부근)와 질의어. 데이터가 아니라 응답 여부만 본다
const PROBE = {
  lat: 37.535,
  lng: 127.1234,
  destLat: 37.54,
  destLng: 127.13,
  keyword: "강동역",
  road: "성내로",
};

/**
 * HTTP 200에 오류를 담는 envelope 전용 판정기.
 * 이걸 붙이지 않으면 키가 만료돼도 200이라 "정상"으로 보고된다(실측 4종).
 */
function envelopeJudge(pick, { ok, auth = [], quota = [] }) {
  const classify = (value) => {
    if (auth.includes(value)) return STATUS.AUTH;
    if (quota.includes(value)) return STATUS.QUOTA;
    return ok.includes(value) ? STATUS.OK : STATUS.ERROR;
  };
  return ({ httpStatus, bodyText }) => {
    if (httpStatus < 200 || httpStatus >= 300) {
      return defaultJudge({ httpStatus });
    }
    try {
      return classify(pick(JSON.parse(bodyText)));
    } catch {
      // 일부 벤더는 오류일 때만 XML로 답한다(따릉이 실측). 코드 문자열로 폴백
      const found = [...auth, ...quota].find((code) => bodyText.includes(code));
      return found ? classify(found) : STATUS.ERROR;
    }
  };
}

export const MONEY_PROBES = [
  {
    id: "gemini",
    label: "Gemini",
    envKeys: ["GEMINI_API_KEY"],
    build: (env) => ({
      url: `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${env.GEMINI_API_KEY}`,
    }),
    note: "사용량 수치는 조회 API가 없어 정보 없음. 콘솔 aistudio.google.com",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    envKeys: ["PERPLEXITY_API_KEY"],
    // 무효 모델을 넣어 400을 유도한다. 모델 검증이 과금보다 앞이라 비용 0
    build: (env) => ({
      url: "https://api.perplexity.ai/chat/completions",
      init: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.PERPLEXITY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: "__invalid__", messages: [] }),
      },
    }),
    judge: ({ httpStatus, bodyText }) => {
      if (httpStatus === 400 && bodyText.includes("invalid_model")) {
        return STATUS.OK;
      }
      return defaultJudge({ httpStatus });
    },
    note: "잔액은 조회 API가 없어 정보 없음. 콘솔 console.perplexity.ai",
  },
  {
    id: "deepgram-usage",
    label: "Deepgram",
    envKeys: ["DEEPGRAM_MANAGE_KEY"],
    build: (env) => ({
      url: `https://api.deepgram.com/v1/projects/${DEEPGRAM_PROJECT_ID}/balances`,
      init: { headers: { Authorization: `Token ${env.DEEPGRAM_MANAGE_KEY}` } },
    }),
    describe: ({ bodyText }) => {
      try {
        const balances = JSON.parse(bodyText).balances ?? [];
        const total = balances.reduce((sum, b) => sum + (b.amount ?? 0), 0);
        return `잔액 ${total.toFixed(2)}달러`;
      } catch {
        return undefined;
      }
    },
    missingHint:
      "DEEPGRAM_MANAGE_KEY를 .env.local에 넣으면 잔액이 표시된다. 콘솔 console.deepgram.com",
  },
];

export const AVAILABILITY_PROBES = [
  {
    id: "kakao-local",
    label: "카카오 장소검색",
    envKeys: ["KAKAO_REST_API_KEY"],
    build: (env) => ({
      url: `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(PROBE.keyword)}&size=1`,
      init: { headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}` } },
    }),
  },
  {
    id: "kakao-walk",
    label: "카카오 도보경로",
    envKeys: ["KAKAO_REST_API_KEY"],
    build: (env) => ({
      url: `https://dapi.kakao.com/v2/routing/walk?start_x=${PROBE.lng}&start_y=${PROBE.lat}&end_x=${PROBE.destLng}&end_y=${PROBE.destLat}`,
      init: { headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}` } },
    }),
  },
  {
    id: "tmap",
    label: "Tmap 보행자",
    envKeys: ["TMAP_APP_KEY"],
    build: (env) => ({
      url: "https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1",
      init: {
        method: "POST",
        headers: {
          appKey: env.TMAP_APP_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startX: String(PROBE.lng),
          startY: String(PROBE.lat),
          endX: String(PROBE.destLng),
          endY: String(PROBE.destLat),
          startName: "a",
          endName: "b",
        }),
      },
    }),
    note: "자동차 경로도 같은 키를 쓴다",
  },
  {
    id: "odsay",
    label: "ODsay 대중교통",
    envKeys: ["ODSAY_API_KEY"],
    // 키가 URI에 묶여 있어 Referer가 없으면 인증이 실패한다
    build: (env) => ({
      url: `https://api.odsay.com/v1/api/searchPubTransPathT?SX=${PROBE.lng}&SY=${PROBE.lat}&EX=127.0276&EY=37.4979&apiKey=${env.ODSAY_API_KEY}`,
      init: { headers: { Referer: "https://gildongmu.vercel.app/" } },
    }),
    // 오류는 배열(`error: [{...}]`)로 오고 무효 키 메시지가 ApiKeyAuthFailed다(실측)
    judge: ({ httpStatus, bodyText }) => {
      if (httpStatus < 200 || httpStatus >= 300) {
        return defaultJudge({ httpStatus });
      }
      if (bodyText.includes("ApiKeyAuthFailed")) return STATUS.AUTH;
      return bodyText.includes('"result"') ? STATUS.OK : STATUS.ERROR;
    },
  },
  {
    id: "seoul-subway",
    label: "서울 지하철 실시간",
    envKeys: ["SEOUL_SUBWAY_REALTIME_KEY"],
    build: (env) => ({
      url: `http://swopenapi.seoul.go.kr/api/subway/${env.SEOUL_SUBWAY_REALTIME_KEY}/json/realtimeStationArrival/0/5/${encodeURIComponent("강동")}`,
    }),
    // INFO-100은 인증키 무효(실측). ERROR-337은 일일 트래픽 초과(공식 문서, 미관측)
    judge: envelopeJudge((j) => j.errorMessage?.code ?? j.code, {
      ok: ["INFO-000"],
      auth: ["INFO-100"],
      quota: ["ERROR-337"],
    }),
  },
  {
    id: "seoul-bike",
    label: "서울 따릉이",
    envKeys: ["SEOUL_OPEN_DATA_KEY"],
    build: (env) => ({
      url: `http://openapi.seoul.go.kr:8088/${env.SEOUL_OPEN_DATA_KEY}/json/bikeList/1/5/`,
    }),
    // 정상은 JSON인데 오류는 XML로 온다(실측). envelopeJudge의 문자열 폴백이 받는다
    judge: envelopeJudge(
      (j) => j.rentBikeStatus?.RESULT?.CODE ?? j.RESULT?.CODE,
      { ok: ["INFO-000"], auth: ["INFO-100"], quota: ["ERROR-337"] },
    ),
  },
  {
    id: "data-go-kr",
    label: "공공데이터포털",
    envKeys: ["DATA_GO_KR_API_KEY"],
    build: (env) => ({
      url: `http://apis.data.go.kr/1613000/BusSttnInfoInqireService/getCrdntPrxmtSttnList?serviceKey=${encodeURIComponent(env.DATA_GO_KR_API_KEY)}&_type=json&gpsLati=${PROBE.lat}&gpsLong=${PROBE.lng}&numOfRows=1&pageNo=1`,
    }),
    judge: envelopeJudge((j) => j.response?.header?.resultCode, {
      ok: ["00"],
      quota: ["22"],
    }),
    note: "코레일·TAGO·공기질·날씨·무장애가 같은 키를 공유한다",
  },
  {
    id: "juso",
    label: "juso 주소검색",
    envKeys: ["JUSO_CONFM_KEY"],
    build: (env) => ({
      url: `https://business.juso.go.kr/addrlink/addrLinkApi.do?confmKey=${env.JUSO_CONFM_KEY}&currentPage=1&countPerPage=1&resultType=json&keyword=${encodeURIComponent(PROBE.road)}`,
    }),
    // E0001은 승인되지 않은 KEY(실측)
    judge: envelopeJudge((j) => j.results?.common?.errorCode, {
      ok: ["0"],
      auth: ["E0001"],
    }),
  },
  {
    id: "naver-local",
    label: "네이버 지역검색",
    envKeys: ["NAVER_LOCAL_CLIENT_ID", "NAVER_LOCAL_CLIENT_SECRET"],
    build: (env) => ({
      url: `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(PROBE.keyword)}&display=1`,
      init: {
        headers: {
          "X-Naver-Client-Id": env.NAVER_LOCAL_CLIENT_ID,
          "X-Naver-Client-Secret": env.NAVER_LOCAL_CLIENT_SECRET,
        },
      },
    }),
  },
  {
    id: "ncp-geocode",
    label: "NCP 지오코딩",
    envKeys: ["NCP_MAPS_CLIENT_ID", "NCP_MAPS_CLIENT_SECRET"],
    build: (env) => ({
      url: `https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=${encodeURIComponent("서울특별시")}`,
      init: {
        headers: {
          "x-ncp-apigw-api-key-id": env.NCP_MAPS_CLIENT_ID,
          "x-ncp-apigw-api-key": env.NCP_MAPS_CLIENT_SECRET,
        },
      },
    }),
    judge: envelopeJudge((j) => j.status, { ok: ["OK"] }),
    note: "영문 주소 보강과 en 자동차 경로에 쓴다",
  },
  {
    id: "deepgram-stt",
    label: "Deepgram STT 키",
    envKeys: ["DEEPGRAM_API_KEY"],
    build: (env) => ({
      url: "https://api.deepgram.com/v1/projects",
      init: { headers: { Authorization: `Token ${env.DEEPGRAM_API_KEY}` } },
    }),
    note: "웹 받아쓰기용. iOS는 온디바이스라 무관",
  },
  {
    id: "gcp-tts",
    label: "Google Cloud TTS",
    envKeys: ["GOOGLE_CLOUD_TTS_API_KEY"],
    build: (env) => ({
      url: `https://texttospeech.googleapis.com/v1/voices?languageCode=ko-KR&key=${env.GOOGLE_CLOUD_TTS_API_KEY}`,
    }),
    note: "웹 PWA 폴백 전용. iOS는 온디바이스가 정본",
  },
  {
    id: "vercel",
    label: "Vercel 팀",
    envKeys: ["VERCEL_TOKEN"],
    build: (env) => ({
      url: "https://api.vercel.com/v2/teams",
      init: { headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` } },
    }),
    note: "Hobby라 과금 축 없음",
  },
];

export const DEADLINES = [
  { label: "ODsay 키 만료", date: "2027-01-04" },
  { label: "네이버 API Hub 이관", date: "2027-06-30" },
  { label: "Apple 배포 인증서 만료", date: "2027-07-18" },
];

export const SAFE_NOTES = [
  "카카오는 유료 전환 미신청이라 쿼터 초과가 과금이 아니라 오류이고 Tmap으로 폴백한다",
  "Vercel은 Hobby라 한도 초과 시 과금 대신 프로젝트 일시정지이며 스펜드 알림은 Pro 전용이라 설정 대상이 아니다",
  "juso와 서울 열린데이터와 공공데이터포털은 무료이고 쿼터 상태는 가용성 섹션이 담당한다",
];

const TIMEOUT_MS = 10_000;

/** 프로브 1건 실행. 어떤 실패도 예외로 새어 나가지 않는다(리포트 전체 보호) */
export async function runProbe(probe, env, fetchImpl = fetch) {
  const secrets = probe.envKeys.map((k) => env[k]).filter(Boolean);
  const missing = probe.envKeys.filter((k) => !env[k]);
  if (missing.length > 0) {
    // note는 키가 있을 때를 전제한 문장이라 여기서 섞으면 자기모순이 된다
    return {
      label: probe.label,
      status: STATUS.MISSING,
      detail: probe.missingHint ?? `${missing.join(", ")} 필요`,
    };
  }

  const { url, init } = probe.build(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    const bodyText = await res.text();
    const judge = probe.judge ?? defaultJudge;
    const status = judge({ httpStatus: res.status, bodyText });
    const detail =
      status === STATUS.OK
        ? probe.describe?.({ bodyText })
        : maskSecrets(`HTTP ${res.status} ${bodyText.slice(0, 200)}`, secrets);
    return { label: probe.label, status, detail, note: probe.note };
  } catch (error) {
    return {
      label: probe.label,
      status: STATUS.ERROR,
      detail: maskSecrets(String(error?.message ?? error), secrets),
      note: probe.note,
    };
  } finally {
    clearTimeout(timer);
  }
}
