#!/usr/bin/env python3
"""Rename the Deluge factory synth presets from SYNT### to their published names.

Usage:
    python3 tools/rename_factory_presets.py VOLUME [options]

    VOLUME   path to the mounted SD card (e.g. /Volumes/DELUGE)

The factory synth folder ships as SYNT000.XML ... SYNT170.XML, which tells you
nothing at the browser. This renames each file to the name printed in the
official "Synth Presets ver 2.1" chart, which covers entries 0-170.

Names are zero-padded with their chart number by default ("000 Rich Saw
Bass.XML"). The Deluge browser sorts alphabetically, so the prefix is what
keeps the chart's grouping - basses, then leads, then pads - intact. Pass
--no-prefix for bare names if you would rather browse alphabetically; note
that entries 106 and 168 are both "Hang Drum", so --no-prefix needs --force
to overwrite the first with the second.

Only the Name column is used. Artist credits from the chart are deliberately
left out of the file names.

Nothing is renamed without --apply; the default run just prints the mapping.

Examples:
    python3 tools/rename_factory_presets.py /Volumes/DELUGE
    python3 tools/rename_factory_presets.py /Volumes/DELUGE --apply
    python3 tools/rename_factory_presets.py /Volumes/DELUGE --dir SYNTHS/FACT --apply

A preset's name lives only in its file name - the XML holds no name field - so
this is a pure rename. Songs and kits, however, refer to presets by name via
presetName/presetFolder (and kit rows via name/path), and the firmware matches
those with strcasecmp against what is loaded, so renaming presets that a song
already uses will break those references. Run tools/relink_card_paths.py after
this, or rename before you build songs on the card.
"""
import argparse
import json
import os
import sys

# "Synth Presets ver 2.1", entries 0-170, Name column only.
# Slashes are illegal in file names, so the three "A / B / C" names use " - ".
NAMES = [
    "Rich Saw Bass", "Sync Bass", "Basic Square Bass", "Synthwave Bass",
    "Dubby Bass", "Sweet Mono Bass", "Vaporwave Bass", "Detuned Saw Bass",
    "FM Rich Distorted Bass", "Hoover Bass", "Gravel Basscamp", "Dubstep Bass",
    "Blunt Sync Bass", "Trap Bass 1", "Trap Bass 2", "Resonant Filter Bass",
    "Dark Saturated Bass", "Impact Saw Lead", "Rich Saw Lead", "Fizzy Strings",
    "Soft Saw Lead", "80's TV Lead", "Rich Filter LFO Lead", "Analog Mono Wow",
    "Warble Bass Pluck", "Soft Synth Organ", "PW Organ", "PW Envelope",
    "PWM", "Chiptune Trill", "Distant Porta", "Nasal Choir",
    "Bandpass Choir", "Rich Square", "Square Choir", "Bell Lead & Bass",
    "Analog Ambient Square", "Echo Chord", "Vapor Arp", "Detuned Retriggering Saws",
    "Spacer Leader", "Zithar - Vibed", "High Triangle", "Square Porta",
    "8-Bit Lead", "Square Sync", "Saw Sync", "Basic Dirty Bass",
    "Thin Pulse Bass", "Basic FM", "FM Basic Bass", "FM Rich Bass",
    "Soft Synth", "Detuned FM Horns 3", "Ghostly Sines 6", "FM Theremin 6",
    "FM Bell Modulation 10", "FM Lead", "FM Rising Attack", "Distorted Guitar Lead",
    "Bass Guitar", "Blown - Staccato - Panpipes", "Trumpet", "Tuba",
    "Reeds - Flute - Oboe", "Cello", "Violin", "Marimba",
    "FM Bells 1", "FM Bells 2", "Glockenspiel", "Rhodes",
    "Kyoto Phono", "Piano", "Electric Piano", "Electric Piano with Strings",
    "Organ", "FM Perc - Organ", "House 1", "Phased Arper",
    "House 2", "Xylophone Big Bass", "Short Sharp Delay", "Dark Chorus",
    "FM Narrow Band", "Deep Fizz", "Techno Organ", "Define Leader",
    "Yelp Chords", "Degraded Retro Lead", "FM Organ", "FM Ricochet",
    "Degraded Tremolo", "FM Distorted Bells", "Ambient Occlusion Lead",
    "Harsh FM Feedback", "FM Guitar Power Chord", "Saturated Filter",
    "Saturated Sync", "Overdrive Reese Sync",
    "Noise Lead", "Atebit", "Harsh 5th", "Sci-Fi Chaos",
    "Alien Vomit", "Attack Bass", "Hang Drum", "FM LPG Percussion",
    "Robo Arp", "Talking Arp", "Crystalline Ringmod", "Satellite Drum",
    "Hard Tech Beat", "Bio Lab", "Sootheerio", "Sounds Like After Take Off",
    "Evolving Frequencies", "Belledy", "Small Bridge Pad", "Stars Of The Bin Pad",
    "High Harsh Pad", "Tiny Lights", "Majestic Synth Orchestra", "Space Dust",
    "Filter Modulation Pad", "Evolving Pad", "Dark FM Pad", "Alien Larvae",
    "Lunar Landing", "Sci-fi Scenic", "Dark Strings", "Warm Strings",
    "Organ Strings", "80s Strings", "Melody Strings", "Soothing Growth Pad",
    "Synthwave Pad", "Epic Saw Modulation Pad", "Brassy Pad", "Detuned Saw Pad",
    "Slow Aural Swells", "Ringmod Pad", "Phaser", "Chillout Pad",
    "Sweep Chords", "Eerie High Pad", "Atmosphere Squares Pad", "Resonant Filter Pad",
    "Warm 5th Pad", "Cold 5th Pad", "Vaporwave Pad", "Radiant FM Pad",
    "Small Jet Pad", "FM Modulation Pad", "Rich FM Pad 1", "Rich FM Pad 2",
    "Rich FM Pad 3", "Rich FM Pad 4", "Tempo-Synced LFO", "80s Bass Rhythm",
    "Synthwave Bass Arp", "Synthwave Vibrato Arp", "Busy Arp", "Crisp Pop Arp",
    "Study Arp", "Acid Arp", "Harpsichord Cyborg", "FM Metallic Bass Arp",
    "Hang Drum", "Double Bass", "Sitar",
]


