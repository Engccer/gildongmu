// A43 — 도시철도 seed 변환기의 `환승역구분` 판정: 접미 일치 + 모르는 값이면 중단.
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve("scripts/build-subway-stations.py");
const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** 스크립트를 모듈로 올려 파이썬 코드를 돌린다(파일명에 하이픈이 있어 importlib 경유). */
function py(code, args = []) {
  const prelude = [
    "import importlib.util, json, sys",
    `spec = importlib.util.spec_from_file_location("bss", ${JSON.stringify(script)})`,
    "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
  ].join("\n");
  return spawnSync("python3", ["-c", `${prelude}\n${code}`, ...args], { encoding: "utf8" });
}

describe("is_transfer (A43)", () => {
  it("알려진 어휘 4종 — 신분당선의 `도시철도 …`도 접미로 판정한다", () => {
    const r = py(
      'print(json.dumps([m.is_transfer(v) for v in ["환승역", "일반역", "도시철도 환승역", "도시철도 일반역", "  환승역 "]]))',
    );
    expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout)).toEqual([true, false, true, false, true]);
  });

  it("모르는 값(빈 값 포함)은 ValueError — 조용히 일반역으로 접지 않는다", () => {
    const r = py(
      [
        "out = []",
        'for v in ["경전철 환승역", "환승", "도시철도환승역", None, "", "-"]:',
        "    try: m.is_transfer(v); out.append('pass')",
        "    except ValueError: out.append('raise')",
        "print(json.dumps(out))",
      ].join("\n"),
    );
    expect(JSON.parse(r.stdout)).toEqual(Array(6).fill("raise"));
  });
});

const hasOpenpyxl = spawnSync("python3", ["-c", "import openpyxl"]).status === 0;

describe.skipIf(!hasOpenpyxl)("main — 모르는 어휘가 섞인 XLSX", () => {
  it("종료 코드 1로 중단하고 seed를 쓰지 않는다", () => {
    const dir = mkdtempSync(join(tmpdir(), "subway-stations-test-"));
    dirs.push(dir);
    const xlsx = join(dir, "stations.xlsx");
    const header = ["역번호", "역사명", "노선번호", "노선명", "영문역사명", "한자역사명",
      "환승역구분", "환승노선번호", "환승노선명", "역위도", "역경도",
      "운영기관명", "역사도로명주소", "역사전화번호", "데이터기준일자"];
    const row = (name, type) => ["1", name, "L1", "가상선", "", "", type, "", "", 37.5, 127.0, "가상공사", "", "", "2026-06-30"];
    const made = spawnSync("python3", ["-c", [
      "import json, sys, openpyxl",
      "wb = openpyxl.Workbook(); ws = wb.active",
      "for r in json.loads(sys.argv[2]): ws.append(r)",
      "wb.save(sys.argv[1])",
    ].join("\n"), xlsx, JSON.stringify([header, row("가상역", "환승역"), row("나상역", "경전철 환승역")])], { encoding: "utf8" });
    expect(made.status, made.stderr).toBe(0);

    // 회귀하면 main이 seed를 쓰므로 출력 경로를 임시 디렉터리로 돌려 놓고 돌린다(실 seed 불가침).
    const out = join(dir, "out.json");
    const r = py(
      [
        "from pathlib import Path",
        "m.OUT = Path(sys.argv[2])",
        'sys.argv = ["build-subway-stations.py", sys.argv[1]]',
        "m.main()",
      ].join("\n"),
      [xlsx, out],
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("모르는 환승역구분 값");
    expect(r.stderr).toContain("경전철 환승역");
    expect(existsSync(out)).toBe(false);
  });
});
