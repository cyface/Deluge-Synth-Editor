#!/usr/bin/env python3
"""Generate Deluge synth XML presets from the voices in a DX7 .syx bank.

Usage:
    python3 tools/syx_to_synth_xml.py SYXFILE [-o OUTDIR] [options]

    SYXFILE  a DX7 sysex file: a 32-voice bank (4104 bytes) or a single
             voice dump (163 bytes)
    OUTDIR   where the .XML files are written (default: alongside SYXFILE)

One preset is written per voice, named after the voice. The DX7 voice is
baked into the preset - the saved XML does not reference the .syx at all,
which is how the Deluge itself stores DX7 sounds.

Examples:
    python3 tools/syx_to_synth_xml.py "/Volumes/DELUGE/DX7/Finetales 1.syx" \
        -o "/Volumes/DELUGE/SYNTHS/DX7/Finetales 1"
    python3 tools/syx_to_synth_xml.py bank.syx --voice 11 --name "E Piano"
    python3 tools/syx_to_synth_xml.py bank.syx --engine-mode 1   # vintage MkI

A bank stores each voice packed into 128 bytes; the Deluge wants the 155-byte
unpacked VCED form plus a trailing operator-enable byte, hex-encoded into the
dx7patch attribute on <osc1> (Sound::readTagFromFile reads exactly 156 bytes).
The rest of the preset reproduces what the firmware's Sound::setupAsBlankSynth
builds for a DX7 synth - the CUSTOM 1 + SYNTH shortcut - so the voice is heard
through a neutral chain: osc2 muted, LPF wide open, ENV1 open (attack min,
sustain and release max) so the DX7's own operator envelopes shape the sound,
and no patch cables, since velocity goes to the DX7 engine rather than to
master volume.
"""
import argparse
import os
import re
import sys

VOICE_PACKED = 128     # bytes per voice inside a 32-voice bank
VOICE_UNPACKED = 155   # VCED parameters 0..154
DX7PATCH_LEN = 156     # what the Deluge reads: VCED + operator-enable byte
ALL_OPERATORS_ON = 0x3F

BANK_SIZE = 4104
SINGLE_SIZE = 163

# Illegal in FAT32 names; the Deluge shows the filename as the preset name.
ILLEGAL = re.compile(r'[/\\:*?"<>|]')


def unpack_voice(p):
    """Expand one 128-byte packed voice to its 155-byte VCED form.

    Bit-packed fields are split back out; bits above each field's width are
    undefined in the packed form and are masked off, which is what the DX7
    itself does when reading a cartridge.
    """
    u = bytearray(VOICE_UNPACKED)
    for op in range(6):
        po, uo = op * 17, op * 21
        u[uo:uo + 11] = bytes(b & 0x7F for b in p[po:po + 11])   # EG rates/levels, scaling
        curves = p[po + 11]
        u[uo + 11] = curves & 0x03                                # scale left curve
        u[uo + 12] = (curves >> 2) & 0x03                         # scale right curve
        detune_rs = p[po + 12]
        u[uo + 13] = detune_rs & 0x07                             # osc rate scale
        u[uo + 20] = (detune_rs >> 3) & 0x0F                      # osc detune
        sens = p[po + 13]
        u[uo + 14] = sens & 0x03                                  # amp mod sens
        u[uo + 15] = (sens >> 2) & 0x07                           # key velocity sens
        u[uo + 16] = p[po + 14]                                   # output level
        mode_coarse = p[po + 15]
        u[uo + 17] = mode_coarse & 0x01                           # osc mode
        u[uo + 18] = (mode_coarse >> 1) & 0x1F                    # freq coarse
        u[uo + 19] = p[po + 16]                                   # freq fine
    u[126:135] = bytes(b & 0x7F for b in p[102:111])              # pitch EG + algorithm
    fb_sync = p[111]
    u[135] = fb_sync & 0x07                                       # feedback
    u[136] = (fb_sync >> 3) & 0x01                                # osc key sync
    u[137:141] = p[112:116]                                       # LFO speed/delay/PMD/AMD
    lfo = p[116]
    u[141] = lfo & 0x01                                           # LFO key sync
    u[142] = (lfo >> 1) & 0x07                                    # LFO wave
    u[143] = (lfo >> 4) & 0x07                                    # pitch mod sens
    u[144] = p[117]                                               # transpose
    u[145:155] = p[118:128]                                       # name
    return bytes(u)


