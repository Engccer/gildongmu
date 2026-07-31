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
