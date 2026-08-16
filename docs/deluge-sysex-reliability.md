# Deluge SysEx reliability: session timeouts and dropped commands

Notes from debugging "Session negotiation timed out after 15 seconds" and
"Command timeout (10s). Check Deluge connection." against **community firmware
1.3 beta**, and what this fork does about it.

> **Status update, 2026-08-15: the inbound USB drop (section 2's headline
> defect) is fixed in firmware.** Upstream PR
> [#4633](https://github.com/SynthstromAudible/DelugeFirmware/pull/4633)
> ("Fix USB MIDI receive packet loss + chainload corruption") shipped in
> community firmware **c1.3.0**. Re-measured on c1.3.0 over real USB: 40/40
> replies to 55-195 byte requests, and 512-byte write chunks wrote a 16KB file
> with zero short writes, verified byte-for-byte, at 27 KB/s. The editor's
> workarounds are backed out accordingly: `WRITE_CHUNK_SIZE` is back to 512
> (the protocol's design size; the remaining ceiling is the firmware's
> `MaxSysExLength` of 1024 total SysEx bytes), and the deep retry ladder is
> trimmed to a few attempts plus the slow-SD tail. The `^write.size` check and
> the full read-back verification are deliberately kept: they are cheap now,
> and on pre-fix firmware they turn the old silent corruption into a hard
> error. Saves effectively require c1.3.0 or later.
>
> Still true on c1.3.0: a request whose JSON does not match any command tag is
> dropped with no reply (defect 2 of
> [#4762](https://github.com/SynthstromAudible/DelugeFirmware/issues/4762) -
> reproduced on hardware 2026-08-15: `{"bogus":{}}`, bare garbage, and `{}` all
> get silence, and truncated JSON like `{"dir":{"path":` executes with default
> arguments). A fix exists on the `fix/smsysex-silent-drop` branch, pending PR.
> The rest of this document is kept as the diagnosis record; sizes and drop
> rates below describe **1.3 beta**, not current firmware.

There are two independent problems here. The first was a bug in this editor and
is fixed. The second was in the firmware, fixed in c1.3.0 as noted above.

---

## 1. Session negotiation always timed out (our bug, fixed)

### Symptom

```
sysex-core.js:315 Session negotiation timed out after 15 seconds - will use fallback mode
sysex-core.js:369 Session negotiation failed, using fallback mode: Error: Session timeout
```

Every single operation paid a 15 second stall before doing anything, then
continued in a "fallback mode" that did not work properly.

### Cause

`handleMidiMessage` discarded any inbound SysEx whose command byte was not
`JsonReply` (`0x05`). The Deluge does not use `0x05` for the session handshake.

From `src/deluge/storage/smsysex.cpp`:

```cpp
void smSysex::startDirect(JsonSerializer& writer) {          // used ONLY by assignSession()
    uint8_t reply_hdr[7] = {0xf0,0x00,0x21,0x7B,0x01, SysEx::SysexCommands::Json, 0};       // 0x04
}

void smSysex::startReply(JsonSerializer& writer, JsonDeserializer& reader) {   // everything else
    uint8_t reply_hdr[7] = {0xf0,0x00,0x21,0x7B,0x01, SysEx::SysexCommands::JsonReply, ...}; // 0x05
}
```

`assignSession()` is the only caller of `startDirect()`, so the `^session` reply
comes back with command byte `0x04` and msgId `0`. The Deluge was answering
instantly; we were throwing the answer away, then waiting 15 seconds for it.

DEx does not hit this because it receives the session reply through
`subscribeSysexListener()`, a raw listener with no command-byte filter. Its
`0x05` check only guards the binary-response path.

### Fix

Accept `0x04` as a reply **when msgId is 0**, which is exactly the
`startDirect()` case. The exception is pinned to msgId 0 deliberately: requests
we send also use command `0x04`, and the editor listens on all three Deluge
input ports, so a broader rule could let an echoed request be mistaken for a
reply.

Session negotiation now completes in about 4ms instead of timing out.

### Also fixed: the fallback message ID range

The old fallback session used `midMin 0x41 / midMax 0x4F`. The firmware encodes
message IDs as `(sid << 3) + (1..7)`, so that range straddles two session blocks
and includes `0x48`, whose message-ID part is `0`. Confirmed on hardware:

| msgId  | result             |
| ------ | ------------------ |
| `0x41` | reply in 22ms      |
| `0x48` | never answered     |
| `0x79` | reply in 22ms      |

So the 8th command in fallback mode would always hang. The fallback now uses
`0x79`–`0x7F`, a single valid sid block (sid 15).

---

## 2. The Deluge silently drops queued SysEx commands (firmware defect, fixed in c1.3.0)

### Symptom

Individual `dir` / `open` / `read` / `write` commands get no reply at all, at
random. Large directories were effectively impossible to list.

### Evidence

Two paths through the firmware behave very differently. `Ping` is answered
synchronously inside `MidiEngine::midiSysexReceived`. Everything else goes
through `smSysex::sysexReceived` → `SysExQ` → `handleNextSysEx`. Measured
back to back on the same connection:

| command             | firmware path        | replies |
| ------------------- | -------------------- | ------- |
| `ping`              | synchronous          | 15/15   |
| `dir` (same params) | queued via `SysExQ`  | 9/15    |

Further measurements:

- **The transport is fine.** Replies that arrive are complete, well formed
  single SysEx messages with the correct msgId — no splitting, no truncation.
- **A dropped request is never processed.** No late reply ever arrives, so no
  timeout is long enough to help. Resending is the only recovery.
- **Latency is flat at 21–29ms** when a reply comes, even for a 2KB reply.
  There is no slow tail to wait for.
- **Not rate related.** Success was the same at 0ms, 50ms and 500ms spacing
  between requests.
- **Not reply size related.** A 2086-byte reply got through while 369-byte
  replies were dropped. The outbound direction is not the problem.
- **Not msgId related.** The same msgId fails and then succeeds.
- **Not the USB cable.** Two different cables, 30 paired `ping`/`dir` sends
  each, gave an identical 60% `dir` success rate with `ping` at 30/30 and
  90/90. A marginal cable would drop pings too and would corrupt or truncate
  replies; neither happens.

### It is the size of the *request*

The `ping` versus `dir` comparison above confounds two variables: `ping` takes
a different firmware path *and* is a much smaller message. The firmware also
has a **JSON** ping, which goes through `SysExQ` exactly like `dir` does, and
that separates them:

| request              | firmware path       | request bytes | replies   |
| -------------------- | ------------------- | ------------- | --------- |
| raw `ping` (0x00)    | synchronous         | 8             | **30/30** |
| `{"ping":{}}`        | **queued, SysExQ**  | 19            | **30/30** |
| `{"dir":{...}}`      | queued, SysExQ      | 57            | 11/30     |
| `{"dir":{...}}` padded | queued, SysExQ    | 265           | **0/30**  |

The queue is not the problem. Request size is.

Sweeping the boundary, padding the `path` value so the *reply* stays small and
only the inbound direction varies:

| request bytes | USB-MIDI packets | USB wire bytes | replies    |
| ------------- | ---------------- | -------------- | ---------- |
| 28–47         | ≤16              | ≤64            | 100%       |
| **48**        | 16               | **64**         | **40/40**  |
| **49**        | 17               | **68**         | **17/40**  |
| 50            | 17               | 68             | 24/40      |
| 97            | 33               | 132            | 0/15       |

Every size from 28 to 48 bytes replied 100% of the time. One byte more and it
collapses to roughly 40%.

**48 SysEx bytes is exactly 16 USB-MIDI packets, which is exactly 64 bytes on
the wire — the USB full-speed bulk maximum packet size.** Any SysEx needing a
second USB transfer becomes unreliable. Above the threshold the rate is erratic
rather than steadily worsening (97 and 129 bytes measured 0%, 161 bytes 47%).

This is not the reassembly buffer overflowing: `incomingSysexBuffer` is 1024
bytes (`src/deluge/io/midi/midi_device.h:160`), far above the cliff.

This is firmware-side. Any smSysex client, including DEx, is exposed to it.

### Mechanism

Confirmed against firmware source (`beta` @ `ea4e69eb`). Two defects combine.

**The receive pipe is armed for exactly one max-packet, and the re-arm is
blocked by SD access.** `receiveData` is 64 bytes
(`midi_device_manager.h:81`) and every arm sets `tranlen = 64`
(`midi_engine.cpp:926`), so one armed transfer absorbs at most 16 USB-MIDI
packets = 48 SysEx bytes. Anything longer needs the pipe re-armed mid-message.
That re-arm only happens in `checkIncomingUsbMidi`, which sits on the
`midi routine` task registered `RESOURCE_SD | RESOURCE_USB`
(`deluge.cpp:547-548`) and early-returns whenever the card is busy
(`midi_engine.cpp:855-861`, commented in the source as *"hack to avoid SysEx
handlers clashing with other sd-card activity"*). Meanwhile the FIFO-read task
holds only `RESOURCE_USB` and keeps draining. Lose that race and the driver
returns `USB_READOVER` (`r_usb_plibusbip.c:612`), which clears the hardware
FIFO — the tail of the message, including the packet carrying `F7`, is gone
with no error and no callback.

`ping` at 8 bytes is 3 packets = 12 wire bytes, always inside one armed window,
so it is structurally immune. That is why it never drops.

**A request that fails to parse is popped without any reply.** In
`handleNextSysEx` (`smsysex.cpp:791-848`), `done:` is also the natural
fall-through of the tag-matching loop:

```cpp
parser.match('{');                                            // return value discarded
while (*(tagName = parser.readNextTagOrAttributeName())) {
    if (!strcmp(tagName, "open")) { openFile(...); goto done; }
    ...
    parser.exitTag();
}
done:
    SysExQ.pop_front();
```

A truncated payload makes `readNextTagOrAttributeName()` return `""`, the loop
exits normally, and the entry is popped with no reply generated.

The first defect loses the bytes; the second turns what should be a recoverable
parse error into a silent, unanswerable hang.

Reported upstream as
[DelugeFirmware issue #4762](https://github.com/SynthstromAudible/DelugeFirmware/issues/4762).

### What this means in practice

Commands land on either side of the 48-byte cliff depending on their arguments:

- `{"read":{"fid":1,"addr":0,"size":1024}}` is 47 bytes and reliable — but
  `"addr":4096` makes it 50, so reads get flaky deeper into a file.
- `open` with a real path such as `/SYNTHS/FACT/SYNT000.XML` is ~60 bytes and
  always needs retries.
- `write` carries a 128-byte binary payload. The 7-bit packing turns that into
  147 bytes, so the request is ~198 bytes — far over the cliff. See below; this
  one silently corrupted a file.
- Directory listings of deeply nested paths get worse the longer the path.

### The write path silently corrupted a preset

Saving a 2455-byte preset reported success, listed at the right size, and then
froze the Deluge with `E365` on load. The file held **the first 44 bytes of
every 128-byte chunk followed by 84 NUL bytes**, all 19 chunks, perfectly
regular — 1596 of 2455 bytes were zeros. The surviving heads are contiguous
with each other, so the source XML was intact and the loss was entirely in
transit.

The request is 198 bytes = five 64-byte USB transfers. It consistently loses
the middle two, leaving 51 packed bytes, which unpack to exactly 44. The
terminating `F7` still arrives, so the message completes and looks legitimate.

It was silent because `smSysex::writeBlock` commits whatever survived and still
reports `err = FR_OK`, echoing the real count in `^write.size`. `writeFile`
checked only `err`, and the post-write verification called `fileExists()` —
the directory entry, not the contents. So a holed file passed every check.

Fixed here by checking `^write.size` against the chunk length and retrying, and
by verifying after close with a full read-back byte comparison. Note that no
chunk size avoids the underlying problem: the JSON alone is ~41 bytes, so even
a 16-byte payload spans two USB transfers. Smaller chunks only narrow the
exposure. Measured accept rate by payload size, full-length writes on the same
connection:

| payload | request bytes | accepted             |
| ------- | ------------- | -------------------- |
| 16 B    | 66            | 10/10                |
| 24 B    | 75            | 6/6                  |
| 32 B    | 84            | 5/6                  |
| 48 B    | 105           | fails after 23 tries |

The write chunk is 24 bytes (`WRITE_CHUNK_SIZE`, `sysex-core.js:115`). 16 is
equally reliable but moves less per round trip, and by 32 the accept rate costs
more than the extra payload gains.

An earlier revision of this document blamed `SysExQ` memory pressure and
reported the drop rate "worsening over a session". That was wrong: the varying
rate was an artefact of comparing differently sized messages. The queued path
itself is reliable, as the 19-byte JSON ping shows.

### Workaround in this fork (now backed out — see status update at top)

`sendJson()` resends on timeout. Because a dropped request is never processed,
and because every command addresses an explicit `fid`/`addr`/`offset`,
resending is idempotent.

While the defect was live, the retry budget was shaped by the measurements
above — many short attempts rather than a few patient ones, since waiting never
helps:

```js
const SEND_ATTEMPT_TIMEOUTS_MS = [
    ...Array(20).fill(400),   // dropped-request recovery
    2000, 4000, 10000         // tail for genuinely slow SD card operations
];
```

With the firmware fixed this is trimmed to a few quick resends plus the
slow-SD tail; resend-on-timeout itself stays, since it is also what converts
defect 2's silent drop into a clean error.

Each attempt takes a fresh message ID, so a late reply to an abandoned attempt
can never be mistaken for the current one.

Session negotiation retries the same way, since `assignSession()` runs on the
same queued path and can be dropped too.

### Also: one less round trip per directory

`listDirectory` used to request 64 lines (the firmware clamps to
`MAX_DIR_LINES` = 25) and kept paging until it got an empty page. That meant
every directory cost one extra request purely to be told there was nothing
left — and each request is individually unreliable.

It now requests 25 and stops when a page comes back short, since a short page
means the end of the directory.

### Results on hardware

| operation                          | before          | after  |
| ---------------------------------- | --------------- | ------ |
| Session negotiation                | 15s timeout     | ~4ms   |
| List `/SYNTHS/` (5 folders)        | hard failure    | ~0.5s  |
| List `/SYNTHS/FACT/` (342 entries) | hard failure    | ~10s   |
| Read `SYNT000.XML` (4550 bytes)    | hard failure    | ~6s    |

The remaining slowness is the firmware drop rate, not the editor. `/SYNTHS/FACT/`
is 14 pages, and each page usually needs several sends before one is accepted.

---

## 3. What the other clients do

Four clients speak smSysex. None of them survives the drop, but they fail in
different ways, and the differences turned out to be worth understanding.

| client                                     | timeout               | resend on drop | write chunk                          | write verified   |
| ------------------------------------------ | --------------------- | -------------- | ------------------------------------ | ---------------- |
| `jamiefaye/vuefinder` — reference client    | none                  | none           | 512 B (~630 B request)               | `close` err only |
| `silicakes/deluge-extensions` (DEx)         | 10s, then reject      | none           | 128 B `fsWrite` / 256 B `uploadFile` | `err` only       |
| `solaris76/Deluge-Synth-Editor` — this base | 15s session / 10s cmd | none           | 128 B                                | `fileExists()`   |
| this fork                                   | 20×400ms + tail       | yes            | 24 B                                 | full read-back   |

(`MrHaila/deluge-sysex-tools` is a stub — "proposal, doesn't actually do
anything yet". `DelugeWeb` hosts vuefinder; downrush/catnip/delugeclient are
FlashAir or debug tools, not smSysex.)

### vuefinder is the firmware's own reference client

PR #2853, which added smSysex, describes itself as being for "file browsing and
transfer between the Deluge & the 'vuefinder' web application". Jamie Fenton
wrote both sides. So vuefinder's `blockSize = 512`
(`src/utils/FileRoutines.js:3`) is the size the protocol was designed around —
more than ten times the 48-byte cliff.

It has no timeout and no retry anywhere. `sendJsonRequest` stores a callback in
an array indexed by msgId and returns; a dropped request simply means the
callback is never invoked and the transfer stops, permanently and silently. The
project's own documentation describes exactly that state — *"if you need to stop
a transfer in its tracks, reloading the web page will work. (If you do too many
of these forced-resets, you may have to reboot the Deluge too)"* — and lists an
abort feature and a progress meter among the unfinished work. The repository has
not been touched since November 2024, the month #2853 merged.

### …and its write loop is accidentally immune to the corruption

It advances by the size the Deluge reports, not the size it asked for:

```js
writtenSoFar += resp.size;          // what the Deluge actually wrote
params.addr = writtenSoFar;
let sizeToWrite = toWrite - writtenSoFar;
if (sizeToWrite > blockSize) sizeToWrite = blockSize;
let packed = pack8bitTo7bit(fromByteArray, writtenSoFar, sizeToWrite);
```

A truncated request whose JSON header still parses comes back with a short
`^write.size`, and the next request re-sends from there. No hole is ever left.
Truncation costs throughput, not correctness — which is why a 512-byte block
size was never noticed as a problem, and why the loss stayed invisible for two
years.

The clients that advance by the *requested* size are the ones that corrupt:

- `solaris76` (`sysex-core.js`) never reads `^write.size` at all — `offset +=
  size` unconditionally. That is the hole this fork found: the firmware writes
  44 bytes, the client moves on 128, FatFS zero-fills the gap.
- DEx `fsWrite.ts` does the same.
- DEx `uploadFile.ts` is worse. It advances the destination address by
  `response.size` but the source offset by the requested `size`, so a short
  write drops those source bytes entirely and shifts everything after them down.
  The result is a spliced, short file rather than a holed one, and nothing
  checks the final length.

Note that vuefinder's immunity only covers the case where the JSON header
survives. Its `write` JSON is ~43 bytes, so with the 7-byte SysEx header the
header alone reaches the 48-byte boundary; lose the transfer carrying the rest
of it and the request fails to parse, gets popped with no reply, and the upload
hangs with nothing to time it out.

### vuefinder's read path sits under the cliff by luck

`{"read":{"fid":1,"addr":0,"size":512}}` is 34 bytes and stays under 48 even at
six-digit addresses, and reads are outbound-heavy. So the "around 200K bytes per
second" figure in the vuefinder documentation is a download number and does not
contradict any of this. The inbound direction is the exposed one, and `write` is
the only command that pushes it hard.

### DEx worked around this without diagnosing it

`fsWrite.ts:33` reads `const chunkSize = 128; // Use 128 byte chunks to avoid
SysEx size limits`, and `uploadFile.ts:60` is `const chunkSize = 256; // Reduced
chunk size`. Someone hit a size-dependent failure and shrank the chunk
empirically. DEx issue #11 ("File Browser doesn't work?") has the maintainer
replying that *"we had some regression in our file browser (SysEx) mechanism …
some of it was fixed while some is still being worked on"*.

Neither is a diagnosis, but both are independent sightings of the same cliff.

### The fallback message ID bug is shared

DEx uses the same `midMin: 0x41, midMax: 0x4f` fallback
(`src/lib/smsysex.ts:460`) that this fork inherited and fixed in section 1. The
firmware encodes IDs as `(sid << SYSEX_SESSION_SHIFT) + 1..SYSEX_MSGID_MAX`,
with the shift 3 and the max 7 (`smsysex.cpp:69-72`, `:745-746`), so that range
straddles two session blocks and contains the dead `0x48`. It is still live
upstream.

### Why this went two years without a bug report

Every client hit it. None of them recognised it as a firmware problem, because
the cliff never presents as one:

- vuefinder's docs tell you to reload the page, and sometimes to reboot the
  Deluge.
- DEx `fsWrite.ts:33` — `const chunkSize = 128; // Use 128 byte chunks to avoid
  SysEx size limits`.
- DEx `uploadFile.ts:60` — `const chunkSize = 256; // Reduced chunk size`.
- DEx issue #11, "File Browser doesn't work?" — *"we had some regression in our
  file browser (SysEx) mechanism … some of it was fixed while some is still
  being worked on."*

Four parties, four independent size-dependent failures, four local workarounds,
no upstream issue. The failure mode is what does it: a dropped request looks
like a hung web app, and a truncated write looks like a bad SD card. Neither
looks like USB.

---

## 4. Open questions

Overtaken by events: the firmware fix (#4633) landed before either test was
run. The padded-ping experiment is moot now that large inbound requests are
reliable, and the partial-progress write resume is no longer worth its risk
since short writes no longer occur on fixed firmware. Kept for the record.

### The test that removes the client from the argument

Everything measured so far runs through this editor's own code, which invites
the response that the editor is at fault. `ping` removes that. `doPing`
(`smsysex.cpp:751-756`) does nothing but reply — no SD access, no file handle,
no session mutation — and `handleNextSysEx` skips unrecognised tags with
`parser.exitTag()` and keeps looping.

So send a padded ping, with the padding **first**:

```json
{"pad":"AAAA…","ping":{}}
```

The order matters. The parser walks tags left to right, so it only reaches
`ping` if the whole message arrived. Truncate it anywhere and
`readNextTagOrAttributeName()` returns `""`, the loop falls through to `done:`,
the entry is popped, and no reply is ever sent. Reply rate is then a direct
binary measure of *did every byte get here*.

Sweep the pad length so total request size runs ~20 to ~200 bytes, 100 sends at
each size, and plot reply rate against length.

This is worth doing because it cannot be deflected. Nothing downstream of USB
is involved — no FatFS, no `f_write`, no `writeBlock`. The semantics are
identical in every trial and only the length changes. It touches none of this
editor's write, chunking or verification logic. And it is read-only, so it can
be run as long as needed without risking the card.

It should also settle the mechanism in section 2. If padded `ping` falls off
the same cliff as `write`, the problem is entirely USB-side and the SD-contention
half of the story is at most contributory — which would explain the otherwise
awkward measurement that 0ms, 50ms and 500ms request spacing made no
difference. If padded `ping` stays clean and only `write` fails, the mechanism
as written here is wrong and the fault is somewhere in the SD path.

### Keeping partial progress on a short write

`writeFile` currently discards it. On a short write it re-sends the whole chunk
at the same `addr` (`sysex-core.js:781-786`) and gives up after
`WRITE_CHUNK_ATTEMPTS`. vuefinder instead keeps the bytes that landed and
resumes at `offset + ack.size`. At the measured ~68% drop rate that is a lot of
successful partial work being thrown away, and it may also allow a larger chunk
again, since a big chunk that half-lands still makes half-progress.

The reason it has not been adopted: advancing by `ack.size` assumes the bytes
that arrived are a clean *prefix*. `decodeDataFromReader` decodes whatever
bytes it received, in order, and cannot tell that an interior transfer is
missing. If loss is ever "transfers 1 and 4 arrive, 2 and 3 do not", the Deluge
writes spliced data and still reports a plausible `size`, and advancing by it
commits silent garbage. The observed `E365` file was clean truncation, but that
is a single observation.

If adopted, it must keep the full byte-for-byte read-back after close, which
would catch a splice. "Take vuefinder's resume logic, keep our backstop" — not
"copy vuefinder".

---

## Reference

Firmware source consulted (branch `beta`,
`SynthstromAudible/DelugeFirmware`):

- `src/deluge/storage/smsysex.cpp` — `startDirect`, `startReply`,
  `assignSession`, `getDirEntries`, `handleNextSysEx`, `SysExQ`
- `src/deluge/io/midi/sysex.h` — `SysexCommands` enum (`Json` = 4,
  `JsonReply` = 5)
- `src/deluge/io/midi/midi_engine.cpp` — `midiSysexReceived`,
  `checkIncomingUsbSysex`

Client implementations consulted:

- `jamiefaye/vuefinder` — `src/utils/FileRoutines.js`,
  `src/utils/JsonReplyHandler.js`. The original reference client, by the author
  of smSysex itself; PR #2853 added the firmware side for it.
- `silicakes/deluge-extensions` (DEx) — `src/lib/smsysex.ts`,
  `src/commands/fileSystem/{fsWrite,fsRead,fsList}.ts`,
  `src/commands/fileSystem/uploadFile/uploadFile.ts`.
- `solaris76/Deluge-Synth-Editor` — `js/sysex-core.js`, the base this fork
  started from.
