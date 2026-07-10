#!/usr/bin/env python3
"""Build compact Web Audio sample sprites from the owner's six recording passes.

Requires Python 3, NumPy, ffmpeg and ffprobe. Source recordings stay in the ignored
test/ directory; generated AAC sprites and their cue manifest are publishable assets.
"""
from __future__ import annotations

import hashlib
import json
import math
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "scripts" / "handpan-recordings.json"
OUTPUT_DIR = ROOT / "audio" / "handpan"

DURATION = {"D": 2.8, "T": 1.5, "S": 1.2}
DEFAULT_DURATION = 1.8
GAP = 0.05
FADE_START = {"D": 1.45, "T": 0.72, "S": 0.48}
DEFAULT_FADE_START = 0.82
MAX_GAIN_DB = 18.0
REJECT_DELTA_DB = 6.0


def run(args: list[str]) -> None:
    subprocess.run(args, cwd=ROOT, check=True)


def read_right_channel(path: Path) -> tuple[int, np.ndarray]:
    with wave.open(str(path), "rb") as wav:
        sample_rate = wav.getframerate()
        channels = wav.getnchannels()
        width = wav.getsampwidth()
        frames = wav.getnframes()
        raw = wav.readframes(frames)
    if sample_rate != 48000 or channels != 2 or width not in (2, 3, 4):
        raise ValueError(f"unsupported source format: {path} ({sample_rate} Hz, {channels} ch, {width * 8} bit)")
    if width == 2:
        audio = np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768.0
    elif width == 4:
        audio = np.frombuffer(raw, dtype="<i4").astype(np.float64) / 2147483648.0
    else:
        b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
        values = b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8) | (b[:, 2].astype(np.int32) << 16)
        values = np.where(values & 0x800000, values - 0x1000000, values)
        audio = values.astype(np.float64) / 8388608.0
    return sample_rate, audio.reshape(-1, channels)[:, 1]


def segment_peak_db(audio: np.ndarray, sample_rate: int, onset: float) -> float:
    start = max(0, int((onset - 0.012) * sample_rate))
    end = min(len(audio), int((onset + 0.8) * sample_rate))
    peak = float(np.max(np.abs(audio[start:end])))
    return 20.0 * math.log10(max(peak, 1e-9))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as src:
        for chunk in iter(lambda: src.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    config = json.loads(CONFIG_PATH.read_text())
    order = config["order"]
    takes = config["takes"]
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    decoded: dict[str, tuple[int, np.ndarray]] = {}
    peaks: dict[str, dict[str, float]] = {}
    for take_id, take in takes.items():
        source = ROOT / take["file"]
        if not source.exists():
            raise FileNotFoundError(source)
        sample_rate, audio = read_right_channel(source)
        decoded[take_id] = (sample_rate, audio)
        peaks[take_id] = {
            key: segment_peak_db(audio, sample_rate, onset)
            for key, onset in zip(order, take["onsets"])
        }

    by_layer: dict[str, dict[str, str]] = {}
    for take_id, take in takes.items():
        by_layer.setdefault(take["layer"], {})[take["roundRobin"]] = take_id

    manifest: dict = {
        "version": 1,
        "sampleRate": 48000,
        "channels": 1,
        "gap": GAP,
        "layers": config["layers"],
        "sprites": [],
        "sourceHashes": {take_id: sha256(ROOT / take["file"]) for take_id, take in takes.items()},
    }

    with tempfile.TemporaryDirectory(prefix="handpan-samples-") as tmp_name:
        tmp = Path(tmp_name)
        for layer in ("soft", "medium", "strong"):
            target = float(config["layers"][layer]["targetPeakDb"])
            layer_takes = by_layer[layer]
            for rr in ("a", "b"):
                desired_id = layer_takes[rr]
                other_id = layer_takes["b" if rr == "a" else "a"]
                cue_files: list[Path] = []
                cues: dict[str, dict] = {}
                offset = 0.0

                for index, key in enumerate(order):
                    desired_peak = peaks[desired_id][key]
                    other_peak = peaks[other_id][key]
                    selected_id = other_id if other_peak - desired_peak > REJECT_DELTA_DB else desired_id
                    selected = takes[selected_id]
                    selected_peak = peaks[selected_id][key]
                    gain_db = max(-18.0, min(MAX_GAIN_DB, target - selected_peak))
                    duration = float(DURATION.get(key, DEFAULT_DURATION))
                    fade_start = float(FADE_START.get(key, DEFAULT_FADE_START))
                    slot = duration + GAP
                    onset = float(selected["onsets"][index])
                    source = ROOT / selected["file"]
                    cue_path = tmp / f"{layer}-{rr}-{index:02d}-{key}.wav"

                    filters = [
                        "pan=mono|c0=c1",
                        "highpass=f=30:p=2",
                    ]
                    if gain_db > 12.0:
                        filters.append("afftdn=nr=5:nf=-52:tn=1")
                    filters.extend([
                        f"volume={gain_db:.4f}dB",
                        "afade=t=in:st=0:d=0.008:curve=tri",
                        f"afade=t=out:st={fade_start:.4f}:d={duration - fade_start:.4f}:curve=qsin",
                        f"apad=pad_dur={GAP:.4f}",
                    ])
                    run([
                        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                        "-ss", f"{max(0.0, onset - 0.012):.6f}", "-t", f"{duration:.6f}",
                        "-i", str(source), "-af", ",".join(filters),
                        "-t", f"{slot:.6f}", "-ar", "48000", "-c:a", "pcm_s24le", str(cue_path),
                    ])
                    cue_files.append(cue_path)
                    cues[key] = {
                        "offset": round(offset, 5),
                        "duration": duration,
                        "fadeStart": fade_start,
                        "gainDb": round(gain_db, 3),
                        "sourceTake": selected_id,
                        "sourcePeakDb": round(selected_peak, 3),
                    }
                    offset += slot

                concat_file = tmp / f"{layer}-{rr}.txt"
                concat_file.write_text("".join(f"file '{path.as_posix()}'\n" for path in cue_files))
                filename = f"{layer}-{rr}.m4a"
                output = OUTPUT_DIR / filename
                run([
                    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                    "-f", "concat", "-safe", "0", "-i", str(concat_file),
                    "-ar", "48000", "-ac", "1", "-c:a", "aac", "-b:a", "128k",
                    "-movflags", "+faststart", str(output),
                ])
                manifest["sprites"].append({
                    "id": f"{layer}-{rr}",
                    "layer": layer,
                    "roundRobin": rr,
                    "url": f"./audio/handpan/{filename}",
                    "cues": cues,
                })

    manifest_path = OUTPUT_DIR / "samples.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    total = sum(path.stat().st_size for path in OUTPUT_DIR.glob("*.m4a"))
    print(f"Built {len(manifest['sprites'])} sprites, {total / 1024 / 1024:.2f} MiB encoded")
    for sprite in manifest["sprites"]:
        replacements = sum(cue["sourceTake"] != sprite["id"].replace("-", "_") for cue in sprite["cues"].values())
        print(f"  {sprite['id']}: {replacements} weak alternate hit(s) replaced")


if __name__ == "__main__":
    main()
