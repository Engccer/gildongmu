#!/usr/bin/env python3
"""한소네 7 점자 점검: 받아쓰기·탭 새로고침·위치 표시줄·설정·정보 출처·앱 바로가기(B22·B27, and-common).

본체 점자 키를 주입하고 점자·화면 출력 기록(LCD)으로 판정한다. 음성은 판정하지 않는다. 도구·전제는 `hansone-smoke.py`와 같다.

    H7_SCRIPTS=<h7.py가 있는 폴더> python3 android/scripts/hansone-and-common.py [--cleanup]

위치 표시줄 줄은 실제 주소가 들어가므로 앞부분(괄호 앞)만 적는다. 고정 항목 순서 바꾸기(B23)는 작업 메뉴를 여는 한소네 키가
확인되지 않아 이 대본에서 다루지 않는다. 종료 코드: 0 통과, 1 실패, 2 시작 조건 미충족.
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
mic_was_granted: bool | None = None
seen_lines: list[str] = []


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def record(status: str, name: str, detail: str = "") -> None:
    results.append((status, name, detail))
    print(f"== {status} {name} {detail}", flush=True)


class ForeignApp(RuntimeError):
    """길동무가 아닌 앱이 앞에 있다(다른 세션의 앱일 수 있다). 그 앱에 키를 넣지 않고 멈춘다."""


def press(spec: str, wait: float = STEP_WAIT, label: str | None = None) -> list[str]:
    if not app_on_top() and "launcher" not in focus():
        raise ForeignApp(focus())
    since = h7.now()
    out = h7.brl(spec, label=label, wait=wait)
    if not out:
        time.sleep(1.0)
        out = h7.lcd(since)
    out = [norm(o) for o in out]
    seen_lines.extend(out)
    return out


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


def esc() -> list[str]:
    return press("f4", wait=3, label="ESC")


def focus() -> str:
    for _ in range(4):
        value = h7.focus()
        if value != "?":
            return value
        time.sleep(1.0)
    return "?"


def app_on_top() -> bool:
    return PACKAGE in h7.sh("dumpsys activity activities | grep topResumedActivity")


def masked(line: str) -> str:
    """위치 표시줄 줄의 주소를 가린다(괄호·쉼표 뒤를 뺀다)."""
    return re.split(r"[(,]", line)[0].strip()


def launch(action: str | None = None) -> None:
    if action:
        # 정적 바로가기는 시스템이 NEW_TASK|CLEAR_TASK(0x10008000)를 붙여 연다. 플래그 없이 열면 화면이 겹쳐 실제와 다르다.
        h7.sh("am", "start", "-f", "0x10008000", "-a", action, "-n", f"{PACKAGE}/.MainActivity")
        time.sleep(6)
    else:
        h7.launch(f"{PACKAGE}/.MainActivity", wait=5)


def go_search_tab() -> bool:
    if not find("검색 탭", first="prev"):
        return False
    enter(3)
    return True


def check_search_order() -> None:
    """검색 버튼 → 받아쓰기 시작 → 위치 표시줄(B22 ①·B27 ③, iOS SearchView 순서)."""
    if not find("장소 검색"):
        return record("FAIL", "검색 편집창 찾기")
    order = [current(press("space 4", label="검색 탭 순서")) for _ in range(4)]
    print("   순서:", [masked(o) for o in order], flush=True)
    dictation = next((i for i, o in enumerate(order) if "받아쓰기 시작" in o), None)
    if dictation is None:
        return record("FAIL", "검색 탭 받아쓰기 버튼", " / ".join(masked(o) for o in order))
    record("PASS", "검색 탭 받아쓰기 버튼", order[dictation])
    after = order[dictation + 1] if dictation + 1 < len(order) else ""
    if "위치" in after:
        record("PASS", "받아쓰기 뒤 위치 표시줄", masked(after))
    else:
        record("FAIL", "받아쓰기 뒤 위치 표시줄", masked(after))


def check_dictation_toggle() -> None:
    """받아쓰기 시작 → 라벨이 「받아쓰기 중지」로 바뀌거나 안내 문장이 나온다(침묵 금지). 녹음 중이면 바로 멈춘다."""
    if not find("받아쓰기 시작", first="prev"):
        return record("FAIL", "받아쓰기 시작 버튼 다시 찾기")
    out = enter(5)
    joined = " / ".join(out)
    # 녹음 중에는 낭독이 없을 수 있다(라벨이 상태 신호). 출력에 없으면 커서를 옮겨 라벨을 직접 읽는다.
    line = next((o for o in out if "받아쓰기 중지" in o), None) or find("받아쓰기 중지", first="prev", limit=4)
    if line:
        record("PASS", "받아쓰기 켜짐(라벨 중지)", line)
        if find("받아쓰기 중지", first="prev", limit=4):
            enter(4)
    elif out:
        record("INFO", "받아쓰기 시작 결과(녹음 대신 안내)", joined[-100:])
    else:
        record("FAIL", "받아쓰기 시작 뒤 라벨이 「받아쓰기 중지」로 바뀌지 않음")
    time.sleep(2)


def check_refresh() -> None:
    """검색 결과가 있는 상태에서 「새로고침」 → 새 화면의 같은 버튼에 착지, 최근 검색이 다시 보인다(B27 ①)."""
    if not find("장소 검색", first="prev"):
        return record("FAIL", "새로고침 전 편집창")
    enter(2.5)
    press("8 space", wait=1.5, label="한글 입력")
    h7.type_text("길동 치킨", "ko")
    out = enter(6)
    if not any("검색 결과" in o or "검색 중" in o for o in out):
        record("WARN", "새로고침 전 검색 통지 없음", " / ".join(out)[-80:])
    line = find("새로고침", first="prev", limit=20)
    if not line:
        return record("FAIL", "상단 바 「새로고침」 찾기")
    out = enter(5)
    landed = current(out)
    if "새로고침" in landed:
        record("PASS", "새로고침 뒤 같은 버튼에 착지", landed)
    else:
        record("FAIL", "새로고침 뒤 착지", " / ".join(out)[-80:])
    if find("최근 검색", limit=10):
        record("PASS", "새로고침 뒤 처음 상태(최근 검색 보임)")
    else:
        record("FAIL", "새로고침 뒤 처음 상태", "최근 검색 줄 없음")


def check_settings_and_sources() -> None:
    """설정에 「받아쓰기 방식」이 없고(B22 ③), 정보 출처에 걸음·칼로리 고지가 있다(B27 ④)."""
    if not find("설정", first="prev", limit=20):
        return record("FAIL", "설정 버튼 찾기")
    enter(4)
    if find("받아쓰기 방식", limit=14):
        record("FAIL", "설정에 「받아쓰기 방식」이 남아 있음")
    else:
        record("PASS", "설정에 「받아쓰기 방식」 없음")
    if not find("정보 출처", limit=20):
        esc()
        return record("FAIL", "설정의 「정보 출처」 찾기")
    enter(4)
    line = find("걸음 수", limit=24)
    if line:
        record("PASS", "정보 출처 걸음·칼로리 고지", line[:60])
    else:
        record("FAIL", "정보 출처 걸음·칼로리 고지")
    esc()
    time.sleep(2)
    esc()
    time.sleep(2)


def check_shortcuts() -> None:
    """앱 바로가기 인텐트 두 개(B22 ④): 「내 주변」은 내 주변 탭, 「음성 검색」은 검색 탭 받아쓰기 시작.

    먼저 채팅 탭에서 설정을 연 채 검색 탭으로 옮겨 둔다. 바로가기는 모든 탭을 초기화하므로, 뒤에 채팅 탭을 누르면 설정이 아니라
    탭 처음 화면(상단 바 「새로고침」이 있는 화면)이어야 한다(리뷰 지적: 시작 탭의 저장된 화면이 되살아나던 결함).
    """
    prepared = False
    if find("채팅 탭", first="prev", limit=20):
        enter(3)
        if find("설정", first="prev", limit=12):
            enter(4)
            if find("검색 탭", first="prev", limit=20):
                enter(3)
                prepared = True
    launch(f"{PACKAGE}.action.NEARBY")
    if not app_on_top():
        return record("FAIL", "바로가기 「내 주변」 실행", focus())
    line = find("내 주변", first="prev", limit=8)
    record("PASS" if line else "FAIL", "바로가기 「내 주변」 → 내 주변 화면", line or "")
    if prepared and find("채팅 탭", first="prev", limit=20):
        enter(3)
        root = find("새로고침", first="prev", limit=10)
        record("PASS" if root else "FAIL", "바로가기 뒤 채팅 탭은 처음 화면(설정이 되살아나지 않음)", root or "")
    else:
        record("INFO", "바로가기 리셋 준비(채팅 탭 → 설정 → 검색 탭) 실패, 되살아남 점검 건너뜀")
    since = h7.now()
    launch(f"{PACKAGE}.action.VOICE_SEARCH")
    out = [norm(o) for o in h7.lcd(since)]
    seen_lines.extend(out)
    # 녹음 중에는 낭독이 없다(라벨이 상태 신호). 커서를 옮겨 버튼 라벨을 직접 읽는다.
    line = next((o for o in out if "받아쓰기 중지" in o), None) or find("받아쓰기 중지", first="prev", limit=10)
    if line:
        record("PASS", "바로가기 「음성 검색」 → 받아쓰기 켜짐(라벨 중지)", line)
        if find("받아쓰기 중지", first="prev", limit=4):
            enter(4)
    else:
        record("FAIL", "바로가기 「음성 검색」 뒤 「받아쓰기 중지」 없음", " / ".join(masked(o) for o in out)[-100:])


def check_duplicates() -> None:
    """한 줄 안에 같은 문구가 두 번 실린 출력(점자·화면 중복)을 찾는다."""
    dups = []
    for line in set(seen_lines):
        parts = [p.strip() for p in re.split(r"[,]", line) if len(p.strip()) >= 3]
        if len(parts) != len(set(parts)):
            dups.append(masked(line)[:60])
    record("WARN" if dups else "PASS", "한 줄 안 중복 출력", " / ".join(dups[:5]))


MIC = "android.permission.RECORD_AUDIO"


def mic_granted() -> bool:
    return f"{MIC}: granted=true" in h7.sh(f"dumpsys package {PACKAGE} | grep RECORD_AUDIO")


def cleanup() -> None:
    if mic_was_granted is False:
        h7.sh("pm", "revoke", PACKAGE, MIC)  # 시험 전 상태로(이 앱의 마이크 권한만)
    if app_on_top():
        press("space z", wait=3, label="앱 닫기")
    record("PASS" if not app_on_top() else "WARN", "앱 닫기", focus())


def main() -> int:
    window = focus()
    if window == "?":
        print("adb로 한소네를 찾지 못했습니다.")
        return 2
    if TERMINAL_MODE in window:
        print("한소네가 터미널 모드입니다.")
        return 2
    if PACKAGE not in h7.sh("pm", "list", "packages", PACKAGE):
        print("길동무가 설치돼 있지 않습니다.")
        return 2
    global mic_was_granted
    mic_was_granted = mic_granted()
    try:
        if sys.argv[1:] != ["--cleanup"]:
            # 받아쓰기 시작을 보려면 마이크 권한이 있어야 한다. 권한 창 조작 대신 이 앱에만 시험 동안 주고 끝나면 거둔다.
            if not mic_was_granted:
                h7.sh("pm", "grant", PACKAGE, MIC)
            launch()
            if not go_search_tab():
                record("FAIL", "검색 탭 찾기")
            else:
                check_search_order()
                check_dictation_toggle()
                check_refresh()
                check_settings_and_sources()
                check_shortcuts()
                check_duplicates()
    except ForeignApp as e:
        record("INFO", "다른 앱이 앞에 있어 키 입력을 멈춤(다른 세션 사용 중일 수 있음)", str(e))
    finally:
        cleanup()
    print("\n결과")
    for status, name, detail in results:
        print(f"  {status}  {name}  {detail}")
    if any(n.startswith("다른 앱이 앞에") for _, n, _ in results):
        return 2
    return 1 if any(s == "FAIL" for s, _, _ in results) else 0


if __name__ == "__main__":
    sys.exit(main())
