#!/usr/bin/env python3
"""한소네 7 점자 점검: 넓고 낮은 창의 두 칸 배치(B30, spec 2026-11-23-landscape-two-pane-design.md).

본체 점자 키를 주입하고 점자·화면 출력 기록(LCD)으로 판정한다. 음성은 판정하지 않는다. 도구·전제는 `hansone-smoke.py`와 같다.

    H7_SCRIPTS=<h7.py가 있는 폴더> python3 android/scripts/hansone-and-landscape.py [검색어]

보는 것: ①검색 결과 수 통지 뒤 커서가 오른쪽 칸 첫 결과에 앉는가(검색창이 화면에 보이는 채로) ②「이전 줄」로 결과 수 줄 → 왼쪽 칸
컨트롤 → 검색창 순으로 거슬러 가는가 ③「다음 줄」로 오른쪽 칸 결과를 끝까지(하단 탭이 나올 때까지) 차례로 훑는가
④길찾기·채팅 탭을 위에서부터 훑은 줄 순서(출력만 하고 사람이 읽는다). 종료 코드: 0 통과, 1 실패, 2 시작 조건 미충족.
"""
import os
import re
import subprocess
import sys
import time

PACKAGE = "space.dodoplanet.gildongmu"
TERMINAL_MODE = "com.selvashc.connectivity.connectivity"
STEP_WAIT = 1.8  # 출력이 키보다 한 박자 늦다(hansone-smoke.py와 같은 값)

scripts_dir = os.environ.get("H7_SCRIPTS")
if not scripts_dir or not os.path.exists(os.path.join(scripts_dir, "h7.py")):
    sys.exit("H7_SCRIPTS에 h7.py가 있는 폴더를 넘겨 주세요.")
if "ANDROID_SERIAL" not in os.environ:
    listing = subprocess.run(["adb", "devices", "-l"], capture_output=True, text=True, timeout=30).stdout
    serials = [line.split()[0] for line in listing.splitlines() if "BrailleSense" in line]
    if len(serials) == 1:
        os.environ["ANDROID_SERIAL"] = serials[0]
sys.path.insert(0, scripts_dir)
import h7  # noqa: E402

results: list[tuple[str, str, str]] = []


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def record(status: str, name: str, detail: str = "") -> None:
    results.append((status, name, detail))
    print(f"== {status} {name} {detail}", flush=True)


def focus() -> str:
    for _ in range(4):
        value = h7.focus()
        if value != "?":
            return value
        time.sleep(1.0)
    return "?"


def app_on_top() -> bool:
    return PACKAGE in h7.sh("dumpsys activity activities | grep topResumedActivity")


def press(spec: str, wait: float = STEP_WAIT, label: str | None = None) -> list[str]:
    since = h7.now()
    out = h7.brl(spec, label=label, wait=wait)
    if not out:
        time.sleep(1.0)
        out = h7.lcd(since)
    return [norm(o) for o in out]


def current(out: list[str]) -> str:
    return out[-1] if out else ""


def find(text: str, first: str = "next", limit: int = 14) -> str | None:
    keys = {"next": "space 4", "prev": "space 1"}
    other = "prev" if first == "next" else "next"
    for direction, count in ((first, limit), (other, limit * 2)):
        seen = ""
        for _ in range(count):
            line = current(press(keys[direction], label=f"{direction}→{text}"))
            if text in line:
                time.sleep(1.2)
                return line
            if line and line == seen:
                break
            seen = line or seen
    return None


def enter(wait: float) -> list[str]:
    return press("8", wait=wait, label="ENTER")


def masked(line: str) -> str:
    """위치 표시줄처럼 실제 주소가 든 줄은 앞부분만 남긴다."""
    return re.split(r"[(]", line)[0].strip()[:48]


def walk(direction: str, limit: int, stop: str | None = None) -> list[str]:
    """한 방향으로 줄을 옮기며 현재 줄을 모은다. `stop`이 든 줄이 나오거나 같은 줄이 되풀이되면 멈춘다."""
    key = {"next": "space 4", "prev": "space 1"}[direction]
    lines: list[str] = []
    for _ in range(limit):
        line = current(press(key, label=direction))
        if not line or (lines and line == lines[-1]):
            break
        lines.append(line)
        if stop and stop in line:
            break
    return lines


def dump(title: str, lines: list[str]) -> None:
    print(f"-- {title}")
    for i, line in enumerate(lines, 1):
        print(f"   {i:2d}. {masked(line)}")


def open_tab(name: str) -> bool:
    if not find(f"{name} 탭", first="next", limit=20):
        return False
    enter(3)
    return True


