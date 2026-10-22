#!/bin/sh
# Disassemble 68000 code from the byte-swapped program image with MAME's unidasm.
# usage: tools/re/dis.sh <start-hex> <len-hex>     (unidasm: -basepc is hex, -skip/-count decimal)
BIN=E:/mostafa/Cadillacs-and-Dinosaurs-II/work/re/dino-prg.bin
S=$((0x$1)); L=$((0x$2))
"/e/tools/mame/unidasm.exe" "$BIN" -arch m68000 -basepc $1 -skip $S -count $L 2>/dev/null | sed 's/\r$//'
