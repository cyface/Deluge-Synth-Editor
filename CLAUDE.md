# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based synth preset editor for the Synthstrom Deluge. It edits Deluge synth preset XML files, either offline (load/download XML) or live over Web MIDI SysEx (browse/load/save files directly on the Deluge's SD card). Saving over SysEx requires community firmware c1.3.0+.

## Running and testing

There is no build system, package manager, bundler, linter, or test framework. The app is static HTML + vanilla JS: open `index.html` in Chrome or Edge (Web MIDI is needed for the SysEx features; XML editing works anywhere). There is nothing to compile.

The test that matters is the **round-trip test**, done manually: load a Deluge-authored preset XML, `generateXML()`, and diff every value against the source. The bar (already achieved, must stay true): zero values lost/changed/added, second save byte-identical to the first, and element/attribute order structurally identical to what the Deluge writes. Compare flattened path→value maps, not just tag/attribute names — name-only comparison has passed while values were being corrupted.

The `tools/` scripts are standalone Python 3, stdlib only (e.g. `python3 tools/make_kit.py /Volumes/DELUGE "SAMPLES/PACK/Some Kit"`). The card-mutating ones dry-run by default and only write with `--apply`; keep that convention.

## Architecture

Everything lives in `index.html` (~2400 lines: all markup and CSS) plus nine plain scripts in `js/` that share **global scope** — no modules, no imports. Script order in `index.html` is the dependency order and matters:

1. `parameters.js` — `defaultParams` (state as hex strings exactly as they appear in Deluge XML), value↔display conversions, `readInputValue()` clamping, and the `modKnobParams` / `modDestinations` lists
2. `sysex-core.js` — Web MIDI connection, smSysex protocol (sessions, msgIds, 7-bit packing, retry ladder), file read/write with `^write.size` check and full read-back verification
3. `xml-engine.js` — `parseXML` / `generateXML`, the `passThroughData` pass-through system, `syncUIToState()`, send/load flows
4. `file-browser.js` — preset/sample browsers over SysEx, save-path indicator, notifications
5. `ui-controls.js` — knobs, tabs, envelope animation, modulation matrix UI
6. `dx7.js` — DX7 .syx parsing, the built-in DX7 patch editor, 156-byte `dx7patch` handling
7. `midi-cc.js` — MIDI CC output for live parameter tweaking
8. `patchmorph.js` — patch randomizer (`MORPH_LIMITS` holds its safety caps)
9. `app.js` — init and glue

State flows: UI inputs → `readInputValue()` (clamps to declared min/max — the browser does NOT enforce these on `.value`) → state → `generateXML()`. On load, `parseXML` populates state and stashes everything it doesn't understand in `passThroughData`, which `generateXML` replays verbatim.

Parameters are 32-bit signed integers stored as hex (`0x7FFFFFFF`); both old-format (nested tags) and new-format (attribute) XML are parsed.

The Deluge firmware source is the ground truth for the XML format. Docs cite `SynthstromAudible/DelugeFirmware` branch `beta`; a local checkout lives at `~/WebstormProjects/DelugeFirmwareTW`.

## Read docs/decisions.md before "fixing" anything

`docs/decisions.md` records decisions that look like bugs but are deliberate, with firmware citations. Do not re-litigate them. The recurring failure mode across all of them: **the firmware accepts bad values without any error and silently does something else** — an unknown enum string resolves to the *last* table entry (writing `lpfMode="SVF"` turned the filter off), `<unison num="0">` loads fine and produces silence, an unresolvable `controlsParam` is dropped without complaint. Highlights:

- **Round-trip fidelity is a promise.** Write attributes unconditionally even when they hold the default (conditional writes have silently deleted `maxVoices`, `<unison spread>`, etc.). Preserve child element order (`<audioCompressor>`/`<stutter>` come last because the firmware writes them last). When moving a tag out of `passThroughData` into generated output, also add it to `SOUND_TAGS`/`ARP_ATTRIBUTES` or it gets written twice.
- **Enum strings must match the firmware's string tables character-for-character.** When adding any control backed by an enum, open the firmware table first (`filter_config.cpp`, `util/functions.cpp`, `param.cpp`); never guess from the UI label.
- `firmwareVersion="c1.3.0"` / `earliestCompatibleFirmware="4.1.0-alpha"` on `<sound>` are both correct and deliberately pinned — do not "fix" the mismatch or round-trip the loaded file's version.
- Never write `rangeAdjustable` on patch cables (it rewires the mod matrix, it is not a polarity flag); write `polarity` only when the loaded file had it.
- `modKnobParams` and `modDestinations` are different firmware namespaces — do not merge them. `<modKnobs>` is positional (exactly 16 entries); `parseXML` rejects wrong-length lists on purpose.
- `dx7patch` is exactly 156 hex bytes (155-byte VCED voice + operator-enable byte), with operators stored OP6-first (OP*n* → offset `(6-n)*21`, enable bit `6-n`). Do not "simplify" either.

`docs/deluge-sysex-reliability.md` is the diagnosis record behind the SysEx design: why writes are chunked at 512 bytes, retried on timeout, size-checked, and read back for verification. The verification steps are deliberately kept even though the firmware USB bug is fixed — on pre-fix firmware they turn silent corruption into a hard error.

## SysEx operational notes

- One connected editor tab at a time; multiple sessions can wedge the Deluge's write path (writes never answered while `dir`/`open` still work) — that state needs a power cycle, not more retries.
- A save that doesn't throw is byte-verified, so "saved fine but behaves wrong" points at generated values, not transport. Read the file back and look for out-of-range or misspelled-enum values first.