def read_voices(path):
    """Return [(name, 155-byte voice), ...] from a bank or single-voice dump."""
    with open(path, "rb") as f:
        data = f.read()

    if not data or data[0] != 0xF0 or data[-1] != 0xF7:
        raise ValueError(f"not a sysex file (no F0/F7 framing): {path}")
    if data[1] != 0x43:
        raise ValueError(f"not a Yamaha sysex file (manufacturer 0x{data[1]:02X}): {path}")

    if len(data) == BANK_SIZE and data[3] == 0x09:
        body = data[6:6 + 32 * VOICE_PACKED]
        voices = [unpack_voice(body[i * VOICE_PACKED:(i + 1) * VOICE_PACKED]) for i in range(32)]
    elif len(data) == SINGLE_SIZE and data[3] == 0x00:
        voices = [data[6:6 + VOICE_UNPACKED]]
    else:
        raise ValueError(
            f"unsupported sysex: {len(data)} bytes, format byte 0x{data[3]:02X} "
            f"(expected {BANK_SIZE}-byte bank or {SINGLE_SIZE}-byte single voice): {path}")

    return [(voice_name(v), v) for v in voices]


def voice_name(voice):
    """The 10-character name the DX7 stores at the end of the voice."""
    raw = bytes(b if 32 <= b < 127 else 0x20 for b in voice[145:155])
    return raw.decode("ascii").strip()


def safe_filename(name, fallback):
    name = ILLEGAL.sub("-", name).strip().rstrip(".")
    return name or fallback


def preset_xml(voice, engine_mode=0, random_detune=0):
    patch = (bytes(voice) + bytes([ALL_OPERATORS_ON]))[:DX7PATCH_LEN]
    if len(patch) != DX7PATCH_LEN:
        raise ValueError(f"voice is {len(voice)} bytes, need {VOICE_UNPACKED}")

    extra = ""
    if engine_mode:
        extra += f'\n\t\tdx7enginemode="{engine_mode}"'
    if random_detune:
        extra += f'\n\t\tdx7randomdetune="{random_detune}"'

    return TEMPLATE.format(dx7patch=patch.hex().upper(), extra=extra)


