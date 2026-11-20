#!/usr/bin/env python3
"""한소네 7 점검(and-wave1-fix: 웨이브 1 재리뷰 지적).

    H7_SCRIPTS=<h7.py가 있는 폴더> python3 android/scripts/hansone-and-wave1-fix.py --only stack|history|reorder|around

단계(기기 점유를 10분 안으로 나누려고 한 번에 하나씩 돈다):
- stack(재리뷰 지적 1): 바로가기(NEW_TASK|CLEAR_TASK)·안내 알림(NEW_TASK|SINGLE_TOP) 뒤 홈 → 런처 아이콘을 두 번 눌러도
  `MainActivity`가 하나이고, 바로가기로 연 「내 주변」 화면이 그대로다. 대조(런처로만 두 번)도 하나. 겹침은 `am`만 쓰고 키를 넣지 않는다.
- history(지적 2): 「내 주변」 바로가기로 연 뒤 탭 루트에서 뒤로 가기(ESC)로 앱을 나가면 액티비티가 끝나는가(끝나면 최근 앱에서 다시 열 때
  바로가기 인텐트로 새로 만들어져 액션이 다시 돈다). 끝났을 때만 `FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY`로 최근 앱 재실행을 흉내 낸다.
- reorder(재감사 1-2): 고정한 최근 검색 12개(시험용 이름, 앱 자기 저장소에 넣고 끝나면 되돌린다)에서 맨 아래 줄을 작업 메뉴 「맨 위로」로
  옮긴 뒤 커서가 옮긴 줄에 남는지 본다(다음 줄이 둘째 고정 항목이면 남은 것).
- around(관찰): 내 주변 → 둘러보기 첫 줄(위치 문장)이 점자·화면 출력에 두 번 실리는지 본다. 위치 문장은 실제 주소라 앞 열 글자만 적는다.
판정은 점자·화면 출력 기록(LCD)과 `dumpsys`. 종료 코드: 0 통과, 1 실패, 2 시작 조건 미충족.
"""
import importlib.util
import json
import os
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("hansone_smoke", os.path.join(here, "hansone-smoke.py"))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)  # 기기 지정·h7 불러오기까지 한다(main은 돌지 않는다)
h7 = smoke.h7
record = smoke.record
current = smoke.current
enter_raw = smoke.enter
PACKAGE = smoke.PACKAGE
MAIN = f"{PACKAGE}/.MainActivity"
REPORTS = os.environ.get("WAVE1_FIX_REPORTS", os.path.expanduser("~/gildongmu-wt/and-wave1-fix-reports"))

ROTOR_NEXT = "7 8 space 5 6"
ITEM_NEXT = "7 8 space 4"
ITEM_RUN = "7 8 space 1 4"
PIN_NAMES = [f"순서 시험 {c}" for c in "가나다라마바사아자차카타"]


class ForeignApp(RuntimeError):
    """길동무가 아닌 앱이 앞에 있다(다른 세션의 앱일 수 있다). 그 앱에 키를 넣지 않는다."""


def press(spec_: str, wait: float = smoke.STEP_WAIT, label: str | None = None) -> list[str]:
    if not smoke.app_on_top() and "launcher" not in smoke.focus().lower():
        raise ForeignApp(smoke.focus())
    return smoke.press(spec_, wait=wait, label=label)


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


def sh(*args: str) -> str:
    return h7.sh(*args)


def count() -> int:
    out = sh("dumpsys activity activities")
    return sum(1 for line in out.splitlines() if "Hist" in line and f"{PACKAGE}/.MainActivity" in line)


