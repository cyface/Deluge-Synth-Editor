#!/usr/bin/env python3
"""Repoint the path references in a Deluge card's XML at what is actually on disk.

Usage:
    python3 tools/relink_card_paths.py VOLUME [options]

    VOLUME   path to the mounted SD card (e.g. /Volumes/DELUGE)

Songs and kits refer to presets and samples by path - presetFolder,
instrumentPresetFolder, path and fileName. Rename a folder on the card and
those references go stale. This walks SONGS, KITS and SYNTHS, resolves every
reference against the real directory entries, and rewrites it to the exact
on-disk spelling.

Two different problems get fixed by the same pass:

  casing drift   SAMPLES/ACOUSTIC -> SAMPLES/Acoustic
                 Harmless to the Deluge, which compares paths with strcasecmp
                 and resolves them through FatFs (case-insensitive both
                 layers), but it makes the XML disagree with the card.

  real renames   SYNTHS/FAMO -> SYNTHS/Famous
                 These genuinely break: the name no longer matches
                 case-insensitively, so the reference dangles. Give the
                 mapping with --rename, once per renamed component.

Components are matched case-insensitively level by level, so casing drift
needs no --rename at all. Only names that changed by more than case do.

Anything that still will not resolve is left untouched and listed, so a
pre-existing bad path is reported rather than silently rewritten to something
plausible.

Nothing is written without --apply; the default run prints the rewrites.

Examples:
    python3 tools/relink_card_paths.py /Volumes/DELUGE
    python3 tools/relink_card_paths.py /Volumes/DELUGE --rename FAMO=Famous --apply
    python3 tools/relink_card_paths.py /Volumes/DELUGE \\
        --rename FAMO=Famous --rename MUTEDIO="Muted IO" \\
        --backup ~/deluge-backup --apply

Note this only fixes references to presets that exist as files. A song can
also carry a preset inline - the whole <sound> is embedded and presetName
just names it - and those resolve inside the song, not against the card. They
are reported as unresolved here but are not broken; see the README.
"""
import argparse
import os
import re
import shutil
import sys

SCAN_DIRS = ("SONGS", "KITS", "SYNTHS")
TOP_LEVEL = ("SYNTHS/", "KITS/", "SAMPLES/", "SONGS/")
ATTRS = (b"fileName", b"instrumentPresetFolder", b"presetFolder", b"path")
REF = re.compile(rb'\b(' + b"|".join(ATTRS) + rb')="([^"]*)"')


class Resolver:
    """Maps a card-relative path onto its true on-disk spelling."""

    def __init__(self, volume, renames):
        self.volume = volume
        # Keyed case-folded: the whole point is that the reference's case is unreliable.
        self.renames = {k.lower(): v for k, v in renames.items()}
        self._listing = {}

    def _entries(self, directory):
        if directory not in self._listing:
            try:
                self._listing[directory] = {n.lower(): n for n in os.listdir(directory)}
            except OSError:
                self._listing[directory] = {}
        return self._listing[directory]

    def resolve(self, path):
        parts = [p for p in path.split("/") if p]
        out = []
        current = self.volume
        for part in parts:
            table = self._entries(current)
            real = table.get(part.lower())
            if real is None:
                mapped = self.renames.get(part.lower())
                if mapped is None or mapped.lower() not in table:
                    return None
                real = table[mapped.lower()]
            out.append(real)
            current = os.path.join(current, real)
        return "/".join(out)


def rewrite(data, resolver, rewrites, unresolved):
    """Return the file's new bytes, or None when nothing changed."""
    out = bytearray()
    pos = 0
    hits = 0
    for m in REF.finditer(data):
        value = m.group(2).decode("utf-8", "replace")
        if not value.upper().startswith(TOP_LEVEL):
            continue
        new = resolver.resolve(value)
        if new is None:
            unresolved[value] = unresolved.get(value, 0) + 1
            continue
        if new == value:
            continue
        out += data[pos:m.start()]
        out += m.group(1) + b'="' + new.encode("utf-8") + b'"'
        pos = m.end()
        hits += 1
        rewrites[(value, new)] = rewrites.get((value, new), 0) + 1
    if not hits:
        return None
    out += data[pos:]
    return bytes(out)


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("volume", help="path to the mounted SD card")
    ap.add_argument("--rename", action="append", default=[], metavar="OLD=NEW",
                    help="a folder that changed by more than case, e.g. "
                         "--rename FAMO=Famous (repeatable)")
    ap.add_argument("--apply", action="store_true",
                    help="write the changes (default: print them and exit)")
    ap.add_argument("--backup", metavar="DIR",
                    help="copy each file here, keeping its relative path, "
                         "before rewriting it")
    args = ap.parse_args()

    if not os.path.isdir(args.volume):
        sys.exit(f"error: no such volume: {args.volume}")

    renames = {}
    for item in args.rename:
        if "=" not in item:
            ap.error(f"--rename needs OLD=NEW, got '{item}'")
        old, new = item.split("=", 1)
        if not old or not new:
            ap.error(f"--rename needs OLD=NEW, got '{item}'")
        renames[old] = new

    resolver = Resolver(args.volume, renames)
    rewrites = {}
    unresolved = {}
    changed = []

    for top in SCAN_DIRS:
        root = os.path.join(args.volume, top)
        if not os.path.isdir(root):
            continue
        for dirpath, _, files in os.walk(root):
            for name in sorted(files):
                # ._ files are macOS AppleDouble sidecars, not Deluge data.
                if name.startswith("._") or not name.upper().endswith(".XML"):
                    continue
                path = os.path.join(dirpath, name)
                with open(path, "rb") as fh:
                    data = fh.read()
                new = rewrite(data, resolver, rewrites, unresolved)
                if new is not None:
                    changed.append((path, new))

    for (old, new), count in sorted(rewrites.items()):
        print(f"  x{count:<4} {old}\n         -> {new}")
    if not rewrites:
        print("  (no path rewrites needed)")

    if unresolved:
        print(f"\nunresolved, left unchanged - {len(unresolved)} distinct:")
        for value, count in sorted(unresolved.items()):
            print(f"  x{count:<4} {value}")

    total = sum(rewrites.values())
    if not args.apply:
        print(f"\n{total} references in {len(changed)} files. "
              f"Dry run - re-run with --apply.")
        return

    if changed and not args.backup:
        print("\nwarning: no --backup given; rewriting in place", file=sys.stderr)

    for path, data in changed:
        if args.backup:
            rel = os.path.relpath(path, args.volume)
            dest = os.path.join(args.backup, rel)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copy2(path, dest)
        with open(path, "wb") as fh:
            fh.write(data)

    print(f"\nRewrote {total} references in {len(changed)} files")
    if args.backup:
        print(f"Backups: {args.backup}")


if __name__ == "__main__":
    main()
