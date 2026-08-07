#!/usr/bin/env python3
"""`unreliable` 톤 후보 합성(2026-08-08 선정용).

기존 8종 중 closer·farther가 합성 렌더 파일이라 합성 후보는 선례가 있다.
제약(spec `2026-08-08-background-tone-coverage-design.md` §10):

  ① `warning`(낮은 이중음·이탈)과 확실히 구분될 것 — 이탈은 사용자 행동,
     신뢰 불가는 기기 사정이라 취할 행동이 다르다.
  ② `.mixWithOthers`이므로 **배경 미디어 위에서 묻히지 않을 것**. 공존 확인만으로는
     저이득 톤이 팟캐스트·음악에 매몰되는 결함이 안 잡힌다.
  ③ 1초 미만.

출력: 후보 wav·mp3 + 게인 0.3 사본 + `warning` 대조본(이어 붙임).
확정본만 저장소에 배치한다(`public/sounds/guide/unreliable.mp3` +
`ios/Gildongmu/Resources/Sounds/guide-unreliable.mp3`, 바이트 동일).
"""
import math
import subprocess
import sys
import wave
from pathlib import Path

SR = 44100
REPO = Path(__file__).resolve().parent.parent
WARNING_MP3 = REPO / "public/sounds/guide/warning.mp3"


def env(i: int, n: int, attack: float = 0.012, release: float = 0.07) -> float:
    """클릭 방지 어택·릴리스 포락선(초 단위)."""
    t = i / SR
    total = n / SR
    a = min(1.0, t / attack) if attack > 0 else 1.0
    r = min(1.0, (total - t) / release) if release > 0 else 1.0
    return max(0.0, a * r)


def render(samples: list[float], path: Path) -> None:
    peak = max(1e-9, max(abs(s) for s in samples))
    frames = bytearray()
    for s in samples:
        v = int(max(-1.0, min(1.0, s / peak * 0.89)) * 32767)
        frames += v.to_bytes(2, "little", signed=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(bytes(frames))


def wobble(freq: float, depth: float, rate: float, dur: float) -> list[float]:
    """진폭이 흔들리는 단음. '불안정'을 음색 자체로 전달한다."""
    n = int(SR * dur)
    out = []
    for i in range(n):
        t = i / SR
        amp = 1.0 - depth * (0.5 - 0.5 * math.cos(2 * math.pi * rate * t))
        out.append(math.sin(2 * math.pi * freq * t) * amp * env(i, n))
    return out


def two_tone(f1: float, f2: float, dur: float, gap: float = 0.0) -> list[float]:
    """두 음 연속. 간격이 좁으면 불협으로 들린다."""
    out: list[float] = []
    for f in (f1, f2):
        n = int(SR * dur)
        out += [math.sin(2 * math.pi * f * (i / SR)) * env(i, n) for i in range(n)]
        if gap > 0:
            out += [0.0] * int(SR * gap)
    return out


def beat(f: float, delta: float, dur: float) -> list[float]:
    """두 근접 주파수의 맥놀이. 협화가 깨진 소리라 '못 믿겠다'와 짝이 맞는다."""
    n = int(SR * dur)
    return [
        (math.sin(2 * math.pi * f * (i / SR)) + math.sin(2 * math.pi * (f + delta) * (i / SR)))
        * 0.5
        * env(i, n)
        for i in range(n)
    ]


CANDIDATES = {
    # A: 흔들리는 단음(760Hz, 초당 18회 트레몰로). 가장 조용하고 배경에 잘 섞인다.
    "a-wobble": lambda: wobble(760, depth=0.7, rate=18, dur=0.42),
    # B: 좁은 간격 하강 2음(880→784Hz, 장2도). warning보다 높고 짧다.
    "b-dissonant": lambda: two_tone(880, 784, dur=0.16, gap=0.03),
    # C: 맥놀이 단음(700Hz + 7Hz 어긋남). 두 음이 서로 밀리며 흔들린다.
    "c-beat": lambda: beat(700, delta=7, dur=0.5),
}


def to_mp3(wav: Path, mp3: Path, volume: float | None = None) -> None:
    args = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav)]
    if volume is not None:
        args += ["-filter:a", f"volume={volume}"]
    args += ["-codec:a", "libmp3lame", "-b:a", "128k", str(mp3)]
    subprocess.run(args, check=True)


def main() -> int:
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/unreliable-candidates")
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, make in CANDIDATES.items():
        wav = out_dir / f"{name}.wav"
        render(make(), wav)
        to_mp3(wav, out_dir / f"{name}.mp3")
        # 배경 미디어 위 청취용: tick(0.3)과 같은 조건으로 낮춘 사본.
        to_mp3(wav, out_dir / f"{name}-gain03.mp3", volume=0.3)
        # warning 대조본: 이탈 경고 → 후보 순으로 이어 붙여 구분성을 확인한다.
        subprocess.run(
            [
                "ffmpeg", "-y", "-loglevel", "error",
                "-i", str(WARNING_MP3), "-i", str(out_dir / f"{name}.mp3"),
                "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1",
                str(out_dir / f"{name}-vs-warning.mp3"),
            ],
            check=True,
        )
        print(f"{name}: {out_dir / f'{name}.mp3'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
