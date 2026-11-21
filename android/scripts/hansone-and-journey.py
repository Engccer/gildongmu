#!/usr/bin/env python3
"""한소네 7 점검(and-journey-4: B26 여정 단계 5 길찾기 화면과 기존 길찾기 회귀).

공용 대본 `hansone-smoke.py`의 도우미(키 주입·줄 찾기·권한 창·마무리)를 불러 쓴다. 한 번의 기기 점유가 10분을 넘지 않게
국면을 인자로 나눈다.

    H7_SCRIPTS=<h7.py가 있는 폴더> python3 android/scripts/hansone-and-journey.py <국면> [도착지 검색어] [갈아탈 역 검색어]

국면:
- journey: 「경유지/자동차 환승 추가」 → 역 검색 → 확인 질문(버튼 순서) → 역 칸·남은 쪽 추가·지우기 → 조회 → 결과 줄 → 「안내 시작」 →
  첫 단계 시트(택시면 「자동차에서 내렸어요」) → 다음 단계 또는 여정 시트 → 「안내 종료」.
- aboard: 출발지 시트 「지하철역 검색」 → 역 → 노선·방면 단계 줄 → 조회 → 결과의 「안내 시작」 → 열차 고르기 시트 → 「안내 종료」.
- regress: 기존 길찾기 흐름(조회 완료 통지, 출발지와 도착지 바꾸기, 입구 검색으로 경유지, 경유지 삭제, 확인 질문 「닫기」, 갈아탈 역 지우기,
  최근 경로 다시 열기, 앱을 나갔다 돌아온 뒤 칸 내용).
- --cleanup: 끊긴 실행이 남긴 안내만 끝낸다.

경로 모양(택시로 시작하는가, 환승이 있는가, 역 B가 있는가)을 가정하지 않는다: 보이는 버튼을 읽고 갈래를 고른다.
전화·외부 앱을 여는 줄(「전화 걸기」 등)은 누르지 않는다. 권한 창은 대신 허용하지 않는다(「허용 안함」).
판정은 점자·화면 출력 기록(LCD)으로 한다. 안내 음성은 앱 TTS라 기록에 실리지 않을 수 있다(귀로 확인할 몫은 INFO).
종료 코드: 0 통과, 1 실패, 2 시작 조건 미충족, 124 SIGTERM(바깥 timeout).
"""
import importlib.util
import os
import signal
import sys
import time

signal.signal(signal.SIGTERM, lambda *_: sys.exit(124))

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("hansone_smoke", os.path.join(here, "hansone-smoke.py"))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)  # 기기 지정·h7 불러오기까지 한다(main은 돌지 않는다)
h7 = smoke.h7
record = smoke.record
press = smoke.press
current = smoke.current
find = smoke.find
enter = smoke.enter

SCAN_LIMIT = 60
# 누르지 않는 줄: 외부 앱을 연다.
FORBIDDEN = ("전화 걸기", "전화번호")


def doubled(line: str) -> bool:
    """앞 조각(첫 쉼표까지)이 같은 줄에 두 번 이상 나오면 중복 출력이다. 짧은 조각은 우연히 겹치니 4자 이상만 본다."""
    head = line.split(",")[0].replace("BT", "").strip()
    return len(head) >= 4 and line.count(head) > 1


def safe_enter(line: str | None, wait: float) -> list[str]:
    if line and any(word in line for word in FORBIDDEN):
        record("FAIL", "대본이 외부 앱 줄에서 엔터를 누르려 했다", line[:40])
        raise SystemExit(1)
    return enter(wait)


def guard() -> bool:
    """키를 넣기 전에 길동무가 맨 앞인지 본다. 권한 창이면 「허용 안함」으로 넘기고, 다른 앱이면 키를 넣지 않는다."""
    if smoke.in_app():
        return True
    smoke.dismiss_system_dialogs()
    if smoke.in_app():
        return True
    record("FAIL", "길동무가 맨 앞이 아니다(키를 넣지 않고 멈춤)", smoke.focus())
    return False


