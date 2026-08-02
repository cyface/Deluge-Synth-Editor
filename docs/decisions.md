# Decisions

Things that look wrong at a glance but are deliberate, and things we got wrong
once already. The point of this file is to stop the same questions being
re-litigated. Each entry says what the decision is, why, and what evidence
would change it.

Firmware citations are against `SynthstromAudible/DelugeFirmware` branch `beta`.

---

## The version attributes on `<sound>` are correct as written

```xml
<sound
    firmwareVersion="c1.3.0"
    earliestCompatibleFirmware="4.1.0-alpha"
```

**Decision: leave both alone. Do not "fix" the mismatch, and do not preserve
`firmwareVersion` from a loaded file.**

This pairing looks wrong because the two values use different version schemes -
one community, one official, three major versions apart. It is not wrong. The
Deluge writes this exact pair itself for every synth and kit preset, with the
old-scheme string hardcoded (`src/deluge/model/output.cpp:233-234`, and again
in `src/deluge/processing/sound/sound_drum.cpp:122-123`):

```cpp
writer.writeFirmwareVersion();
writer.writeEarliestCompatibleFirmwareVersion("4.1.0-alpha");
```

They look similar but do unrelated jobs:

- **`earliestCompatibleFirmware` is a gate.** `Deserializer.cpp:877` refuses the
  file when `earliestFirmware > FirmwareVersion::current()`. Pinning it low
  means "anything from 4.1.0-alpha onwards can read this", which is what we
  want. Raising it would only lock out firmware that can read our files fine.
- **`firmwareVersion` selects backward-compatibility fixups.** It is compared
  against thresholds throughout the reader: resonance compensation below
  official 1.2.0 (`sound.cpp:3245`), filter modes cleared on FM patches below
  community 1.2.0 (`sound.cpp:3238`), default expression patching below official
  4.0.0-beta (`sound.cpp:263`).

That second point is why round-tripping the loaded file's value would be a bug,
not an improvement. We write parameters in modern format. Echoing back an old
version from a file someone saved years ago would make the firmware apply those
legacy fixups to values that do not need them - silently rescaling resonance, or
wiping filter modes on an FM patch. Declaring a current version is the safe
behaviour precisely because it opts out of all of them.

`c1.3.0` is a literal in `xml-engine.js`. It is pinned deliberately, not an
oversight, and it does not need to track the firmware you happen to run: every
fixup threshold in the reader sits at or below c1.2.0, so any current-ish value
behaves identically.

**What would change this:** a future firmware adding a fixup threshold *above*
c1.3.0, which would start applying conversions to our files. Check
`song_firmware_version` comparisons in the reader before assuming the pin is
still safe.

---

## Number inputs are clamped on read, not trusted

`readInputValue()` in `parameters.js` clamps every `input[type=number]` to the
`min`/`max` it declares, and writes the correction back to the element. It is
called from both places that copy UI state: `syncUIToState()` in
`xml-engine.js` and the change listener in `app.js`.

This is not belt-and-braces over the HTML attributes. **The browser does not
enforce `min`/`max` on `.value`.** They constrain the spinner arrows and
constraint validation on form submission, and nothing in this app submits a
form - so a typed-in out-of-range value sits in `.value` untouched and goes
straight to the card.

The bug that produced this: a kick preset saved and loaded without error and
made no sound. The file was completely intact - all 40 `defaultParams` present,
`oscAVolume` and `volume` both at max, LPF open, normal envelope - but it
contained

```xml
<unison num="0" detune="0" />
```

against an input declaring `min="1" max="8"`. `num` is the unison voice count,
and the Deluge renders a voice by looping over its unison sub-voices, so at zero
there is nothing to render. Silence, no error, nothing in the file to suggest
anything was wrong.

This was a whole class of bug rather than one field - every number input in the
editor could write an out-of-range value. Clamping at the two read sites covers
all of them, including inputs added later.

**Corollary for diagnosis:** since
[the SysEx work](deluge-sysex-reliability.md), a save that does not throw is
byte-for-byte verified against what was generated. So "saved fine, behaves
wrong" now points at the *generated values*, not at the transport. Read the file
back and look for values outside their documented range before suspecting
corruption.

---

## `rangeAdjustable` on `<patchCable>` is not a polarity flag

**Decision: never write `rangeAdjustable` unless the loaded file already had it.
Write `polarity` instead - and only when the source file specified it.**

The editor used to stamp `rangeAdjustable="1"` on every patch cable it wrote,
with a comment reading `// Bipolar (-50 to +50)`. That is a misreading of the
format, and an actively damaging one.

From `src/deluge/modulation/patch/patch_cable_set.cpp`:

