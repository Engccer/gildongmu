#!/usr/bin/env python3
"""한소네 7 점자 사용 흐름 점검: 검색 → 장소 상세 → 길찾기 → 도보 안내 → 제목 메뉴 → 안내 종료.

본체 점자 키를 주입하고 점자·화면 출력 기록(LCD)으로 판정한다. 음성은 판정하지 않는다.
키 주입 도구 `h7.py`는 저장소 밖에 있다. 그 폴더를 환경 변수 H7_SCRIPTS로 넘긴다.

    H7_SCRIPTS=<h7.py가 있는 폴더> python3 android/scripts/hansone-smoke.py [검색어]

전제: `installDebug`로 앱이 설치돼 있고, 한소네가 터미널 모드(화면 읽기 프로그램의 점자 단말)가 아니며,
위치를 잡을 수 있다. 실제 위치에서 실제 경로를 조회하므로 결과 가게 이름은 실행 장소에 따라 다르다.
끝나면 안내를 종료하고 앱을 닫는다. 종료 코드: 0 통과, 1 실패, 2 시작 조건 미충족.
"""
import os
import re
import subprocess
import sys
import time

PACKAGE = "space.dodoplanet.gildongmu"
TERMINAL_MODE = "com.selvashc.connectivity.connectivity"
# 출력이 키보다 한 박자 늦다. 1.0초로 훑으면 한 칸 어긋난 줄을 현재 줄로 읽는다(2026-11-20 실측).
STEP_WAIT = 1.8

scripts_dir = os.environ.get("H7_SCRIPTS")
if not scripts_dir or not os.path.exists(os.path.join(scripts_dir, "h7.py")):
    sys.exit("H7_SCRIPTS에 h7.py가 있는 폴더를 넘겨 주세요.")
if "ANDROID_SERIAL" not in os.environ:
    # h7.py는 기기를 지정하지 않고 adb를 부른다. 가상 기기가 함께 떠 있어도 한소네로 가게 한다.
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


def press(spec: str, wait: float = STEP_WAIT, label: str | None = None) -> list[str]:
    """키 하나를 넣고 그 뒤에 나온 출력 줄들을 돌려준다. 비어 있으면 한 번 더 기다렸다 읽는다."""
    since = h7.now()
    out = h7.brl(spec, label=label, wait=wait)
    if not out:
        time.sleep(1.0)
        out = h7.lcd(since)
    return [norm(o) for o in out]


def current(out: list[str]) -> str:
    return out[-1] if out else ""


def find(text: str, first: str = "next", limit: int = 14) -> str | None:
    """커서를 옮겨 `text`가 든 줄을 찾는다. 한 방향에서 못 찾으면 반대 방향으로 두 배를 훑는다."""
    keys = {"next": "space 4", "prev": "space 1"}
    other = "prev" if first == "next" else "next"
    for direction, count in ((first, limit), (other, limit * 2)):
        seen = ""
        for _ in range(count):
            line = current(press(keys[direction], label=f"{direction}→{text}"))
            if text in line:
                time.sleep(1.2)  # 늦게 도착한 출력이 이 줄을 밀어내지 않는지 본다
                return line
            if line and line == seen:
                break  # 끝에 닿아 같은 줄이 되풀이된다
            seen = line or seen
    return None


def enter(wait: float) -> list[str]:
    return press("8", wait=wait, label="ENTER")


def in_app() -> bool:
    return PACKAGE in h7.focus()


def dismiss_system_dialogs() -> None:
    """앱 밖 창(권한 요청 등)이 뜨면 「허용 안함」으로 넘긴다. 권한을 대신 허용하지 않는다."""
    for _ in range(3):
        if in_app():
            return
        focus = h7.focus()
        if find("허용 안함", limit=6):
            enter(6)
            record("INFO", "시스템 창을 「허용 안함」으로 넘김", focus)
        else:
            press("f4", wait=3, label="ESC")
            record("INFO", "시스템 창을 ESC로 닫음", focus)


