/** CLI 종료 코드 — 스펙 §6. 인증 코드는 없다(공개 API). */
export enum ExitCode {
  Ok = 0,
  Error = 1,   // 일반·upstream 오류(4xx/5xx)
  Usage = 2,   // 잘못된 인자
  Network = 7, // 연결 실패
}

export function exitCodeForStatus(status: number): ExitCode {
  if (status === 0) return ExitCode.Network;
  if (status >= 400 && status < 500) return status === 400 ? ExitCode.Usage : ExitCode.Error;
  return ExitCode.Error;
}
