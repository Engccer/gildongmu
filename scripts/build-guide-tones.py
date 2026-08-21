#!/usr/bin/env python3
"""도보 안내 결정 지점 톤 5종 세분화(N2, 2026-08-22)의 소리 정본 생성기.

기존 9종 중 closer·farther가 합성 렌더 파일이라 합성은 선례가 있다. 이 스크립트가
만드는 7개 파일은 **웹 `public/sounds/guide/<이름>.mp3`와 iOS
`ios/Gildongmu/Resources/Sounds/guide-<이름>.mp3`에 같은 바이트로 배치**된다
(`sounds-drift.test.ts`가 강제). 재생성은 결정론적이다(같은 파라미터 → 같은 wav →
같은 ffmpeg 인코딩).

  crosswalk   음향신호기식 비프 4연음 ×2(2.0kHz 60ms, 묶음 사이 0.25초)  1.1초
  left-pan    상승 2음 모티프(880→1175Hz) 좌 채널 하드 패닝              0.5초
  right-pan   같은 모티프 우 채널
  left-pitch  낮은 모티프(440→523Hz) 모노
  right-pitch 높은 모티프(880→1047Hz) 모노
  back        하강 글라이드 2회(1200→400Hz) — "되돌아감"                 0.9초

⚠ **햅틱 패턴(`BeaconTonePlayer.haptic(for:)`·`useBeaconSound` VIBRATE)은 아래
  타이밍 상수에서 직접 나온다.** 합성이라 파형이 곧 설계값이므로 실측 분석이 필요
  없지만, 상수를 바꾸면 두 재생기의 햅틱도 함께 갱신할 것.

좌우 구분 후보(패닝 A / 음높이 B)는 위원장 실기기 선택 뒤 패자를 지우고 `left`·
`right`로 이름을 접는다(spec `2026-08-22-walk-tone-taxonomy-design.md` §3).
"""
import math
import subprocess
import sys
import wave
from pathlib import Path

SR = 44100
REPO = Path(__file__).resolve().parent.parent
WEB = REPO / "public/sounds/guide"
IOS = REPO / "ios/Gildongmu/Resources/Sounds"

# 타이밍 상수(초) — 햅틱 동조의 정본.
BEEP_HZ = 2000.0
BEEP_LEN = 0.06
BEEP_GAP = 0.06
BEEP_GROUP_GAP = 0.25
MOTIF_NOTE = 0.18
MOTIF_GAP = 0.04
GLIDE_LEN = 0.4
GLIDE_GAP = 0.1


def env(i: int, n: int, attack: float = 0.008, release: float = 0.04) -> float:
    t = i / SR
    total = n / SR
    a = min(1.0, t / attack) if attack > 0 else 1.0
    r = min(1.0, (total - t) / release) if release > 0 else 1.0
    return max(0.0, min(a, r))


def tone(freq_start: float, seconds: float, freq_end: float | None = None, amp: float = 0.8) -> list[float]:
    n = int(SR * seconds)
    out = []
    phase = 0.0
    for i in range(n):
        f = freq_start if freq_end is None else freq_start + (freq_end - freq_start) * (i / n)
        phase += 2 * math.pi * f / SR
        out.append(amp * env(i, n) * math.sin(phase))
    return out


def silence(seconds: float) -> list[float]:
    return [0.0] * int(SR * seconds)


def beeps() -> list[float]:
    out: list[float] = []
    for group in range(2):
        for k in range(4):
            out += tone(BEEP_HZ, BEEP_LEN, amp=0.7)
            if k < 3:
                out += silence(BEEP_GAP)
        if group == 0:
            out += silence(BEEP_GROUP_GAP)
    return out


def motif(lo: float, hi: float) -> list[float]:
    return tone(lo, MOTIF_NOTE) + silence(MOTIF_GAP) + tone(hi, MOTIF_NOTE)


def glide_back() -> list[float]:
    return tone(1200, GLIDE_LEN, 400) + silence(GLIDE_GAP) + tone(1200, GLIDE_LEN, 400)


def write_wav(path: Path, left: list[float], right: list[float] | None) -> None:
    channels = 2 if right is not None else 1
    with wave.open(str(path), "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = bytearray()
        for i, l in enumerate(left):
            frames += int(max(-1, min(1, l)) * 32767).to_bytes(2, "little", signed=True)
            if right is not None:
                frames += int(max(-1, min(1, right[i])) * 32767).to_bytes(2, "little", signed=True)
        w.writeframes(bytes(frames))


def main() -> int:
    mono = motif(880, 1175)
    zero = [0.0] * len(mono)
    specs: dict[str, tuple[list[float], list[float] | None]] = {
        "crosswalk": (beeps(), None),
        "left-pan": (mono, zero),
        "right-pan": (zero, mono),
        "left-pitch": (motif(440, 523), None),
        "right-pitch": (motif(880, 1047), None),
        "back": (glide_back(), None),
    }
    tmp = REPO / ".tmp-guide-tones"
    tmp.mkdir(exist_ok=True)
    for name, (l, r) in specs.items():
        wav = tmp / f"{name}.wav"
        write_wav(wav, l, r)
        web = WEB / f"{name}.mp3"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-codec:a", "libmp3lame",
             "-b:a", "128k", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", str(web)],
            check=True,
        )
        (IOS / f"guide-{name}.mp3").write_bytes(web.read_bytes())
        print(f"{name}: {len(l) / SR:.2f}s")
    for p in tmp.iterdir():
        p.unlink()
    tmp.rmdir()
    return 0


if __name__ == "__main__":
    sys.exit(main())