```cpp
else if (!strcmp(tagName, "rangeAdjustable")) { // Files before V3.2 had this
...
if (rangeAdjustable) { rangeAdjustableCableS = source; rangeAdjustableCableP = ...; }
...
patchCables[c].destinationParamDescriptor.setToHaveParamAndSource(rangeAdjustableCableP,
                                                                  rangeAdjustableCableS);
```

It is a legacy pre-V3.2 attribute, and it does not describe polarity at all -
it marks a cable as a *range-adjusting* cable, causing the firmware to re-point
its destination so it modulates **another cable's depth** instead of the
parameter named in `destination`. Setting it on every cable silently rewires
the whole modulation matrix.

The current attribute is `polarity`, with values `bipolar` / `unipolar`
(same file, the `"polarity"` branch). We deliberately do **not** write it for
new cables: the firmware defaults polarity per modulation source, and with no
UI to choose, its default is better than ours. We preserve it when a loaded
file specifies it.

**What would change this:** nothing likely. If UI for polarity is ever added,
write `polarity` - never `rangeAdjustable`.

---

## Round-trip fidelity is a tested property, not an aspiration

`parseXML` captures everything it does not understand into `passThroughData`
(unknown `<sound>` attributes and child elements, `<defaultParams>` extras,
osc sub-tags, per-cable extras) and `generateXML` replays it. The README
promises no data loss, so that promise needs to stay true.

Two subtleties that caused real losses and will again if someone "tidies up":

- **Do not skip writing an attribute just because it holds the default value.**
  `maxVoices`, `<lfo2>`'s `syncLevel`/`syncType`, `<unison spread>`, and
  `<sidechain>` were each written conditionally, so re-saving a Deluge preset
  quietly deleted them. The Deluge writes them unconditionally; match it.
- **Element presence is not enough - compare values.** A check that only
  compared tag and attribute *names* passed while `polarity` was being replaced
  by `rangeAdjustable` on all six cables. Compare the full flattened
  path→value map of source against output.

The test that matters: load a Deluge-authored preset, `generateXML()`, and
diff every value. Current status against `Tim.XML` (5875 bytes, 204 values):
zero lost, zero changed, zero added, and a second pass is byte-identical to the
first. A brand new preset stays clean - no pass-through leakage.

As controls get added, pass-through shrinks. `<audioCompressor>`, `<stutter>`,
`<modKnobs>` and most of `<arpeggiator>` are now generated rather than replayed,
so anything moved out of `passThroughData` must also be added to `SOUND_TAGS`
(or `ARP_ATTRIBUTES`) - otherwise it gets written twice, once from state and
once from the replay buffer.

Verified against `TIM KICK1.XML` pulled off the card over SysEx (5343 bytes,
183 values): zero lost, zero changed, zero added, second pass byte-identical,
and the output is structurally identical to the source - same elements in the
same order, same attributes with the same values. The 54-byte size difference
is whitespace only.

Child element order is worth preserving even though the reader does not care
(it is a tag loop). `<audioCompressor>` and `<stutter>` come *last*, after
`<midiOutput>`, because `ModControllableAudio::writeTagsToFile` runs at the end
of `Sound::writeToFile` (`sound.cpp:4264`). Writing them next to `<sidechain>`
where they logically belong produced a valid file that diffed noisily against
anything the Deluge wrote.

---

## Enum attributes must use the firmware's exact strings

**Decision: every `<option value>` that lands in the XML has to match the
firmware's string table character-for-character. Check the table, don't guess
from the label.**

The Deluge does not reject an unrecognised enum string. `EnumStringMap`'s
lookup (`util/container/enum_to_string_map.hpp:30-41`) falls through to
`static_cast<Enum>(N - 1)` - **the last entry** - and carries on. There is no
error, and the file still loads.

Three options in the filter section were wrong, all silently:

| Wrote | Valid strings | Resolved to |
|---|---|---|
| `lpfMode="SVF"` | `12dB` `24dB` `24dBDrive` `SVF_Band` `SVF_Notch` `HPLadder` `Off` | `Off` - low pass filter disabled |
| `filterRoute="HPF2LPF"` | `L2H` `PARA` `H2L` | `H2L` |
| `filterRoute="LPF2HPF"` | as above | `H2L` - the opposite routing |
| `filterRoute="PARALLEL"` | as above | `H2L` - not parallel at all |

Picking "SVF" for the LPF turned the filter off. Picking "Parallel" or
"LPF to HPF" did nothing at all. The tables are in
`model/mod_controllable/filters/filter_config.cpp:8-20` for filters,
`util/functions.cpp:1104-1244` for the arpeggiator modes and patch sources, and
`modulation/params/param.cpp:418-747` for `<modKnob controlsParam>`.