def scan(limit: int = 18, stop: str | None = None) -> list[str]:
    """아래로 훑어 줄을 모은다(같은 줄이 되풀이되면 끝)."""
    lines: list[str] = []
    for _ in range(limit):
        line = current(press("space 4", label="훑기"))
        if lines and line == lines[-1]:
            break
        if line:
            lines.append(line)
        if stop and stop in line:
            break
    return lines


def lcd_since(since: float, wait: float = 0.0) -> list[str]:
    if wait:
        time.sleep(wait)
    return [smoke.norm(o) for o in h7.lcd(since)]


def type_query(query: str) -> list[str]:
    press("8 space", wait=1.5, label="한글 입력")
    h7.type_text(query, "ko")
    return enter(7)


def to_directions(dest_query: str) -> bool:
    """검색 → 첫 결과 → 장소 상세 「여기까지 길찾기」(프리필). 길찾기 화면에 도착지가 서고 조회가 끝나면 참."""
    started = h7.now()
    h7.launch(f"{smoke.PACKAGE}/.MainActivity", wait=5)
    if not guard():
        return False
    if any("길동무가 업데이트" in o for o in lcd_since(started)):
        if find("닫기 버튼", limit=16):
            enter(3)
    if not find("검색 탭", first="prev"):
        record("FAIL", "검색 탭 찾기")
        return False
    enter(3)
    if not find("장소 검색"):
        record("FAIL", "검색 편집창 찾기")
        return False
    enter(2.5)
    out = type_query(dest_query)
    if not any("검색 결과" in o for o in out):
        record("FAIL", "검색 결과 통지", " / ".join(out)[-120:])
        return False
    row = current(out)
    if "검색 결과" in row or not row:
        press("space 4", label="첫 결과")
    enter(4)
    if not find("여기까지 길찾기"):
        record("FAIL", "장소 상세의 「여기까지 길찾기」")
        return False
    since = h7.now()
    enter(10)
    out = lcd_since(since, wait=6)
    ready = next((o for o in out if "경로 안내가 준비" in o or "찾지 못했" in o or "불러오지 못했" in o), None)
    record("PASS" if ready else "WARN", "「여기까지 길찾기」 뒤 조회 완료 통지", (ready or " / ".join(out)[-100:])[:80])
    return guard()


def field_value(label: str) -> str | None:
    line = find(f"{label},", first="prev", limit=SCAN_LIMIT)
    return line.split(",", 1)[1].strip() if line else None


def pick_candidate(contains: str, limit: int = 10) -> str | None:
    """검색 시트의 후보 줄 가운데 `contains`가 든 첫 줄로 간다(정류장·기타 장소 줄도 지나간다)."""
    for _ in range(limit):
        line = current(press("space 4", label=f"후보→{contains}"))
        if contains in line and "검색" not in line:
            return line
    return None


def open_transfer(station_query: str) -> str | None:
    """입구 버튼 → 역 검색 → 역 후보 엔터. 확인 질문 문장을 돌려준다."""
    entry = find("경유지/자동차 환승 추가", limit=SCAN_LIMIT)
    if not entry:
        record("FAIL", "입구 버튼 「경유지/자동차 환승 추가」", "여정 입력은 데이터 로케일 ko에서만 선다")
        return None
    record("FAIL" if doubled(entry) else "PASS", "입구 버튼 「경유지/자동차 환승 추가」", entry[:40])
    enter(3)
    out = type_query(station_query)
    record("PASS" if out else "WARN", "입구 검색 결과 통지", (current(out) or "")[:60])
    cand = pick_candidate("역")
    if not cand:
        record("FAIL", "입구 검색의 역 후보")
        return None
    since = h7.now()
    safe_enter(cand, 3)
    out = lcd_since(since, wait=2)
    ask = next((o for o in out if "예정인가요" in o), None)
    if not ask:
        ask = find("예정인가요", first="prev", limit=6)
    record("PASS" if ask else "FAIL", "확인 질문이 시트가 닫힌 뒤 뜬다", (ask or " / ".join(out)[-100:])[:90])
    return ask


