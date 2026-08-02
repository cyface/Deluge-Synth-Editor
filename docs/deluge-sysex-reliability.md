# Deluge SysEx reliability: session timeouts and dropped commands

Notes from debugging "Session negotiation timed out after 15 seconds" and
"Command timeout (10s). Check Deluge connection." against **community firmware
1.3 beta**, and what this fork does about it.

There are two independent problems here. The first was a bug in this editor and
is fixed. The second is in the firmware, and can only be worked around.

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

## 2. The Deluge silently drops queued SysEx commands (firmware limitation)

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
exposure — the write chunk is now 32 bytes (~87-byte request, 2 transfers
instead of 5).

An earlier revision of this document blamed `SysExQ` memory pressure and
reported the drop rate "worsening over a session". That was wrong: the varying
rate was an artefact of comparing differently sized messages. The queued path
itself is reliable, as the 19-byte JSON ping shows.

### Workaround in this fork

`sendJson()` resends on timeout. Because a dropped request is never processed,
and because every command addresses an explicit `fid`/`addr`/`offset`,
resending is idempotent.

The retry budget is shaped by the measurements above — many short attempts
rather than a few patient ones, since waiting never helps:

```js
const SEND_ATTEMPT_TIMEOUTS_MS = [
    ...Array(20).fill(400),   // dropped-request recovery
    2000, 4000, 10000         // tail for genuinely slow SD card operations
];
```

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

## Reference

Firmware source consulted (branch `beta`,
`SynthstromAudible/DelugeFirmware`):

- `src/deluge/storage/smsysex.cpp` — `startDirect`, `startReply`,
  `assignSession`, `getDirEntries`, `handleNextSysEx`, `SysExQ`
- `src/deluge/io/midi/sysex.h` — `SysexCommands` enum (`Json` = 4,
  `JsonReply` = 5)
- `src/deluge/io/midi/midi_engine.cpp` — `midiSysexReceived`,
  `checkIncomingUsbSysex`

Protocol reference implementation: `silicakes/deluge-extensions`,
`src/lib/smsysex.ts`.
