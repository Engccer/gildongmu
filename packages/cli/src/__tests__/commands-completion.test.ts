import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * completion 명령 테스트 — 3셸 출력에 명령 트리 문자열이 포함되는지 스냅샷 수준 검증.
 * fish는 gil·gildongmu 두 명령 모두 등록되는지(리뷰 fix: 별칭 누락 회귀 방지) 단언한다.
 */

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`EXIT_${code}`);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function runCompletion(shell: string): Promise<string> {
  const { completionCommand } = await import("../commands/completion.js");
  await completionCommand.run!({ args: { shell }, rawArgs: [], cmd: completionCommand } as never);
  return stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
}

const TOP_LEVEL_13 = [
  "search", "web", "nearby", "station", "bus", "route", "place",
  "weather", "air", "whereami", "chat", "config", "completion",
];
const NEARBY_7 = ["subway", "bike", "clinic", "kids", "around", "barrier-free"]; // bus는 최상위와 중복이라 별도 확인 불필요

describe("completion 명령", () => {
  it.each(["bash", "zsh", "fish"] as const)("%s 출력에 최상위 13개와 nearby 7 verb가 포함된다", async (shell) => {
    const out = await runCompletion(shell);
    for (const cmd of TOP_LEVEL_13) expect(out).toContain(cmd);
    for (const verb of NEARBY_7) expect(out).toContain(verb);
    expect(out).toContain("barrier-free");
    for (const verb of ["get", "set", "path"]) expect(out).toContain(verb); // config 3 verb
  });

  it("bash·zsh·fish 모두 gil과 gildongmu 두 명령에 등록한다", async () => {
    const bash = await runCompletion("bash");
    expect(bash).toContain("complete -F _gil_complete gil");
    expect(bash).toContain("complete -F _gil_complete gildongmu");

    stdoutSpy.mockClear();
    const zsh = await runCompletion("zsh");
    expect(zsh).toContain("compdef _gil gil gildongmu");

    stdoutSpy.mockClear();
    const fish = await runCompletion("fish");
    expect(fish).toContain("complete -c gil -f");
    expect(fish).toContain("complete -c gildongmu -f");
    // 서브커맨드 매핑도 두 명령 모두에 등록되는지(별칭 반쪽 등록 회귀 방지).
    expect(fish).toContain('complete -c gildongmu -f -n "__fish_seen_subcommand_from nearby"');
  });

  it("지원하지 않는 셸이면 exit 2와 한국어 안내로 종료한다", async () => {
    await expect(runCompletion("powershell")).rejects.toThrow("EXIT_2");
    expect(exitSpy).toHaveBeenCalledWith(2);
    const err = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(err).toContain("지원하지 않는 셸: powershell");
  });
});
