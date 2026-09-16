package space.dodoplanet.gildongmu.audio

/**
 * mp3 길이(초) — 프레임 헤더 계수(테스트 전용, spec §10-1 ⑤'). ID3v2 syncsafe 크기 건너뛰기 → Xing/Info 프레임 수(+ LAME 지연·패딩 차감) 우선 →
 * 없으면 동기워드를 따라 프레임 길이(`144 × bitrate / sampleRate + padding`)로 세기 → 후행 ID3v1 128바이트 제외 →
 * `frames × samplesPerFrame / sampleRate`. 파서 자가 시험(합성 바이트열)이 표를 그대로 돌려주는 파서를 막는다.
 */
internal fun mp3DurationSeconds(bytes: ByteArray): Double {
    var pos = 0
    if (bytes.size >= 10 && bytes[0] == 'I'.code.toByte() && bytes[1] == 'D'.code.toByte() && bytes[2] == '3'.code.toByte()) {
        val size = ((bytes[6].toInt() and 0x7F) shl 21) or ((bytes[7].toInt() and 0x7F) shl 14) or ((bytes[8].toInt() and 0x7F) shl 7) or (bytes[9].toInt() and 0x7F)
        val footer = (bytes[5].toInt() and 0x10) != 0
        pos = 10 + size + (if (footer) 10 else 0)
    }
    var end = bytes.size
    if (end - 128 >= pos && bytes[end - 128] == 'T'.code.toByte() && bytes[end - 127] == 'A'.code.toByte() && bytes[end - 126] == 'G'.code.toByte()) end -= 128

    var frames = 0L
    var sampleRate = 0
    var samplesPerFrame = 0
    var first = true
    while (pos + 4 <= end) {
        val b1 = bytes[pos].toInt() and 0xFF
        val b2 = bytes[pos + 1].toInt() and 0xFF
        if (b1 != 0xFF || (b2 and 0xE0) != 0xE0) { pos++; continue }
        val b3 = bytes[pos + 2].toInt() and 0xFF
        val b4 = bytes[pos + 3].toInt() and 0xFF
        val version = (b2 shr 3) and 3          // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
        val layer = (b2 shr 1) and 3            // 1=Layer III
        val bitrateIdx = (b3 shr 4) and 0xF
        val srIdx = (b3 shr 2) and 3
        val padding = (b3 shr 1) and 1
        if (version == 1 || layer != 1 || bitrateIdx == 0 || bitrateIdx == 15 || srIdx == 3) { pos++; continue }
        val mpeg1 = version == 3
        val bitrate = (if (mpeg1) intArrayOf(0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0)
        else intArrayOf(0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0))[bitrateIdx] * 1000
        val sr = when (version) { 3 -> intArrayOf(44100, 48000, 32000); 2 -> intArrayOf(22050, 24000, 16000); else -> intArrayOf(11025, 12000, 8000) }[srIdx]
        val spf = if (mpeg1) 1152 else 576
        val frameLen = spf / 8 * bitrate / sr + padding
        if (first) {
            sampleRate = sr
            samplesPerFrame = spf
            first = false
            val mono = ((b4 shr 6) and 3) == 3
            val sideInfo = if (mpeg1) (if (mono) 17 else 32) else (if (mono) 9 else 17)
            val x = pos + 4 + sideInfo
            if (x + 8 <= end) {
                val tag = String(bytes, x, 4, Charsets.US_ASCII)
                if (tag == "Xing" || tag == "Info") {
                    val flags = int32(bytes, x + 4)
                    if ((flags and 1) != 0 && x + 12 <= end) {
                        val count = int32(bytes, x + 8).toLong()
                        // LAME 확장(인코더 문자열 9바이트 @+120, 지연·패딩 3바이트 @+141): 재생 길이 = 프레임 샘플 − 지연 − 패딩
                        // (ffprobe가 보고하는 길이와 같은 산식 — 이 파일들은 지연 576·패딩 970~1700 샘플).
                        var trim = 0L
                        if (x + 144 <= end && bytes.copyOfRange(x + 120, x + 124).all { it.toInt().toChar().isLetter() }) {
                            val d0 = bytes[x + 141].toInt() and 0xFF
                            val d1 = bytes[x + 142].toInt() and 0xFF
                            val d2 = bytes[x + 143].toInt() and 0xFF
                            val delay = (d0 shl 4) or (d1 shr 4)
                            val padding = ((d1 and 0xF) shl 8) or d2
                            trim = (delay + padding).toLong()
                        }
                        return (count * spf - trim).toDouble() / sr
                    }
                }
            }
        }
        frames++
        pos += frameLen
    }
    if (sampleRate == 0) return 0.0
    return frames * samplesPerFrame.toDouble() / sampleRate
}

private fun int32(b: ByteArray, at: Int): Int =
    ((b[at].toInt() and 0xFF) shl 24) or ((b[at + 1].toInt() and 0xFF) shl 16) or ((b[at + 2].toInt() and 0xFF) shl 8) or (b[at + 3].toInt() and 0xFF)