def question_buttons() -> list[str]:
    buttons: list[str] = []
    for line in scan(limit=8):
        if "예정인가요" in line:
            continue
        buttons.append(line)
        if "닫기" in line:
            break
    return buttons


def check_question_order(ask: str, buttons: list[str]) -> None:
    for b in buttons:
        print(f"   ? {b}", flush=True)
    ok = len(buttons) >= 4 and buttons[0].startswith("네") and "경유만" in buttons[2] and "닫기" in buttons[3]
    record("PASS" if ok else "FAIL", "확인 질문 버튼 순서(짐작, 반대편, 경유만, 닫기)", " | ".join(b[:18] for b in buttons[:4]))
    twice = [b for b in buttons if doubled(b)]
    record("FAIL" if twice else "PASS", "확인 질문 버튼 한 번 출력", (twice[0][:50] if twice else ""))


def answer_first() -> str | None:
    """첫 버튼(짐작)을 누르고 착지한 줄(새 칸)을 돌려준다."""
    yes = find("네", first="prev", limit=8)
    if not yes or not yes.startswith("네"):
        record("FAIL", "확인 질문 첫 버튼 「네, …」 찾기", yes or "")
        return None
    since = h7.now()
    enter(3)
    out = lcd_since(since, wait=2)
    landed = current(out)
    field = landed if ("자동차에서 내리는" in landed or "자동차를 탈" in landed) else None
    record("PASS" if field else "WARN", "답한 뒤 새 역 칸에 착지", (landed or "")[:60])
    return field


def run_journey(dest_query: str, station_query: str) -> None:
    if not to_directions(dest_query):
        return
    ask = open_transfer(station_query)
    if not ask:
        return
    check_question_order(ask, question_buttons())
    if not answer_first():
        field = find("자동차에서 내리는", first="prev", limit=SCAN_LIMIT) or find("자동차를 탈", first="prev", limit=SCAN_LIMIT)
        if not field:
            return record("FAIL", "역 칸이 서지 않았다")
    rest = scan(limit=8, stop="경로 조회")
    for line in rest:
        print(f"   | {line}", flush=True)
    has_clear = any("갈아탈 역/정류장 지우기" in l for l in rest)
    has_add = any(l.startswith("자동차에서 내리는 역/정류장 추가") or l.startswith("자동차를 탈 역/정류장 추가") for l in rest)
    record("PASS" if has_clear else "FAIL", "「갈아탈 역/정류장 지우기」")
    record("PASS" if has_add else "FAIL", "남은 쪽 추가 버튼")
    record("FAIL" if any("경유지/자동차 환승 추가" in l for l in rest) else "PASS", "역 칸이 서면 입구 버튼이 사라진다")
    submit = find("경로 조회", first="prev", limit=10)
    if not submit:
        return record("FAIL", "「경로 조회」")
    since = h7.now()
    enter(15)
    out = lcd_since(since, wait=8)
    status = next((o for o in out if "경로 안내가 준비" in o or "찾지 못했" in o or "불러오지 못했" in o or "환승" in o and "없" in o), None)
    record("PASS" if status else "WARN", "여정 조회 완료 통지", (status or " / ".join(out)[-100:])[:80])
    if not status or "준비" not in status:
        return record("INFO", "여정 경로를 찾지 못해 결과 줄·안내 단계는 보지 못함", (status or "")[:60])
    rows = scan(limit=40, stop="안내 시작")
    for line in rows:
        print(f"   > {line}", flush=True)
    twice = [l for l in rows if doubled(l)]
    record("FAIL" if twice else "PASS", "여정 결과 줄 한 번 출력", (twice[0][:50] if twice else ""))
    start = next((l for l in rows if l.endswith("안내 시작")), None)
    if not start:
        return record("FAIL", "여정 결과의 「… 안내 시작」")
    record("PASS", "여정 결과의 「… 안내 시작」", start[:50])
    run_stages()


