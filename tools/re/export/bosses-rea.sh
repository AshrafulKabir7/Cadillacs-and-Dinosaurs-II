#!/bin/sh
# Re-derive the key static facts of the boss & dinosaur export through REA (Rizin), keeping evidence records.
#   sh tools/re/export/bosses-rea.sh          -> work/re/extract/bosses/evidence/<label>.json/.txt + evidence.json
# Each record is one `rea execute-rizin-command` on the byte-swapped program image (offset == address).
export PATH="/e/tools/rizin/rizin-win-installer-clang_cl-64/bin:$PATH"
ROOT=E:/mostafa/Cadillacs-and-Dinosaurs-II
BIN=$ROOT/work/re/dino-prg.bin
OUT=$ROOT/work/re/extract/bosses/evidence
mkdir -p "$OUT"
ev() {
  rea execute-rizin-command "$BIN" "e scr.color=0; e asm.arch=m68k; e asm.cpu=68000; e asm.bits=32; e asm.bytes=true; $2" --format json 2>/dev/null > "$OUT/$1.json"
  node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));fs.writeFileSync(process.argv[2],j.raw_result.stdout.replace(/\r/g,''));console.log(JSON.stringify({label:process.argv[3],evidence_id:j.evidence_id,exit:j.raw_result.exit_code,lines:j.raw_result.stdout.split('\n').length}))" "$OUT/$1.json" "$OUT/$1.txt" "$1"
}
{
# HUD name table (R9) incl. entries 0x24..0x26 (WRENCH T., FESSENDEN, HOGG) and the HOGG string
ev b01-name-table "px 0x50 @ 0x17D78; ps @ 0x17F3D; ps @ 0x17F7F"
# boss HP: routine and table (D0*48 + players*16 + (rank & 0x1C)/2), regular HP routine and table
ev b02-boss-hp "pd 18 @ 0x31E14; px 0x1E0 @ 0x31E52"
ev b03-regular-hp "pd 12 @ 0x31424"
# per-(stage, area) OBJ palette rows (0x8E4C) and the row table 0x8E8E
ev b04-palette-areas "pd 18 @ 0x8E4C; pxw 0x80 @ 0x8E8E"
# enemy attack damage on heroes (attacker +0x58 -> 0xA2EA4 + id*8) and the rank / victim modifiers at 0x6422
ev b05-enemy-damage "pd 34 @ 0x116B2; pd 60 @ 0x6422"
# reaction anim starter (hit set 0x2E68C[+0x84]) and the grab set (0x2E724)
ev b06-reaction-sets "pd 8 @ 0x2B49A; pd 8 @ 0x2B416; pxw 0x98 @ 0x2E724; pxw 0x98 @ 0x2E68C"
# boss inits: name index (+0x03), reaction index (+0x84), animation set (+0x40) and boss-HP index (moveq #n,D0; jsr 0x31E14)
ev b07-vice-walther-init "pd 32 @ 0x425B6"
ev b08-butcher-init "pd 24 @ 0x584B2"
ev b09-hogg-init "pd 40 @ 0x4FD40"
ev b10-slice-init "pd 24 @ 0x4BE9C"
ev b11-morgan-init "pd 30 @ 0x51734"
ev b12-morgue-init "pd 30 @ 0x53E24"
ev b13-tyrog-init "pd 30 @ 0x36A92"
ev b14-tyrog-kk-init "pd 30 @ 0x5DD94"
ev b15-slisaur-init "pd 30 @ 0x5C844"
ev b16-fess1-init "pd 30 @ 0x67D54"
ev b17-fess-init "pd 30 @ 0x61860"
ev b18-tyrog2-init "pd 30 @ 0x6550A"
# cut-scene / controller objects: FESS MESS (dialogue picker), KING K.K. DEMO2 (spawns type 0x12C), SISOCYOU 1 (0xB8/0xC8)
ev b19-fess-mess "pd 40 @ 0x844B4"
ev b20-kingkk-demo2 "pd 50 @ 0x8A41E"
ev b21-sisocyou "pd 30 @ 0x899FA"
# dinosaurs: Dinonics, Arosaurus, Torikeratopss, Pteranodon inits (+0x03 R HOPPER / SHIVAT / MACK / ZEKE)
ev b22-dino-inits "pd 40 @ 0x4DCF6; pd 40 @ 0x4838C; pd 40 @ 0x5341C; pd 40 @ 0x606D4"
} > "$OUT/evidence.jsonl"
cat "$OUT/evidence.jsonl"
