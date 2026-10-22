#!/bin/sh
# Rizin through REA for the enemy export; keeps the evidence records next to the export.
# usage: tools/re/export/enemies-rea-ev.sh <label> "<rizin commands>"
# writes work/re/extract/enemies/evidence/<label>.json (full REA record) and <label>.txt; prints the evidence id.
export PATH="/e/tools/rizin/rizin-win-installer-clang_cl-64/bin:$PATH"
ROOT=E:/mostafa/Cadillacs-and-Dinosaurs-II
BIN=$ROOT/work/re/dino-prg.bin
OUT=$ROOT/work/re/extract/enemies/evidence
mkdir -p "$OUT"
rea execute-rizin-command "$BIN" "e scr.color=0; e asm.arch=m68k; e asm.cpu=68000; e asm.bits=32; e asm.bytes=true; $2" --format json 2>/dev/null > "$OUT/$1.json"
node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));require('fs').writeFileSync(process.argv[2],j.raw_result.stdout.replace(/\r/g,''));console.log(process.argv[3]+' '+j.evidence_id+' exit='+j.raw_result.exit_code+' lines='+j.raw_result.stdout.split('\n').length)" "$OUT/$1.json" "$OUT/$1.txt" "$1"