def run(query: str) -> None:
    h7.launch(f"{PACKAGE}/.MainActivity", wait=5)
    if not in_app():
        return record("FAIL", "앱 실행", h7.focus())
    record("PASS", "앱 실행")

    if not find("검색 탭", first="prev"):
        return record("FAIL", "검색 탭 찾기")
    enter(3)
    if not find("장소 검색"):
        return record("FAIL", "검색 편집창 찾기", "탭을 바꾼 뒤 편집창에 닿지 못했다")
    record("PASS", "검색 탭과 편집창 도달")

    enter(2.5)
    press("8 space", wait=1.5, label="한글 입력")
    typed = " ".join(norm(o) for o in h7.type_text(query, "ko"))
    if query.split()[0] not in typed:
        record("WARN", "한글 점자 입력 확인 불가", typed[-60:])
    out = enter(6)
    announced = next((o for o in out if "검색 결과" in o), None)
    if not announced:
        return record("FAIL", "검색 결과 통지", " / ".join(out)[-120:])
    record("PASS", "검색 결과 통지", announced)

    row = current(out)
    if "검색 결과" in row or not row:
        row = current(press("space 4", label="첫 결과"))
    name = row.split(",")[0].replace("BT", "").strip()
    if name and row.count(name) > 1:
        record("WARN", "결과 줄에 이름이 두 번 출력(A75)", row[:80])
    else:
        record("PASS", "결과 줄 한 번 출력", row[:60])

    enter(4)
    if not find("여기까지 길찾기"):
        return record("FAIL", "장소 상세의 「여기까지 길찾기」")
    record("PASS", "장소 상세 도달", name)
    enter(8)

    line = find("안내 시작", limit=16)
    if not line and find("확인", limit=6):  # 길찾기 탭의 새 소식 시트가 앞을 막을 때
        enter(6)
        line = find("안내 시작", limit=16)
    if not line:
        return record("FAIL", "경로 조회 뒤 「안내 시작」")
    record("PASS", "경로 조회", line[:60])

    out = enter(10)
    dismiss_system_dialogs()
    if not in_app():
        return record("FAIL", "안내 시작 뒤 앱 복귀", h7.focus())
    landed = next((o for o in out if "남은 거리" in o), None)
    if landed:
        record("PASS", "안내 시트 첫 착지", landed[:60])
    elif find("남은 거리", limit=8):
        record("WARN", "안내 시트는 열렸으나 커서가 「남은 거리」에 앉지 않음", " / ".join(out)[-80:])
    else:
        return record("FAIL", "안내 시트 열림")

    if not find("도보 안내", first="prev"):
        return record("FAIL", "안내 시트 제목 찾기")
    menu = enter(4)
    first_item = current(menu)
    items = [first_item] + [current(press("space 4", label="메뉴")) for _ in range(3)]
    if not any("장소 상세 보기" in i for i in items):
        record("FAIL", "제목 메뉴", " / ".join(items)[:120])
    elif "전화 걸기" in first_item:
        record("PASS", "제목 메뉴, 첫 항목 전화 걸기")
    else:
        record("INFO", "제목 메뉴(이 장소는 전화번호 없음)", first_item[:40])
    press("f4", wait=3, label="ESC")


def cleanup() -> None:
    if not in_app():
        return
    if find("안내 종료", limit=16):
        enter(6)
    press("space z", wait=3, label="앱 닫기")
    record("PASS" if not in_app() else "WARN", "안내 종료와 앱 닫기", h7.focus())


def main() -> int:
    focus = h7.focus()
    if focus == "?":
        print("adb로 한소네를 찾지 못했습니다.")
        return 2
    if TERMINAL_MODE in focus:
        print("한소네가 터미널 모드입니다. 화면 읽기 프로그램 연결을 끊은 뒤 다시 실행하세요.")
        return 2
    if PACKAGE not in h7.sh("pm", "list", "packages", PACKAGE):
        print("길동무가 설치돼 있지 않습니다. android에서 ./gradlew :app:installDebug 를 먼저 실행하세요.")
        return 2

    try:
        run(sys.argv[1] if len(sys.argv) > 1 else "길동 치킨")
    finally:
        cleanup()

    print("\n결과")
    for status, name, detail in results:
        print(f"  {status}  {name}  {detail}")
    return 1 if any(s == "FAIL" for s, _, _ in results) else 0


if __name__ == "__main__":
    sys.exit(main())