def run_stages() -> None:
    """「안내 시작」을 누르고 보이는 단계 버튼을 따라간다(경로 모양을 가정하지 않는다)."""
    since = h7.now()
    enter(10)
    smoke.dismiss_system_dialogs()
    if not guard():
        return
    out = lcd_since(since, wait=8)
    for o in out[-10:]:
        print(f"   > {o}", flush=True)
    lines = scan(limit=16, stop="안내 종료")
    for line in lines:
        print(f"   | {line}", flush=True)
    twice = [l for l in lines if doubled(l)]
    record("FAIL" if twice else "PASS", "첫 단계 시트 줄 한 번 출력", (twice[0][:50] if twice else ""))
    dropped = next((l for l in lines if "자동차에서 내렸어요" in l), None)
    if dropped:
        record("PASS", "택시 단계 시트의 「자동차에서 내렸어요」", dropped[:40])
        find("자동차에서 내렸어요", first="prev", limit=16)
        since = h7.now()
        enter(6)
        out = lcd_since(since, wait=6)
        for o in out[-10:]:
            print(f"   > {o}", flush=True)
        landed = current(out)
        record("INFO", "「자동차에서 내렸어요」 뒤 첫 출력(여정 시트 상태 문장·다음 단계 시트)", landed[:70])
        smoke.dismiss_system_dialogs()
        lines = scan(limit=16, stop="안내 종료")
        for line in lines:
            print(f"   | {line}", flush=True)
        failed = next((l for l in lines if "경로 다시 조회" in l), None)
        if failed:
            record("INFO", "여정 실패 시트(실내 측위 실패일 수 있다)", " / ".join(lines)[:90])
    else:
        record("INFO", "첫 단계가 택시가 아니다(접근 도보·대중교통으로 시작)", (lines[0] if lines else "")[:50])
    stop = find("안내 종료", limit=20)
    if not stop:
        return record("FAIL", "「안내 종료」 도달")
    record("PASS", "「안내 종료」 도달", stop[:30])
    since = h7.now()
    enter(5)
    out = lcd_since(since, wait=3)
    record("INFO", "「안내 종료」 뒤 출력", " / ".join(out)[-90:])
    back = find("경로 조회", first="prev", limit=SCAN_LIMIT)
    record("PASS" if back else "WARN", "종료 뒤 길찾기 화면 복귀", (back or "")[:30])


