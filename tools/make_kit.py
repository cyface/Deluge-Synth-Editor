#!/usr/bin/env python3
"""Generate Deluge kit XML files from folders of WAV samples on the SD card.

Usage:
    python3 tools/make_kit.py VOLUME FOLDER [FOLDER ...] [options]

    VOLUME   path to the mounted SD card (e.g. /Volumes/DELUGE)
    FOLDER   sample folder relative to VOLUME (e.g. "SAMPLES/AUDIOPILZ/Massive-X")

One kit file is written per folder, containing one sample row per top-level
.wav in that folder (subfolders and macOS ._ sidecar files are skipped).
Rows are ordered kick → snare → clap → hats → cymbals → perc → rest, so
kicks land on the bottom pad row like the factory kits.

Examples:
    python3 tools/make_kit.py /Volumes/DELUGE "SAMPLES/AUDIOPILZ/Dreadbox Erebus"
    python3 tools/make_kit.py /Volumes/DELUGE "SAMPLES/AUDIOPILZ/Massive-X/DnB Kit" \
        --name "Massive-X DnB" --out-dir KITS/AUDIOPILZ

The XML is modeled on a kit saved by community firmware c1.3.0: same header
attribute pair, kit-level blocks, and write order as the firmware's own
Kit::writeDataToFile (see issue #1). Rows carry only what the firmware needs;
omitted tags (arpeggiator, modKnobs, per-row FX) get firmware defaults on
load. Each row's zone end is the sample's exact frame count, read from the
WAV data chunk. Rows use loopMode ONCE like the factory drum kits, so a short
sequencer note plays the whole hit.
"""
import argparse
import os
import re
import struct
import sys


def wav_frames(path):
    """Number of sample frames in a WAV (data chunk size / block align)."""
    with open(path, "rb") as f:
        riff = f.read(12)
        if len(riff) < 12 or riff[:4] != b"RIFF" or riff[8:12] != b"WAVE":
            raise ValueError(f"not a RIFF WAVE: {path}")
        block_align = None
        data_size = None
        while True:
            hdr = f.read(8)
            if len(hdr) < 8:
                break
            cid, size = hdr[:4], struct.unpack("<I", hdr[4:])[0]
            if cid == b"fmt ":
                fmt = f.read(size)
                block_align = struct.unpack("<H", fmt[12:14])[0]
            else:
                if cid == b"data":
                    data_size = size
                f.seek(size + (size & 1), 1)
            if block_align and data_size is not None:
                break
        if not block_align or data_size is None:
            raise ValueError(f"missing fmt/data chunk: {path}")
        return data_size // block_align


CATEGORY_ORDER = [
    ("kick", re.compile(r"kick|boom|(?:^|\s)k\d*$|^k\d", re.I)),
    ("snare", re.compile(r"\bsn\d*\b|snare|^sn\d", re.I)),
    ("clap", re.compile(r"clap", re.I)),
    ("hat", re.compile(r"hh|hat", re.I)),
    ("cym", re.compile(r"cym", re.I)),
    ("perc", re.compile(r"perc|stick", re.I)),
]


def category(name):
    for i, (_, rx) in enumerate(CATEGORY_ORDER):
        if rx.search(name):
            return i
    return len(CATEGORY_ORDER)


