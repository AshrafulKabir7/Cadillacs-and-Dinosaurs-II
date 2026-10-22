#!/bin/sh
# Re-derive the key static facts of the story-text export through REA (Rizin), keeping evidence records.
#   sh tools/re/export/story-rea.sh          -> work/re/extract/story/evidence/<label>.json/.txt + evidence.jsonl
# Each record is one `rea execute-rizin-command` on the byte-swapped program image (offset == address).
export PATH="/e/tools/rizin/rizin-win-installer-clang_cl-64/bin:$PATH"
ROOT=E:/mostafa/Cadillacs-and-Dinosaurs-II
BIN=$ROOT/work/re/dino-prg.bin
OUT=$ROOT/work/re/extract/story/evidence
mkdir -p "$OUT"
ev() {
  rea execute-rizin-command "$BIN" "e scr.color=0; e asm.arch=m68k; e asm.cpu=68000; e asm.bits=32; e asm.bytes=true; $2" --format json 2>/dev/null > "$OUT/$1.json"
  node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));fs.writeFileSync(process.argv[2],j.raw_result.stdout.replace(/\r/g,''));console.log(JSON.stringify({label:process.argv[3],evidence_id:j.evidence_id,exit:j.raw_result.exit_code,lines:j.raw_result.stdout.split('\n').length}))" "$OUT/$1.json" "$OUT/$1.txt" "$1"
}
{
# text printers: English 8x16 (0x84F72), 16x16 / Japanese (0x0CD2/0x0CE4), 8x16 plain (0x0E0A/0x0E12), 8x8 word (0x0C44/0x0C4C), ASCII bytes (0x0BAE/0x0BB6)
ev t01-printer-en "pd 72 @ 0x84F72"
ev t02-printer-16x16 "pd 92 @ 0xCD2"
ev t03-printer-8x16-8x8-ascii "pd 32 @ 0xBAE; pd 22 @ 0xC44; pd 22 @ 0xE0A"
# typewriter object (pool C type 0x68): spawn 0x7EC20 (text -> +0x80, speed +0x86), char loop, English/Japanese width rule
ev t04-typewriter "pd 14 @ 0x7EC20; pd 40 @ 0x7EC88; pd 30 @ 0x7EE1C"
# region word 0xFF8032 = 2 (World) written once; title-card selection by stage and region; the two title-card tables
ev t05-region-titlecards "pd 6 @ 0xA730; pd 10 @ 0xC6B2; pxw 0x40 @ 0xC6D2; pd 10 @ 0x7D122; pxw 0x40 @ 0x7D142"
# main state dispatch (0xA958) and state 8 (intermission + title card) with its per-stage jump table 0xD8D8
ev t06-state8 "pxw 0x20 @ 0xA958; pd 28 @ 0xD898"
# the intermission per stage: images (0x98BAE), text (lea ..,A0 ; jsr 0x84F72), portrait lines (0x84736), hero helpers
ev t07-intermissions "pd 30 @ 0xD8E8; pd 40 @ 0xD97E; pd 60 @ 0xDAB4; pd 50 @ 0xDBB2; pd 40 @ 0xDDCC; pd 40 @ 0xDE6C; pd 30 @ 0xDF1E"
ev t08-hero-helpers "pd 46 @ 0xE034"
# portrait + line routine 0x84736 and the line table 0x84800 (0x44 longs), portrait tables 0x8461A/0x8463E
ev t09-dialogue "pd 50 @ 0x84736; pxw 0x110 @ 0x84800; pxw 0x24 @ 0x8461A; pxw 0x48 @ 0x8463E"
# FESS MESS (pool C type 0xC8): front player's character, script table 0x84584 (subtype*4 + character id)
ev t10-fessmess "pd 60 @ 0x844B4; pxw 0x80 @ 0x84584; pd 140 @ 0xA5CEC"
ev t11-fessmess-steps "pd 260 @ 0xA606E"
# in-stage caption object (pool C type 0x108): subtype -> table 0x87710 -> 0x84F72
ev t12-captions "pd 22 @ 0x86FBA; pxw 0x1C0 @ 0x87710"
# continue screen taunts (state 0x10 -> 0xF13E): Japanese table 0xF194 / English 0xF27C by 0xFF8032
ev t13-continue-taunts "pd 30 @ 0xF13E; pxw 0x14 @ 0xF194; pxw 0x14 @ 0xF27C"
# Fessenden monitor lines (pool C type 0x88, table 0x81BCA) and the scroller (pool C type 0x60, table 0x7E38C)
ev t14-fess-monitor "pd 30 @ 0x81B3E; pxw 0x1C @ 0x81BCA"
ev t15-scroller "pd 50 @ 0x7E2D0; pxw 0x70 @ 0x7E38C"
# boss lines spoken from boss code (Morgan 0x52DCC, Fessenden 0x696A4..0x698B0) and the ending demo (0x8A81C..0x8A90E)
ev t16-boss-lines "pd 8 @ 0x52DCC; pd 8 @ 0x696A4; pd 8 @ 0x696EE; pd 8 @ 0x6981C; pd 8 @ 0x69860; pd 8 @ 0x698A4"
ev t17-ending-lines "pd 70 @ 0x8A81C"
# ending state 0x1C (0xAC48 -> 0xA69B8): spawns CADDI. DEMO 2 (pool C 0x148), waits 0x14F0 frames
ev t18-ending-state "pd 4 @ 0xAC48; pd 80 @ 0xA69B8"
# staff roll (STUFF ROLL, pool C 0x15C): list at 0x8B7EC, 12-byte entries
ev t19-staff-roll "pd 20 @ 0x8B66A; ps 12 @ 0x8B7EC; px 0x498 @ 0x8B7EC"
# attract sequencer (0xFF8FD0) and the story intro 0x988C0 (texts 0x98CC6..0x98F8A)
ev t20-attract "pd 70 @ 0x97C40; pd 120 @ 0x988C0"
# text block bytes (one per kind): intermission, dialogue, caption, title card
ev t21-text-bytes "pxw 0xD6 @ 0xE42A; pxw 0x60 @ 0xA4DDC; pxw 0x30 @ 0x879D2; pxw 0x30 @ 0xC894"

# sprite speech balloons: pool D type 0x14 (0x92B7A, set 0x92BF0 = 12 anims, records 1593-1604), random pair by hero
# (0x6192, table 0x61E6, called from the pose code 0x22D8 / 0x199B4), third balloon by hero (0x61F6, table 0x6244)
ev t22-balloons "pd 30 @ 0x92B7A; pxw 0xA8 @ 0x92BF0; pd 30 @ 0x6192; pxw 0x10 @ 0x61E6; pd 14 @ 0x61F6; pxw 0x4 @ 0x6244; pd 10 @ 0x22C8; pd 10 @ 0x199A4"
# stage spawn lists: pointers by stage/area (0xFBF4, tables 0xFC2E/0xFC4E), the 14-byte entry walker (0xFC7A, allocators
# 0xFD46), and the EPISODE 1 area 0 list (captions 0x09, 0x49, 0x54, 0x4A, 0x0E as entries of type 0x108)
ev t23-spawn-lists "pd 18 @ 0xFBF4; pxw 0x40 @ 0xFC2E; pd 40 @ 0xFC7A; pxw 0x10 @ 0xFD46; pxw 0xB6 @ 0xACD9E"
# the escape after the last boss: stage-clear step 6 (0xABA8 waits for 0xFF84E2 or 0xE10 passes), the player script op that
# spawns the four JUMP PL. runners (0x1E672), their bits in 0xFF8F57 and the FESS MESS 7 line (0x69EF4-0x69FB6)
ev t24-escape "pd 12 @ 0xABA8; pd 40 @ 0x1E672; pd 60 @ 0x69EF4"
# sprite balloon triggers: hero drop-in spawn of pool D 0x38 (0x18BE2-0x18C5C), its handler 0x93B28 and set 0x93C82
# (anim 1 "Need a hand?" when 0xFF84EF != 0), the victory pose 0x22BA (+0xC0 from the end-of-stage script op 0x1E63C and
# 0x6160), the team-up 0x6836-0x6900 (bra 0x61F6 = cue balloon), the unreachable DRIVE! sign object 0x97414/0x97430
ev t25-balloons-triggers "pd 24 @ 0x18BE2; pd 50 @ 0x93B28; pxw 0x80 @ 0x93C82; pd 10 @ 0x22BA; pd 8 @ 0x1E63C; pd 8 @ 0x6160; pd 46 @ 0x6836; pd 22 @ 0x97414; pxw 0x18 @ 0x974DA; pxw 0x4 @ 0x2387E"
# TYROG type 0x120 (0x5DD58): leap attack 0x5E24A, grab test 0x5E03A-0x5E048, grab-hold 0x5E2F8 with caption 0x5A; the
# first Tyrog type 0x10 (0x36A64) dispatches within +-32 KB and has no caption spawn
ev t26-tyrog-grab "pd 6 @ 0x5E03A; pd 64 @ 0x5E24A; pd 4 @ 0x36A64"
} | tee "$OUT/evidence.jsonl"
