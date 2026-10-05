from pathlib import Path
import json
r=Path(__file__).resolve().parents[1]
c=json.loads((r/"combat-config.json").read_text(encoding="utf8"))
(r/"combat-config.js").write_text("// Generated from combat-config.json by tools/build-config.py.\nwindow.COMBAT_CONFIG = "+json.dumps(c,separators=(",",":"))+";\n",encoding="utf8")
