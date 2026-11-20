#!/usr/bin/env python3
"""가상 기기의 톡백이 말한 문장을 기록에서 읽는다. 준비 절차는 android/README.md §2 「화면 읽기 프로그램 자동 점검」.

    python3 android/scripts/talkback-speech.py on|off        톡백 켜기·끄기
    python3 android/scripts/talkback-speech.py tab [횟수]     탭 키로 초점을 옮기며 그때마다 말한 문장 출력
    python3 android/scripts/talkback-speech.py since <초>     최근 N초 동안 말한 문장 출력

톡백 쓸기 제스처는 주입되지 않는다(`input swipe`·톡백 키보드 단축키 모두 무반응, 톡백 15 실측 2026-11-20).
그래서 이동은 탭 키(입력 초점)로만 한다: 단추·링크 같은 조작 대상만 지나고 본문 글줄은 건너뛴다.
대상 기기는 ANDROID_SERIAL(기본 emulator-5554)이다. 실기기 한소네에는 쓰지 않는다.
"""
import os
import re
import subprocess
import sys
import time

SERIAL = os.environ.get("ANDROID_SERIAL", "emulator-5554")
SERVICE = "com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService"


def adb(*args: str) -> str:
    result = subprocess.run(["adb", "-s", SERIAL, *args], capture_output=True, text=True, timeout=30, errors="replace")
    if result.returncode != 0:
        sys.exit(f"adb 실패: {' '.join(args)}\n{result.stderr.strip()}")
    return result.stdout


def now() -> str:
    return adb("shell", "date", "'+%m-%d %H:%M:%S.000'").strip()


def spoken(since: str) -> list[str]:
    """`since`(기기 시각) 뒤에 톡백이 음성 합성기로 넘긴 문장들. 기록 수준이 VERBOSE여야 남는다."""
    # 톡백의 자세한 기록은 양이 많아 꼬리표 필터가 줄을 놓친다. 기기에서 먼저 걸러 받는다.
    log = adb("shell", "logcat -d -t 30000 | grep 'Speaking fragment' || true")
    pattern = r'^(\d\d-\d\d [\d:.]+) .*?Speaking fragment text="(.*?)", utteranceId'
    return [text for stamp, text in re.findall(pattern, log, re.M) if stamp >= since]


def set_talkback(enabled: bool) -> None:
    adb("shell", "settings", "put", "secure", "enabled_accessibility_services", SERVICE if enabled else '""')
    adb("shell", "settings", "put", "secure", "accessibility_enabled", "1" if enabled else "0")
    time.sleep(6)  # 서비스가 붙고 첫 낭독을 마칠 때까지


def main() -> None:
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command in ("on", "off"):
        set_talkback(command == "on")
    elif command == "tab":
        for _ in range(int(sys.argv[2]) if len(sys.argv) > 2 else 1):
            since = now()
            adb("shell", "input", "keyevent", "TAB")
            time.sleep(2.5)
            print(" | ".join(spoken(since)) or "(말 없음)", flush=True)
    elif command == "since" and len(sys.argv) > 2:
        seconds = int(sys.argv[2])
        since = adb("shell", "date", "-d", f"@$(($(date +%s) - {seconds}))", "'+%m-%d %H:%M:%S.000'").strip()
        print("\n".join(spoken(since)) or "(말 없음)")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