def home() -> None:
    sh("am", "start", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.HOME")
    time.sleep(3)


def launcher_icon() -> None:
    # 런처가 아이콘을 누를 때 보내는 인텐트(MAIN+LAUNCHER, NEW_TASK|RESET_TASK_IF_NEEDED).
    sh("am", "start", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER", "-f", "0x10200000", "-n", MAIN)
    time.sleep(4)


def shortcut(action: str, flags: str = "0x10008000") -> None:
    # 정적 바로가기는 시스템이 NEW_TASK|CLEAR_TASK(0x10008000)를 붙여 연다.
    sh("am", "start", "-f", flags, "-a", f"{PACKAGE}.action.{action}", "-n", MAIN)
    time.sleep(6)


def stop_app() -> None:
    sh("am", "force-stop", PACKAGE)
    time.sleep(1)


# ── stack ─────────────────────────────────────────────────────────────

def check_stack() -> None:
    stop_app()
    shortcut("NEARBY")
    first = count()
    home()
    launcher_icon()
    once = count()
    home()
    launcher_icon()
    twice = count()
    ok = first == once == twice == 1
    record("PASS" if ok else "FAIL", "바로가기 → 홈 → 런처 아이콘 두 번: 화면 하나(지적 1)", f"직후 {first}, 1회 {once}, 2회 {twice}")
    # 보던 화면 그대로: 내 주변 화면에만 있는 「둘러보기」가 보인다.
    line = find("둘러보기", limit=8)
    record("PASS" if line else "FAIL", "런처 복귀 뒤 바로가기로 연 「내 주변」 화면 그대로", line or "")

    stop_app()
    launcher_icon()
    # 안내 알림의 PendingIntent(NEW_TASK|SINGLE_TOP, 액션 없음)를 흉내 낸다(같은 뿌리, 범위 밖 관찰).
    sh("am", "start", "-f", "0x30000000", "-n", MAIN)
    time.sleep(4)
    home()
    launcher_icon()
    home()
    launcher_icon()
    n = count()
    record("PASS" if n == 1 else "FAIL", "알림 인텐트 → 홈 → 런처 아이콘 두 번: 화면 하나", f"{n}")

    stop_app()
    launcher_icon()
    home()
    launcher_icon()
    n = count()
    record("PASS" if n == 1 else "FAIL", "대조: 런처로만 두 번", f"{n}")


# ── history ───────────────────────────────────────────────────────────

def check_history() -> None:
    stop_app()
    shortcut("NEARBY")
    steps = []
    for i in range(4):
        if not smoke.app_on_top():
            break
        out = press("f4", wait=3, label="뒤로(ESC)")
        steps.append(f"ESC{i + 1}: {current(out)[:20]} / 화면 {count()}개")
    left = count()
    recents = "space.dodoplanet.gildongmu" in sh("dumpsys activity recents")
    record("INFO", "바로가기 → 뒤로 가기로 앱을 나감", f"{' ; '.join(steps)} ; 최근 앱에 태스크 {'있음' if recents else '없음'}")
    if smoke.app_on_top():
        return record("FAIL", "뒤로 가기 네 번에도 앱이 맨 앞", smoke.focus())
    if left >= 1:
        record("PASS", "뒤로 가기는 태스크를 뒤로 보낸다(액티비티 유지) — 최근 앱 복귀는 새로 만들지 않아 액션이 다시 돌지 않는다(지적 2 재현 안 됨)", f"화면 {left}개")
        return
    record("INFO", "뒤로 가기가 액티비티를 끝냈다 — 최근 앱 재실행을 흉내 낸다", "")
    shortcut("NEARBY", flags="0x10100000")  # NEW_TASK|LAUNCHED_FROM_HISTORY
    line = find("둘러보기", limit=8)
    record("FAIL" if line else "PASS", "최근 앱 재실행이 바로가기 액션을 다시 실행하지 않는다(지적 2)", line or "")


# ── reorder ───────────────────────────────────────────────────────────

PREFS = "shared_prefs/gildongmu.xml"
BACKUP = os.path.join(REPORTS, "prefs-backup.xml")


def run_as(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["adb", "shell", "run-as", PACKAGE, *args], capture_output=True, text=True, timeout=30)


def seed_pins() -> bool:
    stop_app()
    old = run_as("cat", PREFS)
    root = ET.fromstring(old.stdout) if old.returncode == 0 and old.stdout.strip().startswith("<?xml") else ET.Element("map")
    with open(BACKUP, "w") as f:
        f.write(old.stdout if old.returncode == 0 else "")
    for e in list(root):
        if e.get("name") == "recentQueries.v2":
            root.remove(e)
    item = ET.SubElement(root, "string", name="recentQueries.v2")
    item.text = json.dumps([{"text": n, "pinned": True} for n in PIN_NAMES], ensure_ascii=False)
    local = os.path.join(REPORTS, "prefs-seeded.xml")
    with open(local, "wb") as f:
        f.write(b"<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n" + ET.tostring(root, encoding="utf-8"))
    subprocess.run(["adb", "push", local, "/data/local/tmp/gd-prefs.xml"], capture_output=True, timeout=30)
    sh("chmod", "644", "/data/local/tmp/gd-prefs.xml")
    return run_as("cp", "/data/local/tmp/gd-prefs.xml", PREFS).returncode == 0


def restore_prefs() -> None:
    stop_app()
    text = open(BACKUP).read() if os.path.exists(BACKUP) else ""
    if text.strip():
        subprocess.run(["adb", "push", BACKUP, "/data/local/tmp/gd-prefs.xml"], capture_output=True, timeout=30)
        sh("chmod", "644", "/data/local/tmp/gd-prefs.xml")
        ok = run_as("cp", "/data/local/tmp/gd-prefs.xml", PREFS).returncode == 0
    else:
        ok = run_as("rm", PREFS).returncode == 0
    sh("rm", "/data/local/tmp/gd-prefs.xml")
    record("PASS" if ok else "WARN", "시험용 고정 항목 되돌림(앱 저장소)", "")


def rotor_to(unit: str) -> bool:
    for _ in range(10):
        if current(press(ROTOR_NEXT, label="로터")) == unit:
            return True
    return False


def check_reorder() -> None:
    if not seed_pins():
        return record("FAIL", "시험용 고정 항목 넣기")
    try:
        smoke.h7.launch(MAIN, wait=5)
        if not find("검색 탭", first="prev", limit=20):
            return record("FAIL", "검색 탭 찾기")
        enter(3)
        last = find(PIN_NAMES[-1], limit=30)
        if not last:
            return record("FAIL", "맨 아래 고정 항목 찾기", PIN_NAMES[-1])
        if not rotor_to("작업"):
            return record("FAIL", "로터 「작업」 단위 없음")
        moved = []
        for _ in range(8):
            if "맨 위로" in current(press(ITEM_NEXT, label="작업 항목")):
                moved = press(ITEM_RUN, wait=4, label="실행 맨 위로")
                break
        rotor_to("줄")
        record("INFO" if moved else "FAIL", "「맨 위로」 실행 출력", " / ".join(moved)[-80:])
        after = current(press("space 4", label="다음 줄"))
        before = current(press("space 1", label="이전 줄(돌아옴)"))
        stayed = PIN_NAMES[0] in after and PIN_NAMES[-1] in before
        record("PASS" if stayed else "FAIL", "옮긴 줄에 커서가 남는다(재감사 1-2)", f"다음 {after[:30]} / 돌아온 줄 {before[:30]}")
    finally:
        restore_prefs()


# ── around ────────────────────────────────────────────────────────────

def check_around() -> None:
    smoke.h7.launch(MAIN, wait=5)
    if not find("내 주변 탭", first="prev", limit=20):
        return record("FAIL", "내 주변 탭 찾기")
    enter(3)
    if not find("둘러보기", limit=10):
        return record("FAIL", "둘러보기 버튼 찾기")
    out = enter(12)
    print("   둘러보기 출력 줄 수:", len(out), flush=True)
    line = next((o for o in out if "기준" in o or "근처" in o or "위치" in o), current(out))
    head = line[:10]
    twice = bool(head) and line.count(head) >= 2
    record("FAIL" if twice else "PASS", "둘러보기 첫 줄이 한 번만 실린다(관찰 around-top)", f"앞 10자 {'두 번' if twice else '한 번'}, 줄 길이 {len(line)}")


def cleanup() -> None:
    if smoke.app_on_top():
        try:
            press("space z", wait=3, label="앱 닫기")
        except ForeignApp:
            pass
    record("PASS" if not smoke.app_on_top() else "WARN", "앱 닫기", smoke.focus())


def main() -> int:
    window = smoke.focus()
    if window == "?":
        print("adb로 한소네를 찾지 못했습니다.")
        return 2
    if smoke.TERMINAL_MODE in window:
        print("한소네가 터미널 모드입니다.")
        return 2
    if PACKAGE not in h7.sh("pm", "list", "packages", PACKAGE):
        print("길동무가 설치돼 있지 않습니다.")
        return 2
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else "stack"
    stages = {"stack": check_stack, "history": check_history, "reorder": check_reorder, "around": check_around}
    try:
        stages[only]()
    except ForeignApp as e:
        record("INFO", "다른 앱이 앞에 있어 키 입력을 멈춤(다른 세션 사용 중일 수 있음)", str(e))
    finally:
        cleanup()
    print("\n결과")
    for status, name, detail in smoke.results:
        print(f"  {status}  {name}  {detail}")
    if any(n.startswith("다른 앱이 앞에") for _, n, _ in smoke.results):
        return 2
    return 1 if any(s == "FAIL" for s, _, _ in smoke.results) else 0


if __name__ == "__main__":
    sys.exit(main())