def xml_escape(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;"))


SOUND_TEMPLATE = """\t\t<sound
\t\t\tname="{name}"
\t\t\tpolyphonic="auto"
\t\t\tvoicePriority="1"
\t\t\tmode="subtractive"
\t\t\tmodFXType="none"
\t\t\tlpfMode="24dB"
\t\t\thpfMode="HPLadder"
\t\t\tfilterRoute="H2L"
\t\t\tpath=""
\t\t\tmaxVoices="8">
\t\t\t<osc1
\t\t\t\ttype="sample"
\t\t\t\tloopMode="1"
\t\t\t\treversed="0"
\t\t\t\ttimeStretchEnable="0"
\t\t\t\ttimeStretchAmount="0"
\t\t\t\tfileName="{fileName}">
\t\t\t\t<zone
\t\t\t\t\tstartSamplePos="0"
\t\t\t\t\tendSamplePos="{endSamplePos}" />
\t\t\t</osc1>
\t\t\t<osc2
\t\t\t\ttype="sample"
\t\t\t\tloopMode="0"
\t\t\t\treversed="0"
\t\t\t\ttimeStretchEnable="0"
\t\t\t\ttimeStretchAmount="0">
\t\t\t</osc2>
\t\t\t<lfo1 type="triangle" syncLevel="0" syncType="0" />
\t\t\t<lfo2 type="triangle" syncLevel="0" syncType="0" />
\t\t\t<lfo3 type="triangle" syncLevel="0" syncType="0" />
\t\t\t<lfo4 type="triangle" syncLevel="0" syncType="0" />
\t\t\t<unison num="1" detune="8" spread="0" />
\t\t\t<defaultParams
\t\t\t\tportamento="0x80000000"
\t\t\t\tcompressorShape="0xDC28F5B2"
\t\t\t\toscAVolume="0x7FFFFFFF"
\t\t\t\toscAPulseWidth="0x00000000"
\t\t\t\toscAWavetablePosition="0x00000000"
\t\t\t\toscBVolume="0x80000000"
\t\t\t\toscBPulseWidth="0x00000000"
\t\t\t\toscBWavetablePosition="0x00000000"
\t\t\t\tnoiseVolume="0x80000000"
\t\t\t\tvolume="0x4CCCCCA8"
\t\t\t\tpan="0x00000000"
\t\t\t\tlpfFrequency="0x7FFFFFFF"
\t\t\t\tlpfResonance="0x80000000"
\t\t\t\thpfFrequency="0x80000000"
\t\t\t\thpfResonance="0x80000000"
\t\t\t\tlfo1Rate="0x1999997E"
\t\t\t\tlfo2Rate="0x00000000"
\t\t\t\tlfo3Rate="0x1999997E"
\t\t\t\tlfo4Rate="0x00000000"
\t\t\t\tmodulator1Amount="0x80000000"
\t\t\t\tmodulator1Feedback="0x80000000"
\t\t\t\tmodulator2Amount="0x80000000"
\t\t\t\tmodulator2Feedback="0x80000000"
\t\t\t\tcarrier1Feedback="0x80000000"
\t\t\t\tcarrier2Feedback="0x80000000"
\t\t\t\tmodFXRate="0x00000000"
\t\t\t\tmodFXDepth="0x00000000"
\t\t\t\tdelayRate="0x00000000"
\t\t\t\tdelayFeedback="0x80000000"
\t\t\t\treverbAmount="0x80000000"
\t\t\t\tarpeggiatorRate="0x00000000"
\t\t\t\tstutterRate="0x00000000"
\t\t\t\tsampleRateReduction="0x80000000"
\t\t\t\tbitCrush="0x80000000"
\t\t\t\tmodFXOffset="0x00000000"
\t\t\t\tmodFXFeedback="0x00000000"
\t\t\t\tcompressorThreshold="0x00000000"
\t\t\t\tarpeggiatorGate="0x00000000"
\t\t\t\tnoteProbability="0x7FFFFFFF"
\t\t\t\tbassProbability="0x80000000"
\t\t\t\tswapProbability="0x80000000"
\t\t\t\tglideProbability="0x80000000"
\t\t\t\treverseProbability="0x80000000"
\t\t\t\tchordProbability="0x80000000"
\t\t\t\tratchetProbability="0x80000000"
\t\t\t\tratchetAmount="0x80000000"
\t\t\t\tsequenceLength="0x80000000"
\t\t\t\tchordPolyphony="0x80000000"
\t\t\t\trhythm="0x80000000"
\t\t\t\tspreadVelocity="0x80000000"
\t\t\t\tspreadGate="0x80000000"
\t\t\t\tspreadOctave="0x80000000"
\t\t\t\tlpfMorph="0x80000000"
\t\t\t\thpfMorph="0x80000000"
\t\t\t\twaveFold="0x80000000">
\t\t\t\t<envelope1
\t\t\t\t\tattack="0x80000000"
\t\t\t\t\tdecay="0xE6666654"
\t\t\t\t\tsustain="0x7FFFFFD2"
\t\t\t\t\trelease="0x80000000" />
\t\t\t\t<envelope2
\t\t\t\t\tattack="0xE6666654"
\t\t\t\t\tdecay="0xE6666654"
\t\t\t\t\tsustain="0xFFFFFFE9"
\t\t\t\t\trelease="0xE6666654" />
\t\t\t\t<envelope3
\t\t\t\t\tattack="0x00000000"
\t\t\t\t\tdecay="0x00000000"
\t\t\t\t\tsustain="0x00000000"
\t\t\t\t\trelease="0x00000000" />
\t\t\t\t<envelope4
\t\t\t\t\tattack="0x00000000"
\t\t\t\t\tdecay="0x00000000"
\t\t\t\t\tsustain="0x00000000"
\t\t\t\t\trelease="0x00000000" />
\t\t\t\t<patchCables>
\t\t\t\t\t<patchCable
\t\t\t\t\t\tsource="velocity"
\t\t\t\t\t\tdestination="volume"
\t\t\t\t\t\tpolarity="bipolar"
\t\t\t\t\t\tamount="0x3FFFFFE8" />
\t\t\t\t\t<patchCable
\t\t\t\t\t\tsource="aftertouch"
\t\t\t\t\t\tdestination="volume"
\t\t\t\t\t\tpolarity="unipolar"
\t\t\t\t\t\tamount="0x2A3D7094" />
\t\t\t\t\t<patchCable
\t\t\t\t\t\tsource="y"
\t\t\t\t\t\tdestination="lpfFrequency"
\t\t\t\t\t\tpolarity="bipolar"
\t\t\t\t\t\tamount="0x19999990" />
\t\t\t\t</patchCables>
\t\t\t\t<equalizer
\t\t\t\t\tbass="0x00000000"
\t\t\t\t\ttreble="0x00000000"
\t\t\t\t\tbassFrequency="0x00000000"
\t\t\t\t\ttrebleFrequency="0x00000000" />
\t\t\t</defaultParams>
\t\t</sound>
"""

KIT_HEADER = """<?xml version="1.0" encoding="UTF-8"?>
<kit
\tfirmwareVersion="c1.3.0"
\tearliestCompatibleFirmware="4.1.0-alpha"
\tmodFXCurrentParam="feedback"
\tcurrentFilterType="lpf"
\tmodFXType="flanger"
\tlpfMode="24dB"
\thpfMode="HPLadder"
\tfilterRoute="H2L">
\t<defaultParams
\t\treverbAmount="0x80000000"
\t\tvolume="0x3504F334"
\t\tpan="0x00000000"
\t\tsidechainCompressorShape="0xDC28F5B2"
\t\tmodFXDepth="0x00000000"
\t\tmodFXRate="0xE0000000"
\t\tstutterRate="0x00000000"
\t\tsampleRateReduction="0x80000000"
\t\tbitCrush="0x80000000"
\t\tmodFXOffset="0x00000000"
\t\tmodFXFeedback="0x80000000"
\t\tcompressorThreshold="0x00000000"
\t\tarpeggiatorGate="0x7FFFFFFF"
\t\tnoteProbability="0x7FFFFFFF"
\t\tbassProbability="0x80000000"
\t\tswapProbability="0x80000000"
\t\tglideProbability="0x80000000"
\t\treverseProbability="0x80000000"
\t\tchordProbability="0x80000000"
\t\tratchetProbability="0x80000000"
\t\tratchetAmount="0x80000000"
\t\tsequenceLength="0x80000000"
\t\tchordPolyphony="0x80000000"
\t\trhythm="0x80000000"
\t\tspreadVelocity="0x80000000"
\t\tspreadGate="0x80000000"
\t\tspreadOctave="0x80000000"
\t\tlpfMorph="0x80000000"
\t\thpfMorph="0x80000000"
\t\ttempo="0x00000000"
\t\tarpeggiatorRate="0x00000000">
\t\t<delay
\t\t\trate="0x00000000"
\t\t\tfeedback="0x80000000" />
\t\t<lpf
\t\t\tfrequency="0x7FFFFFFF"
\t\t\tresonance="0x80000000" />
\t\t<hpf
\t\t\tfrequency="0x80000000"
\t\t\tresonance="0x80000000" />
\t\t<equalizer
\t\t\tbass="0x00000000"
\t\t\ttreble="0x00000000"
\t\t\tbassFrequency="0x00000000"
\t\t\ttrebleFrequency="0x00000000" />
\t</defaultParams>
\t<delay
\t\tpingPong="1"
\t\tanalog="0"
\t\tsyncLevel="7"
\t\tsyncType="0" />
\t<sidechain
\t\tattack="327244"
\t\trelease="936"
\t\tsyncLevel="6"
\t\tsyncType="0" />
\t<audioCompressor
\t\tattack="83886080"
\t\trelease="83886080"
\t\tthresh="0"
\t\tratio="1073741824"
\t\tcompHPF="0"
\t\tcompBlend="2147483647" />
\t<stutter
\t\tquantized="1"
\t\treverse="0"
\t\tpingPong="0" />
\t<soundSources>
"""

KIT_FOOTER = """\t</soundSources>
</kit>"""


def default_out_dir(rel_dir):
    """SAMPLES/<PACK>/... -> KITS/<PACK>; anything else needs --out-dir."""
    parts = rel_dir.split("/")
    if len(parts) >= 2 and parts[0].upper() == "SAMPLES":
        return f"KITS/{parts[1]}"
    return None


def build_kit(volume, rel_dir, out_dir, kit_name, force):
    abs_dir = os.path.join(volume, rel_dir)
    if not os.path.isdir(abs_dir):
        sys.exit(f"error: no such folder: {abs_dir}")
    wavs = [f for f in os.listdir(abs_dir)
            if f.lower().endswith(".wav") and not f.startswith("._")]
    if not wavs:
        sys.exit(f"error: no .wav files in {abs_dir}")
    wavs.sort(key=lambda f: (category(os.path.splitext(f)[0]), f.lower()))

    sounds = []
    for f in wavs:
        frames = wav_frames(os.path.join(abs_dir, f))
        sounds.append(SOUND_TEMPLATE.format(
            name=xml_escape(os.path.splitext(f)[0].strip()),
            fileName=xml_escape(f"{rel_dir}/{f}"),
            endSamplePos=frames,
        ))

    out_path = os.path.join(volume, out_dir, f"{kit_name}.XML")
    if os.path.exists(out_path) and not force:
        sys.exit(f"error: {out_path} exists (use --force to overwrite)")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(KIT_HEADER + "".join(sounds) + KIT_FOOTER)
    print(f"{out_path}: {len(sounds)} rows")
    for f in wavs:
        print(f"    {f}")


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("volume", help="path to the mounted SD card")
    ap.add_argument("folders", nargs="+",
                    help="sample folder(s) relative to the volume")
    ap.add_argument("--out-dir", help="output folder relative to the volume "
                    "(default: KITS/<pack> for SAMPLES/<pack>/... folders)")
    ap.add_argument("--name", help="kit file name without .XML "
                    "(single folder only; default: folder name)")
    ap.add_argument("--force", action="store_true",
                    help="overwrite an existing kit file")
    args = ap.parse_args()

    if args.name and len(args.folders) > 1:
        ap.error("--name only makes sense with a single folder")

    for rel_dir in args.folders:
        rel_dir = rel_dir.strip("/").replace("\\", "/")
        out_dir = args.out_dir or default_out_dir(rel_dir)
        if not out_dir:
            ap.error(f"can't derive a KITS folder from '{rel_dir}'; use --out-dir")
        kit_name = args.name or os.path.basename(rel_dir)
        build_kit(args.volume, rel_dir, out_dir, kit_name, args.force)


if __name__ == "__main__":
    main()
