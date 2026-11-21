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


def focus() -> str:
    """지금 초점 창. 창이 바뀌는 순간과 adb 서버가 다시 뜨는 순간에는 「?」가 오므로 몇 번 다시 읽는다."""
    for _ in range(4):
        value = h7.focus()
        if value != "?":
            return value
        time.sleep(1.0)
    return "?"


def in_app() -> bool:
    return PACKAGE in focus()


def app_on_top() -> bool:
    """앱의 메뉴(팝업 창)가 초점을 쥐고 있어도 앱이 맨 앞이면 참이다."""
    return PACKAGE in h7.sh("dumpsys activity activities | grep topResumedActivity")


def dismiss_system_dialogs() -> None:
    """앱 밖 창(권한 요청 등)이 뜨면 「허용 안함」으로 넘긴다. 권한을 대신 허용하지 않는다."""
    for _ in range(3):
        if in_app():
            return
        window = focus()
        if find("허용 안함", limit=6):
            enter(6)
            record("INFO", "시스템 창을 「허용 안함」으로 넘김", window)
        else:
            press("f4", wait=3, label="ESC")
            record("INFO", "시스템 창을 ESC로 닫음", window)


def run(query: str) -> None:
    started = h7.now()
    h7.launch(f"{PACKAGE}/.MainActivity", wait=5)
    if not in_app():
        return record("FAIL", "앱 실행", focus())
    record("PASS", "앱 실행")
    # 앱 시작 새 소식 창(B27 ⑤)이 떠 있으면 「닫기」로 확인한다(다음 실행부터 안 뜬다). 머티리얼 「시트 닫기」는 저장하지 않아 고르지 않는다.
    if any("길동무가 업데이트" in norm(o) for o in h7.lcd(started)) or find("길동무가 업데이트", first="prev", limit=12):
        if find("닫기 버튼", limit=16):
            enter(3)
        record("INFO", "새 소식 창 닫기")

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

    started = h7.now()
    enter(10)
    dismiss_system_dialogs()
    if not in_app():
        return record("FAIL", "안내 시작 뒤 앱 복귀", focus())
    time.sleep(6)  # 첫 착지는 경로 조회와 안내 음성이 끝난 뒤에 앉는다
    out = [norm(o) for o in h7.lcd(started)]
    landed = next((o for o in reversed(out) if "남은 거리" in o), None)
    if landed:
        record("PASS", "안내 시트 첫 착지", landed[:60])
    else:
        # 착지 출력이 기록에 없을 때: 바로 다음 줄을 적어 둔다(「남은 거리」 다음 줄이면 출력 없이 앉은 것이다).
        after = current(press("space 4", label="착지 다음 줄"))
        if not find("남은 거리", first="prev", limit=8):
            return record("FAIL", "안내 시트 열림")
        record("WARN", "안내 시트는 열렸으나 「남은 거리」 착지 출력이 없음", f"다음 줄: {after[:50]}")

    if not find("도보 안내", first="prev"):
        return record("FAIL", "안내 시트 제목 찾기")
    menu = enter(4)
    first_item = current(menu)
    items = [first_item] + [current(press("space 4", label="메뉴")) for _ in range(3)]
    detail = next((n for n, i in enumerate(items) if "장소 상세 보기" in i), None)
    change = next((n for n, i in enumerate(items) if "목적지 바꾸기" in i), None)
    if detail is None:
        record("FAIL", "제목 메뉴", " / ".join(items)[:120])
    elif change is None or change > detail:  # 아이폰 순서: 전화 걸기 → 목적지 바꾸기 → 장소 상세 보기(2026-11-21 위원장 판정)
        record("FAIL", "제목 메뉴 순서(목적지 바꾸기 → 장소 상세 보기)", " / ".join(items)[:120])
    elif "전화 걸기" in first_item:
        record("PASS", "제목 메뉴, 첫 항목 전화 걸기")
    else:
        record("INFO", "제목 메뉴(이 장소는 전화번호 없음)", first_item[:40])
    press("f4", wait=3, label="ESC")


def cleanup() -> None:
    if not app_on_top():
        return record("WARN", "마무리 건너뜀(앱이 맨 앞이 아님)", focus())
    if not in_app():
        press("f4", wait=3, label="ESC")  # 열린 메뉴 닫기
    ended = find("안내 종료", limit=16)
    if ended:
        enter(6)
    press("space z", wait=3, label="앱 닫기")
    closed = not app_on_top()
    record("PASS" if ended and closed else "WARN", "안내 종료와 앱 닫기", f"종료 단추 {'찾음' if ended else '못 찾음'}, {focus()}")


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
        if sys.argv[1:] != ["--cleanup"]:  # --cleanup: 중간에 끊긴 실행이 남긴 안내만 끝낸다
            run(sys.argv[1] if len(sys.argv) > 1 else "길동 치킨")
    finally:
        cleanup()

    print("\n결과")
    for status, name, detail in results:
        print(f"  {status}  {name}  {detail}")
    return 1 if any(s == "FAIL" for s, _, _ in results) else 0


if __name__ == "__main__":
    sys.exit(main())
