"""Generates the demo's soundtrack: a soft ambient pad, a gentle pluck arpeggio, and
cue sounds (Alexa chime, alert ping). Everything is synthesized here, so there are no
licensing questions. Usage: python3 music.py <seconds> <cues.json> <out.wav>"""
import json
import sys
import wave

import numpy as np

SR = 44100
dur = float(sys.argv[1])
cues = json.load(open(sys.argv[2]))
out = sys.argv[3]
n = int(SR * dur)
t = np.arange(n) / SR
mix = np.zeros((n, 2))


def note(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def env(length, attack, release):
    e = np.ones(length)
    a = min(int(attack * SR), length)
    r = min(int(release * SR), length - a)
    e[:a] = np.linspace(0, 1, a) ** 2
    if r > 0:
        e[length - r:] *= np.linspace(1, 0, r) ** 2
    return e


def add(start, sig, pan=0.0, gain=1.0):
    i = int(start * SR)
    if i >= n:
        return
    sig = sig[: n - i] * gain
    mix[i : i + len(sig), 0] += sig * (1 - pan) / 2 * 2 ** 0.5
    mix[i : i + len(sig), 1] += sig * (1 + pan) / 2 * 2 ** 0.5


# Chords (MIDI): Cmaj9, Am9, Fmaj9, Gsus/6, warm and unhurried.
chords = [
    [48, 55, 64, 67, 71, 74],
    [45, 52, 60, 64, 67, 71],
    [41, 48, 57, 60, 64, 67],
    [43, 50, 59, 62, 64, 69],
]
bar = 4 * 60 / 76  # 76 BPM, 4 beats per chord
k = 0
s = 0.0
while s < dur:
    ch = chords[k % 4]
    length = int((bar + 1.5) * SR)
    tt = np.arange(length) / SR
    pad = np.zeros(length)
    for j, m in enumerate(ch):
        f = note(m)
        detune = 1 + 0.0025 * np.sin(2 * np.pi * 0.13 * tt + j)
        pad += np.sin(2 * np.pi * f * detune * tt) * (0.6 if j == 0 else 0.35)
        pad += 0.12 * np.sin(2 * np.pi * 2 * f * tt + j)
    pad *= env(length, 1.2, 1.6) * (0.8 + 0.2 * np.sin(2 * np.pi * 0.25 * tt))
    add(s, pad, pan=0.0, gain=0.035)
    # Pluck arpeggio, eighth notes, from the upper chord tones.
    if s > 3.0:
        eighth = 60 / 76 / 2
        pattern = [2, 3, 4, 5, 4, 3, 4, 2]
        for b, idx in enumerate(pattern):
            m = ch[idx] + 12
            plen = int(1.2 * SR)
            pt = np.arange(plen) / SR
            pl = (np.sin(2 * np.pi * note(m) * pt) + 0.3 * np.sin(2 * np.pi * 2 * note(m) * pt)) * np.exp(-pt * 4.5)
            pl *= env(plen, 0.004, 0.2)
            add(s + b * eighth, pl, pan=0.35 if b % 2 else -0.35, gain=0.022)
    s += bar
    k += 1


def chime(at, notes, gain):
    for j, m in enumerate(notes):
        plen = int(1.6 * SR)
        pt = np.arange(plen) / SR
        f = note(m)
        c = (np.sin(2 * np.pi * f * pt) + 0.25 * np.sin(2 * np.pi * 3 * f * pt)) * np.exp(-pt * 3.2)
        add(at + j * 0.09, c * env(plen, 0.003, 0.3), gain=gain)


for c in cues:
    if c["type"] == "alexa":
        chime(c["t"], [76, 83], 0.07)  # soft rising two-note chime
    elif c["type"] == "alert":
        chime(c["t"], [81, 81, 77], 0.08)
    elif c["type"] == "whoosh":
        wl = int(0.7 * SR)
        noise = np.random.default_rng(1).standard_normal(wl)
        # crude band-pass by differencing a smoothed signal
        sm = np.convolve(noise, np.ones(40) / 40, mode="same")
        add(c["t"], sm * np.sin(np.linspace(0, np.pi, wl)) ** 2, gain=0.12)

# Fade in and out, then normalize gently.
fade = env(n, 1.5, 3.0)
mix *= fade[:, None]
mix /= max(1e-9, np.abs(mix).max()) / 0.7
data = (mix * 32767).astype(np.int16)
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(data.tobytes())
print(f"wrote {out} ({dur:.1f}s)")