# Modelled on a DX7 preset saved by community firmware c1.2.0, with the signal
# chain reset to the firmware's own blank-DX-synth defaults (see module docstring).
TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<sound
\tfirmwareVersion="c1.2.0"
\tearliestCompatibleFirmware="4.1.0-alpha"
\tpolyphonic="poly"
\tvoicePriority="1"
\tmode="subtractive"
\tmodFXType="none"
\tlpfMode="24dB"
\thpfMode="HPLadder"
\tfilterRoute="H2L"
\tmaxVoices="8">
\t<osc1
\t\ttype="dx7"
\t\ttranspose="0"
\t\tcents="0"
\t\tretrigPhase="-1"
\t\tdx7patch="{dx7patch}"{extra} />
\t<osc2
\t\ttype="square"
\t\ttranspose="0"
\t\tcents="0"
\t\tretrigPhase="-1" />
\t<lfo1 type="triangle" syncLevel="0" syncType="0" />
\t<lfo2 type="triangle" syncLevel="0" syncType="0" />
\t<unison num="1" detune="8" spread="0" />
\t<defaultParams
\t\tarpeggiatorGate="0x00000000"
\t\tportamento="0x80000000"
\t\tcompressorShape="0xDC28F5B2"
\t\toscAVolume="0x7FFFFFFF"
\t\toscAPulseWidth="0x00000000"
\t\toscAWavetablePosition="0x00000000"
\t\toscBVolume="0x80000000"
\t\toscBPulseWidth="0x00000000"
\t\toscBWavetablePosition="0x00000000"
\t\tnoiseVolume="0x80000000"
\t\tvolume="0x6666663D"
\t\tpan="0x00000000"
\t\tlpfFrequency="0x7FFFFFFF"
\t\tlpfResonance="0x80000000"
\t\thpfFrequency="0x80000000"
\t\thpfResonance="0x80000000"
\t\tlfo1Rate="0x1999997E"
\t\tlfo2Rate="0x00000000"
\t\tmodulator1Amount="0x80000000"
\t\tmodulator1Feedback="0x80000000"
\t\tmodulator2Amount="0x80000000"
\t\tmodulator2Feedback="0x80000000"
\t\tcarrier1Feedback="0x80000000"
\t\tcarrier2Feedback="0x80000000"
\t\tmodFXRate="0x00000000"
\t\tmodFXDepth="0x00000000"
\t\tdelayRate="0x00000000"
\t\tdelayFeedback="0x80000000"
\t\treverbAmount="0x80000000"
\t\tarpeggiatorRate="0x00000000"
\t\tstutterRate="0x00000000"
\t\tsampleRateReduction="0x80000000"
\t\tbitCrush="0x80000000"
\t\tmodFXOffset="0x00000000"
\t\tmodFXFeedback="0x00000000"
\t\tcompressorThreshold="0x00000000"
\t\tlpfMorph="0x80000000"
\t\thpfMorph="0x80000000"
\t\twaveFold="0x80000000"
\t\tratchetProbability="0x80000000"
\t\tratchetAmount="0x80000000"
\t\tsequenceLength="0x80000000"
\t\trhythm="0x80000000">
\t\t<envelope1
\t\t\tattack="0x80000000"
\t\t\tdecay="0xE6666654"
\t\t\tsustain="0x7FFFFFFF"
\t\t\trelease="0x7FFFFFFF" />
\t\t<envelope2
\t\t\tattack="0xE6666654"
\t\t\tdecay="0xE6666654"
\t\t\tsustain="0xFFFFFFE9"
\t\t\trelease="0xE6666654" />
\t\t<patchCables />
\t\t<equalizer
\t\t\tbass="0x00000000"
\t\t\ttreble="0x00000000"
\t\t\tbassFrequency="0x00000000"
\t\t\ttrebleFrequency="0x00000000" />
\t</defaultParams>
\t<arpeggiator
\t\tmode="off"
\t\tnumOctaves="2"
\t\tsyncLevel="7"
\t\tsyncType="0"
\t\tarpMode="off"
\t\tnoteMode="up"
\t\toctaveMode="up"
\t\tmpeVelocity="off" />
\t<modKnobs>
\t\t<modKnob controlsParam="pan" />
\t\t<modKnob controlsParam="volumePostFX" />
\t\t<modKnob controlsParam="lpfResonance" />
\t\t<modKnob controlsParam="lpfFrequency" />
\t\t<modKnob controlsParam="env1Release" />
\t\t<modKnob controlsParam="env1Attack" />
\t\t<modKnob controlsParam="delayFeedback" />
\t\t<modKnob controlsParam="delayRate" />
\t\t<modKnob controlsParam="reverbAmount" />
\t\t<modKnob controlsParam="volumePostReverbSend" patchAmountFromSource="compressor" />
\t\t<modKnob controlsParam="pitch" patchAmountFromSource="lfo1" />
\t\t<modKnob controlsParam="lfo1Rate" />
\t\t<modKnob controlsParam="portamento" />
\t\t<modKnob controlsParam="stutterRate" />
\t\t<modKnob controlsParam="bitcrushAmount" />
\t\t<modKnob controlsParam="sampleRateReduction" />
\t</modKnobs>
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
</sound>
"""


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Generate Deluge synth XML presets from a DX7 .syx bank.")
    ap.add_argument("syx", help="DX7 sysex file (32-voice bank or single voice)")
    ap.add_argument("-o", "--out-dir", help="output directory (default: next to SYXFILE)")
    ap.add_argument("--voice", type=int, metavar="N",
                    help="only convert voice N (1-32) instead of the whole bank")
    ap.add_argument("--name", help="filename for the preset (only with --voice)")
    ap.add_argument("--prefix", default="", help="string prepended to every filename")
    ap.add_argument("--engine-mode", type=int, default=0, metavar="N",
                    help="DX engine: 0 modern (default), 1 vintage MkI")
    ap.add_argument("--random-detune", type=int, default=0, metavar="N",
                    help="per-voice random detune, 0-127 (default 0)")
    ap.add_argument("--list", action="store_true", help="list the voices and exit")
    ap.add_argument("-n", "--dry-run", action="store_true", help="report without writing")
    ap.add_argument("--force", action="store_true", help="overwrite existing files")
    args = ap.parse_args(argv)

    try:
        voices = read_voices(args.syx)
    except (OSError, ValueError) as e:
        sys.exit(f"error: {e}")

    if args.list:
        for i, (name, _) in enumerate(voices, 1):
            print(f"{i:2d}  {name}")
        return 0

    if args.voice is not None:
        if not 1 <= args.voice <= len(voices):
            sys.exit(f"error: --voice must be 1-{len(voices)}")
        voices = [voices[args.voice - 1]]
    elif args.name:
        sys.exit("error: --name only applies with --voice")

    out_dir = args.out_dir or os.path.dirname(os.path.abspath(args.syx))
    if not args.dry_run:
        os.makedirs(out_dir, exist_ok=True)

    used = set()
    written = skipped = 0
    for i, (name, voice) in enumerate(voices, 1):
        stem = args.prefix + safe_filename(args.name or name, f"VOICE {i}")
        candidate, n = stem, 1
        while candidate.upper() in used:          # FAT32 is case-insensitive
            n += 1
            candidate = f"{stem} {n}"
        used.add(candidate.upper())

        path = os.path.join(out_dir, candidate + ".XML")
        if os.path.exists(path) and not args.force:
            print(f"skip (exists): {path}")
            skipped += 1
            continue

        xml = preset_xml(voice, args.engine_mode, args.random_detune)
        if args.dry_run:
            print(f"would write: {path}")
        else:
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                f.write(xml)
            print(f"wrote: {path}")
        written += 1

    print(f"\n{written} preset(s){' (dry run)' if args.dry_run else ''}"
          f"{f', {skipped} skipped' if skipped else ''} -> {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
