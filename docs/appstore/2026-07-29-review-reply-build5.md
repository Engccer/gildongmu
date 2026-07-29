# App Review 회신 초안 — 1.0 (5) 재제출 (Submission 28eca73c, Guideline 2.1(a))

> 발송 채널: App Store Connect > App Review 페이지 > Reply. 발송 전 위원장 승인 필수.

---

Hello,

Thank you for the detailed feedback and the attached screenshots. They helped us identify the root cause precisely.

Gildongmu is a South Korea regional service. All of its data sources (Korean government open-data APIs, Kakao and Naver local search, Korea Meteorological Administration weather, AirKorea air quality, and Korean routing providers) cover South Korea only. During the review, the device's location was outside South Korea, so location-based screens (Weather and air quality, Where am I, nearby lists) had no data to show. In build 4 those screens displayed generic failure messages, which understandably looked like loading bugs. The dictation issue had a similar root: the microphone defaulted to a press-and-hold gesture that gave no visible feedback on a short tap, and first-time speech-model preparation happened silently.

Build 5 (1.0.0 (5)) addresses all reported issues:

1. Out-of-coverage handling. When the current location is outside South Korea, every location-based feature now shows a clear informational notice instead of an error: "Location-based features are available within South Korea. Place search, station info, and directions remain available." The rest of the app remains fully functional from anywhere in the world: place and address search (for example "Gyeongbokgung"), station facilities and timetables, directions preview between Korean locations, and per-place chat.

2. Voice dictation. The microphone now defaults to a simple tap-to-start, tap-to-stop toggle, and its label reflects the current state. First-time speech-model preparation shows a visible "Preparing speech recognition" state with a progress indicator, and failures now show specific, actionable messages (for example, asking to connect to the network) instead of failing silently.

3. The misleading "Failed to get current location" message was replaced. It now appears only for genuine location permission or acquisition failures; out-of-coverage and server issues each have their own accurate messages.

To verify during review, with the device located outside South Korea: open the Nearby tab and enter any item — each shows the coverage notice above rather than an error; search for a Korean place such as "Gyeongbokgung" and open its details; request Directions between Korean locations. Tap the microphone button in Search or Chat to see the tap-toggle dictation flow.

Thank you again for the report — it helped us make the app communicate its service region clearly.

Best regards,
Hunyong Kim