def run_aboard(dest_query: str, station_query: str) -> None:
    if not to_directions(dest_query):
        return
    origin = find("출발지,", first="prev", limit=SCAN_LIMIT)
    if not origin:
        return record("FAIL", "출발지 칸")
    enter(3)
    row = find("지하철역 검색", limit=8)
    if not row:
        return record("FAIL", "출발지 시트의 「지하철역 검색」 행", "데이터 로케일 ko에서만 선다")
    record("PASS", "출발지 시트의 「지하철역 검색」 행", row[:30])
    since = h7.now()
    enter(3)
    out = lcd_since(since, wait=1)
    record("PASS" if any("정차 중인 역" in o for o in out) else "INFO", "검색칸 문구가 지하철역 검색으로 바뀐다", current(out)[:50])
    type_query(station_query)
    cand = pick_candidate("역")
    if not cand:
        return record("FAIL", "지하철역 후보")
    since = h7.now()
    safe_enter(cand, 3)
    out = lcd_since(since, wait=7)
    step = next((o for o in out if "어느 노선" in o or "어느 방면" in o or "조회되지 않습니다" in o or "불러오지 못했" in o or "실시간 열차 정보가 없어" in o), None)
    step = step or find("어느 방면", first="prev", limit=8) or find("어느 노선", first="prev", limit=8)
    record("PASS" if step else "FAIL", "단계 줄이 선다(노선·방면·열차 없음·실패·정보 없음)", (step or " / ".join(out)[-90:])[:70])
    if not step:
        return
    if "어느 노선" in step:
        line_button = current(press("space 4", label="첫 노선"))
        record("INFO", "노선 버튼", line_button[:40])
        since = h7.now()
        enter(3)
        out = lcd_since(since, wait=2)
        step = next((o for o in out if "어느 방면" in o or "조회되지 않습니다" in o), None) or find("어느 방면", first="prev", limit=6)
        record("PASS" if step else "FAIL", "노선을 고르면 방면 질문", (step or "")[:50])
        if not step:
            return
    if "어느 방면" not in step:
        refresh = find("새로고침", limit=4)
        has_refresh = refresh is not None
        expected = "실시간 열차 정보가 없어" not in step
        record("PASS" if has_refresh == expected else "FAIL", "열차 없음·실패엔 「새로고침」, 정보 없음엔 문장만", step[:50])
        return record("INFO", "방면이 없어 지금 탄 열차 조회·안내는 보지 못함(열차 운행 시간에 다시)")
    direction = current(press("space 4", label="첫 방면"))
    record("FAIL" if doubled(direction) else "PASS", "방면 버튼", direction[:50])
    since = h7.now()
    enter(3)
    out = lcd_since(since, wait=2)
    origin = find("출발지,", first="prev", limit=12)
    record("PASS" if origin and "지금 탄 열차" in origin else "FAIL", "출발지 칸 「출발지, 지금 탄 열차, {역}, {방면}」", (origin or "")[:60])
    rest = scan(limit=8, stop="경로 조회")
    record("FAIL" if any("바꾸기" in l for l in rest) else "PASS", "지금 탄 열차면 「출발지와 도착지 바꾸기」가 없다")
    submit = find("경로 조회", first="prev", limit=10)
    if not submit:
        return record("FAIL", "「경로 조회」")
    since = h7.now()
    enter(15)
    out = lcd_since(since, wait=8)
    status = next((o for o in out if "경로 안내가 준비" in o or "찾지 못했" in o or "불러오지 못했" in o or "열차" in o), None)
    record("PASS" if status else "WARN", "지금 탄 열차 조회 완료 통지", (status or " / ".join(out)[-100:])[:80])
    if not status or "준비" not in status:
        return record("INFO", "지금 탄 열차 경로가 없어 안내는 보지 못함", (status or "")[:60])
    rows = scan(limit=40, stop="안내 시작")
    start = next((l for l in rows if l == "안내 시작" or l.startswith("안내 시작")), None)
    record("PASS" if start else "FAIL", "지금 탄 열차 결과의 이름 없는 「안내 시작」", (start or (rows[-1] if rows else ""))[:40])
    if not start:
        return
    since = h7.now()
    enter(10)
    smoke.dismiss_system_dialogs()
    out = lcd_since(since, wait=8)
    pick = next((o for o in out if "타고 계신 차량" in o), None) or find("타고 계신 차량", first="prev", limit=12)
    record("PASS" if pick else "WARN", "대중교통 시트 첫 착지 「타고 계신 차량을 선택하세요」", (pick or current(out))[:50])
    stop = find("안내 종료", limit=24)
    if not stop:
        return record("FAIL", "「안내 종료」 도달")
    enter(5)
    record("PASS", "지금 탄 열차 안내 「안내 종료」")


