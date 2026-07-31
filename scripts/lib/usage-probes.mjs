// 프로브 카탈로그. 유료 API는 무과금 경로만 쓴다(스펙 §3.3 실호출 확정)
import { STATUS, defaultJudge, maskSecrets } from "./usage-report-core.mjs";

const DEEPGRAM_PROJECT_ID = "9fe1af22-f34f-490f-9ecd-d6855e52c7d6";

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