def run(query: str) -> None:
    size = h7.sh("wm size")
    record("INFO", "화면", norm(size))
    started = h7.now()
    h7.launch(f"{PACKAGE}/.MainActivity", wait=5)
    if PACKAGE not in focus():
        return record("FAIL", "앱 실행", focus())
    if any("길동무가 업데이트" in norm(o) for o in h7.lcd(started)) or find("길동무가 업데이트", first="prev", limit=12):
        if find("닫기 버튼", limit=16):
            enter(3)
        record("INFO", "새 소식 창 닫기")

    # ── 검색 ──
    if not find("검색 탭", first="prev"):
        return record("FAIL", "검색 탭 찾기")
    enter(3)
    if not find("장소 검색"):
        return record("FAIL", "검색 편집창 찾기")
    enter(2.5)
    press("8 space", wait=1.5, label="한글 입력")
    h7.type_text(query, "ko")
    out = enter(7)
    announced = next((o for o in out if "검색 결과" in o), None)
    if not announced:
        return record("FAIL", "검색 결과 통지", " / ".join(out)[-120:])
    record("PASS", "검색 결과 통지", announced)
    time.sleep(2.0)
    landed = current(out)
    if "검색 결과" in landed or "장소 검색" in landed or not landed:
        record("FAIL", "첫 결과 착지(통지 뒤 현재 줄)", landed[:60])
    else:
        record("PASS", "첫 결과 착지(통지 뒤 현재 줄)", landed[:60])

    back = walk("prev", 30, stop="장소 검색")  # 오른쪽 칸 맨 위에는 분류·지역 거르기 칩이 있다
    dump("첫 결과에서 「이전 줄」", back)
    status_at = next((i for i, l in enumerate(back) if "검색 결과" in l), None)
    field_at = next((i for i, l in enumerate(back) if "장소 검색" in l), None)
    if status_at is None or field_at is None:
        record("FAIL", "거꾸로 훑기: 결과 수 줄과 검색창 도달", f"결과 수 {status_at}, 검색창 {field_at}")
    elif status_at > field_at or any("체크박스" in l for l in back[status_at:]):
        record("FAIL", "거꾸로 훑기: 오른쪽 칸 → 결과 수 줄 → 왼쪽 칸 순서가 아님", f"결과 수 {status_at}, 검색창 {field_at}")
    else:
        record("PASS", "거꾸로 훑기: 결과 수 → 컨트롤 → 검색창", f"{field_at + 1}줄 만에 검색창")

    forward = walk("next", 60, stop=" 탭")
    dump("검색창에서 「다음 줄」(하단 탭까지)", forward)
    count_at = next((i for i, l in enumerate(forward) if "검색 결과" in l), None)
    reached_tabs = bool(forward) and " 탭" in forward[-1]
    rows_after = len(forward) - (count_at + 1) - (1 if reached_tabs else 0) if count_at is not None else 0
    total = int(m.group(1)) if (m := re.search(r"(\d+)\s*건", announced)) else 0
    if count_at is None:
        record("FAIL", "앞으로 훑기: 결과 수 줄", "")
    elif not reached_tabs:
        record("WARN", "앞으로 훑기: 60줄 안에 하단 탭에 닿지 않음", f"결과 수 뒤 {rows_after}줄")
    elif rows_after >= total:
        record("PASS", "앞으로 훑기: 오른쪽 칸 결과 끝까지 도달", f"통지 {total}건, 결과 수 뒤 {rows_after}줄")
    else:
        record("FAIL", "앞으로 훑기: 결과를 건너뛰고 하단 탭으로 감", f"통지 {total}건, 결과 수 뒤 {rows_after}줄")

    # ── 길찾기·채팅: 줄 순서만 출력 ──
    for name in ("길찾기", "채팅"):
        if not open_tab(name):
            record("WARN", f"{name} 탭 찾기 실패")
            continue
        time.sleep(2.0)
        # 탭을 누르면 커서는 탭 줄에 남는다. 위로 끝까지 올라간 뒤 내려오며 모은다.
        walk("prev", 30)
        lines = walk("next", 30, stop=" 탭")
        dump(f"{name} 탭을 위에서부터", lines)
        record("INFO", f"{name} 탭 줄 순서 출력", f"{len(lines)}줄")


def cleanup() -> None:
    if not app_on_top():
        return record("WARN", "마무리 건너뜀(앱이 맨 앞이 아님)", focus())
    press("space z", wait=3, label="앱 닫기")
    record("INFO", "앱 닫기", focus())


def main() -> int:
    window = focus()
    if window == "?":
        print("adb로 한소네를 찾지 못했습니다.")
        return 2
    if TERMINAL_MODE in window:
        print("한소네가 터미널 모드입니다. 화면 읽기 프로그램 연결을 끊은 뒤 다시 실행하세요.")
        return 2
    if PACKAGE not in h7.sh("pm", "list", "packages", PACKAGE):
        print("길동무가 설치돼 있지 않습니다. android에서 ./gradlew :app:installDebug 를 먼저 실행하세요.")
        return 2
    try:
        run(sys.argv[1] if len(sys.argv) > 1 else "스타벅스")
    finally:
        cleanup()
    print("\n결과")
    for status, name, detail in results:
        print(f"  {status}  {name}  {detail}")
    return 1 if any(s == "FAIL" for s, _, _ in results) else 0


if __name__ == "__main__":
    sys.exit(main())