def run_regress(dest_query: str, station_query: str) -> None:
    if not to_directions(dest_query):
        return
    to_before = field_value("도착지")
    record("PASS" if to_before else "FAIL", "프리필 도착지 칸", (to_before or "")[:40])
    # 출발지와 도착지 바꾸기: 도착지 값이 출발지로 간다. 되돌려 놓는다.
    swap = find("출발지와 도착지 바꾸기", first="prev", limit=SCAN_LIMIT)
    if swap:
        enter(3)
        from_after = field_value("출발지")
        record("PASS" if to_before and from_after and to_before in from_after else "FAIL", "바꾸기 뒤 출발지가 옛 도착지", (from_after or "")[:40])
        if find("출발지와 도착지 바꾸기", limit=8):
            enter(3)
    else:
        record("FAIL", "「출발지와 도착지 바꾸기」")
    # 확인 질문 「닫기」: 아무것도 바꾸지 않고 입구 버튼으로 돌아온다.
    ask = open_transfer(station_query)
    if ask:
        close = find("닫기", limit=8)
        if close:
            since = h7.now()
            enter(3)
            out = lcd_since(since, wait=2)
            record("PASS" if "경유지/자동차 환승 추가" in current(out) else "WARN", "질문 「닫기」 뒤 입구 버튼에 착지", current(out)[:50])
        # 다시 열어 짐작을 받고 「갈아탈 역/정류장 지우기」로 지운다.
        ask = open_transfer(station_query)
        if ask and answer_first() is not None or find("갈아탈 역/정류장 지우기", limit=10):
            clear = find("갈아탈 역/정류장 지우기", limit=10)
            if clear:
                since = h7.now()
                enter(3)
                out = lcd_since(since, wait=2)
                record("PASS" if "경로 조회" in current(out) else "WARN", "지우기 뒤 「경로 조회」에 착지", current(out)[:40])
                record("PASS" if find("경유지/자동차 환승 추가", first="prev", limit=8) else "FAIL", "지우면 입구 버튼이 돌아온다")
    # 입구 검색으로 역이 아닌 장소를 고르면 종전 경유지 확정이다.
    entry = find("경유지/자동차 환승 추가", first="prev", limit=SCAN_LIMIT)
    if entry:
        enter(3)
        type_query("편의점")
        cand = current(press("space 4", label="첫 후보"))
        since = h7.now()
        safe_enter(cand, 4)
        via = find("경유지,", first="prev", limit=SCAN_LIMIT)
        record("PASS" if via else "FAIL", "역이 아닌 장소는 경유지로 확정", (via or "")[:40])
        remove = find("경유지 삭제", limit=6)
        if remove:
            since = h7.now()
            enter(3)
            out = lcd_since(since, wait=2)
            record("PASS" if "경로 조회" in current(out) else "WARN", "「경유지 삭제」 뒤 「경로 조회」에 착지", current(out)[:40])
        else:
            record("FAIL", "「경유지 삭제」")
    # 최근 경로 다시 열기: 결과가 비어 있으면 섹션이 보인다.
    recent = find("최근 경로", limit=SCAN_LIMIT)
    if recent:
        item = current(press("space 4", label="첫 최근 경로"))
        record("FAIL" if doubled(item) else "PASS", "최근 경로 줄", item[:50])
        since = h7.now()
        safe_enter(item, 12)
        out = lcd_since(since, wait=6)
        ready = next((o for o in out if "경로 안내가 준비" in o or "찾지 못했" in o or "불러오지 못했" in o), None)
        record("PASS" if ready else "WARN", "최근 경로를 누르면 다시 조회", (ready or " / ".join(out)[-80:])[:70])
    else:
        record("INFO", "최근 경로 섹션을 찾지 못함(결과가 떠 있으면 숨는다)")
    # 앱을 나갔다 돌아오면 칸 내용이 남는다.
    to_now = field_value("도착지")
    h7.sh("input keyevent KEYCODE_HOME")
    time.sleep(3)
    h7.launch(f"{smoke.PACKAGE}/.MainActivity", wait=5)
    if not guard():
        return
    to_back = field_value("도착지")
    record("PASS" if to_now and to_back == to_now else "FAIL", "앱 복귀 뒤 도착지 칸 유지", f"{(to_now or '')[:24]} → {(to_back or '')[:24]}")


def main() -> int:
    window = smoke.focus()
    if window == "?":
        print("adb로 한소네를 찾지 못했습니다.")
        return 2
    if smoke.TERMINAL_MODE in window:
        print("한소네가 터미널 모드입니다. 화면 읽기 프로그램 연결을 끊은 뒤 다시 실행하세요.")
        return 2
    args = sys.argv[1:]
    phase = args[0] if args else "journey"
    dest = args[1] if len(args) > 1 else "경복궁"
    station = args[2] if len(args) > 2 else "서울역"
    phases = {"journey": run_journey, "aboard": run_aboard, "regress": run_regress}
    try:
        if phase in phases:
            phases[phase](dest, station)
        elif phase != "--cleanup":
            print(f"국면을 고르세요: {', '.join(phases)} 또는 --cleanup")
            return 2
    finally:
        smoke.cleanup()
    print("\n결과")
    for status, name, detail in smoke.results:
        print(f"  {status}  {name}  {detail}")
    return 1 if any(s == "FAIL" for s, _, _ in smoke.results) else 0


if __name__ == "__main__":
    sys.exit(main())
