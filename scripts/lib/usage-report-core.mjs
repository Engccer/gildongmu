// 과금·쿼터 리포트의 순수 판정 계층. I/O 없음(테스트 검출력 유지)

/** 프로브 결과 5-state. 서로 절대 뭉개지 않는다 */
export const STATUS = {
  OK: "정상",
  QUOTA: "쿼터 초과",
  AUTH: "인증 실패",
  ERROR: "조회 실패",
  MISSING: "키 미설정",
};

/** .env.local 형식을 읽는다. dotenv 의존성을 피하려는 최소 구현 */
export function parseEnvFile(text) {
  const out = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * HTTP 상태만으로 내리는 기본 판정.
 * 벤더별 예외(200인데 body가 오류인 경우 등)는 프로브의 judge가 덮어쓴다.
 * 미분류는 fail-closed로 ERROR에 떨어뜨린다.
 */
export function defaultJudge({ httpStatus }) {
  if (httpStatus === 401 || httpStatus === 403) return STATUS.AUTH;
  if (httpStatus === 429) return STATUS.QUOTA;
  if (httpStatus >= 200 && httpStatus < 300) return STATUS.OK;
  return STATUS.ERROR;
}

// 8자 미만은 일반 단어와 충돌해 멀쩡한 출력을 가린다(오탐 방지)
const MIN_SECRET_LENGTH = 8;

/** 출력 직전 모든 문자열이 통과한다. 벤더가 요청 URL을 되돌려주면 키가 실린다 */
export function maskSecrets(text, secrets) {
  let out = String(text ?? "");
  for (const secret of secrets ?? []) {
    if (typeof secret !== "string") continue;
    if (secret.length < MIN_SECRET_LENGTH) continue;
    out = out.split(secret).join("***");
  }
  return out;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const KOREAN_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 두 날짜의 일수 차. 코드가 계산하므로 결정론적이다(모델 추론 금지 규칙의 취지) */
export function daysUntil(targetISO, todayISO) {
  const target = Date.parse(`${targetISO}T00:00:00Z`);
  const today = Date.parse(`${todayISO}T00:00:00Z`);
  return Math.round((target - today) / DAY_MS);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** 리포트 헤더용. 요일은 Date에서 뽑으므로 병기 검증이 자동 성립한다 */
export function formatKoreanDateTime(date) {
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const w = KOREAN_WEEKDAYS[date.getDay()];
  return `${y}-${m}-${d} (${w}) ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** 한 줄 = 한 사실. 항목명·상태·수치를 별도 열로 흩지 않는다(스크린 리더 요구) */
export function renderProbeLine({ label, status, detail, note }) {
  const parts = [`${label} ${status}`];
  if (detail) parts.push(detail);
  if (note) parts.push(note);
  return parts.join(", ");
}

function renderSection(title, lines) {
  const body = lines.length > 0 ? lines : ["해당 없음"];
  return [`[${title}]`, ...body].join("\n");
}

export function renderReport({ now, money, availability, deadlines, safe }) {
  const header = `길동무 과금·쿼터 리포트  ${formatKoreanDateTime(now)}`;
  const sections = [
    renderSection("돈", money.map(renderProbeLine)),
    renderSection("가용성", availability.map(renderProbeLine)),
    renderSection(
      "시한",
      deadlines.map((d) => `${d.label}까지 ${d.days}일 (${d.date})`),
    ),
    renderSection("걱정 불필요", safe),
  ];
  return [header, "", ...sections.flatMap((s) => [s, ""])].join("\n").trimEnd();
}
