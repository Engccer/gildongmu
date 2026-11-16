import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseReleaseNotes } from "../../../../scripts/build-release-notes.mjs";
import { APP_FEATURES_CHECKED_VERSION, buildChatSystemInstruction } from "../system-instruction";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

const general = buildChatSystemInstruction("ko", undefined, { journey: false });
const anchored = buildChatSystemInstruction("ko", { name: "길동역", category: "지하철역" }, { journey: true });

describe("[길동무 앱 기능] 단락(BACKLOG E88)", () => {
  it("범용 채팅과 장소 채팅 모두에 기능 요지 단락을 싣는다", () => {
    for (const text of [general, anchored]) {
      expect(text).toContain("[길동무 앱 기능]");
    }
  });

  it("실험판 전용 기능은 적지 않는다(위원장 판정 2026-11-17: 정식판 기능만)", () => {
    for (const name of ["나들이", "말로 묻기", "베르길리우스", "답변 모델", "탭 순서", "운전자 모드"]) {
      expect(general).not.toContain(name);
    }
  });

  it("정식판 기능과 대조한 버전이 최신 릴리스 노트 버전과 같다(새 버전이 오르면 단락을 다시 대조하고 값을 올린다)", () => {
    const notes = parseReleaseNotes(readFileSync(join(REPO_ROOT, "docs", "appstore", "release-notes.md"), "utf8"));
    expect(APP_FEATURES_CHECKED_VERSION).toBe(notes[0].version);
  });
});