This is the same failure mode as [`rangeAdjustable`](#rangeadjustable-on-patchcable-is-not-a-polarity-flag)
and the `<unison num="0">` silence: a value the firmware accepts without
complaint and then interprets as something the user did not ask for.

**What would change this:** nothing. When adding a control backed by an enum,
open the firmware's string table first.

---

## `controlsParam` is a different namespace from patch cable destinations

`<modKnob controlsParam="...">` resolves through
`fileStringToParam(Kind::UNPATCHED_SOUND, name, allowPatched=true)`, which
reaches patched local params, patched global params **and** the shared unpatched
set. `<patchCable destination="...">` reaches only the patched ones.

So `volumePostFX`, `bitcrushAmount`, `portamento` and `compressorThreshold` are
valid gold knob targets but not patch destinations, and `volume` resolves to a
different param in each list. `modKnobParams` and `modDestinations` in
`parameters.js` are deliberately separate lists for this reason - do not merge
them. A name that does not resolve comes back as `GLOBAL_NONE` and the
assignment is dropped on load, without an error.

`<modKnobs>` is also **positional**: 8 mod-button pages x 2 knobs, flattened in
order, bottom knob first. Nothing in an entry says which knob it belongs to. A
list that is not exactly 16 long would bind every assignment after the gap to
the wrong knob, so `parseXML` rejects a short or long list outright and falls
back to the firmware defaults rather than guessing.

---

## Per-sound stutter settings are written but never take effect

`<stutter quantized reverse pingPong>` round-trips correctly and the editor
exposes it, but be honest about what it does on the hardware.

`StutterConfig` has a fourth field, `useSongStutter`, which decides whether the
sound's own settings are used at all:

```cpp
stutterer.beginStutter(..., stutterConfig.useSongStutter
    ? currentSong->globalEffectable.stutterConfig : stutterConfig, ...)
```
(`mod_controllable_audio.cpp:1306`)

That field is **never serialized**, and the reader sets it back to `true`
every time it encounters a `<stutter>` tag
(`mod_controllable_audio.cpp:762`). So after any load, the song's config wins
and the three saved values are ignored until the user picks a direction other
than "USE SONG" for that sound on the device - a choice which is itself not
saved.

This is firmware behaviour, not something the editor can fix, so the UI says so
rather than implying the controls do more than they do.

---

## One editor session at a time, and a wedged write path needs a power cycle

**Decision: never have two tabs connected to the Deluge at once, and close the
session when done rather than leaving a tab connected.**

Observed failure: `TIM KICK1.XML` was found at 0 bytes on the card after a save
attempt, and the editor reported `XML parsing failed: Document is empty` when
loading it - the file really was empty, so the Deluge could not load it either.

The truncation itself is the known destructive-save behaviour: `open` with
`write:1` truncates before any data arrives, so a write that dies mid-transfer
leaves nothing. That is documented under the number-input entry above and has
not changed.

What was new is the state the device got into. Several sessions had accumulated
(`^session` was handing out `sid: 11`, and the editor had been connected from
more than one tab). In that state:

- `dir` worked normally.
- `open` succeeded, but only after four retries.
- **`write` was never answered at all** - the first 24-byte chunk retried for
  two minutes without a single `^write` reply.

A power cycle of the Deluge cleared it completely. The same 5343-byte file then
wrote in about two minutes with `err: 0` on every chunk, and read back
byte-identical (SHA-256 verified).

Two things make the stall self-sustaining once it starts. The session's msgId
window is only seven values (`midMin: 89, midMax: 95`, i.e. 0x59-0x5F), and the
first ten retry timeouts are 120 ms - so the ID space wraps in under a second
and resends start reusing IDs that are still in flight.

**Operationally:** keep one tab. If writes stop being answered while `dir` and
`open` still work, stop retrying and power cycle - it is not something the retry
logic can recover from. And pull a copy of anything irreplaceable before saving
over it, because the failure mode destroys the previous version.

---

## Corrections to earlier conclusions

Recorded because each of these was stated confidently and was wrong, and the
wrong version is more memorable than the right one.

- **`SysExQ` memory pressure does not cause dropped commands**, and the drop
  rate does not worsen over a session. A 19-byte JSON ping replies 30/30 while
  queued, and a fresh power cycle reproduces the same cliff exactly (48 bytes
  30/30, 49 bytes 11/30). The cause is inbound request size against the USB
  max-packet boundary - see
  [deluge-sysex-reliability.md](deluge-sysex-reliability.md).
- **A write request is ~198 bytes, not ~1170.** 7-bit packing turns a 128-byte
  payload into 147, not ~1040. The conclusion held, the figure did not.
- **The preset corruption was not caused by our retry logic.** It was the
  missing `^write.size` check, which predated that work: `smSysex::writeBlock`
  commits however many bytes survived the transfer and still replies `err=0`.