def build_pairs(preset_dir, use_prefix):
    """(source, destination) file name pairs, verified against what is on disk."""
    present = {f for f in os.listdir(preset_dir)
               if f.upper().endswith(".XML") and not f.startswith(".")}

    pairs = []
    missing = []
    for i, name in enumerate(NAMES):
        src = f"SYNT{i:03d}.XML"
        if src not in present:
            missing.append(src)
            continue
        dst = f"{i:03d} {name}.XML" if use_prefix else f"{name}.XML"
        pairs.append((src, dst))
    return pairs, missing


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("volume", help="path to the mounted SD card")
    ap.add_argument("--dir", default="SYNTHS/Factory",
                    help="factory preset folder relative to the volume "
                         "(default: SYNTHS/Factory; stock cards use SYNTHS/FACT)")
    ap.add_argument("--no-prefix", action="store_true",
                    help="drop the zero-padded chart number from the file name")
    ap.add_argument("--apply", action="store_true",
                    help="perform the renames (default: print them and exit)")
    ap.add_argument("--force", action="store_true",
                    help="allow a rename to overwrite an existing file")
    ap.add_argument("--manifest",
                    help="write the mapping to this JSON file, for undo")
    args = ap.parse_args()

    preset_dir = os.path.join(args.volume, args.dir)
    if not os.path.isdir(preset_dir):
        sys.exit(f"error: no such folder: {preset_dir}")

    pairs, missing = build_pairs(preset_dir, not args.no_prefix)
    if not pairs:
        sys.exit(f"error: no SYNT###.XML files in {preset_dir} "
                 f"(already renamed?)")

    # FAT is case-insensitive, so compare destinations case-folded.
    seen = {}
    clashes = []
    for src, dst in pairs:
        key = dst.lower()
        if key in seen:
            clashes.append((seen[key], src, dst))
        seen[key] = src
    if clashes and not args.force:
        for first, second, dst in clashes:
            print(f"clash: {first} and {second} both -> {dst}", file=sys.stderr)
        sys.exit("error: duplicate destination names (use --force to allow "
                 "later files to win, or drop --no-prefix)")

    for src, dst in pairs:
        print(f"{src}  ->  {dst}")
    if missing:
        print(f"\n{len(missing)} chart entries not on the card: "
              f"{', '.join(missing[:5])}{'...' if len(missing) > 5 else ''}")

    if not args.apply:
        print(f"\n{len(pairs)} files. Dry run - re-run with --apply.")
        return

    if args.manifest:
        with open(args.manifest, "w", encoding="utf-8") as fh:
            json.dump(pairs, fh, indent=1)

    renamed = 0
    for src, dst in pairs:
        dst_path = os.path.join(preset_dir, dst)
        if os.path.exists(dst_path) and src.lower() != dst.lower() and not args.force:
            print(f"skip (exists): {dst}", file=sys.stderr)
            continue
        os.rename(os.path.join(preset_dir, src), dst_path)
        renamed += 1

    print(f"\nRenamed {renamed} presets in {preset_dir}")
    if args.manifest:
        print(f"Manifest: {args.manifest}")


if __name__ == "__main__":
    main()
