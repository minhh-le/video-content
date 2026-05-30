#!/bin/bash
set -e

echo "Installing Claude Code TTS Hook..."

# Install Python dependency
pip3 install edge-tts

# Copy script to Claude scripts directory
mkdir -p ~/.claude/scripts
cp tts_hook.py ~/.claude/scripts/tts_hook.py
chmod +x ~/.claude/scripts/tts_hook.py

# Auto-inject Stop hook into Claude settings
SETTINGS=~/.claude/settings.json

if [ ! -f "$SETTINGS" ]; then
  echo '{}' > "$SETTINGS"
fi

INJECT_RESULT=$(python3 - "$SETTINGS" <<'PYEOF'
import json, sys

path = sys.argv[1]
try:
    with open(path) as f:
        s = json.load(f)
except Exception:
    s = {}

s.setdefault("hooks", {}).setdefault("Stop", [{"hooks": []}])

for entry in s["hooks"]["Stop"]:
    for h in entry.get("hooks", []):
        if "tts_hook.py" in h.get("command", ""):
            print("already_present")
            sys.exit(0)

s["hooks"]["Stop"][0]["hooks"].append({
    "type": "command",
    "command": "python3 ~/.claude/scripts/tts_hook.py",
    "async": True
})

with open(path, "w") as f:
    json.dump(s, f, indent=2)

print("added")
PYEOF
)

if [ "$INJECT_RESULT" = "already_present" ]; then
  echo "Hook already present in $SETTINGS — skipping."
else
  echo "Hook added to $SETTINGS."
fi

# Add shell aliases and functions
ZSHRC=~/.zshrc
BASHRC=~/.bashrc

add_aliases() {
  local file=$1
  if [ -f "$file" ] && ! grep -q "listen-on" "$file"; then
    cat >> "$file" << 'ALIASES'

# Claude Code listen mode
alias listen-on='touch ~/.claude/tts_enabled && say "listen mode on"'
alias listen-off='rm -f ~/.claude/tts_enabled && say "listen mode off"'
alias listen-stop='pkill afplay 2>/dev/null; echo "Stopped"'
alias listen-slow='echo "-50%" > ~/.claude/tts_rate && echo "Speed: 0.5x"'
alias listen-normal='echo "+0%" > ~/.claude/tts_rate && echo "Speed: 1.0x"'
alias listen-fast='echo "+50%" > ~/.claude/tts_rate && echo "Speed: 1.5x"'

listen() {
  local state="OFF"
  local speed="1.0x"
  [[ -f ~/.claude/tts_enabled ]] && state="ON"
  if [[ -f ~/.claude/tts_rate ]]; then
    local pct=$(cat ~/.claude/tts_rate)
    speed=$(python3 -c "p='$pct'; v=1+(int(p.replace('%','').replace('+',''))/100); print(f'{v:.1f}x')")
  fi
  echo "Listen mode: $state | Speed: $speed"
}

listen-speed() {
  local speed=$1
  if [[ -z "$speed" ]]; then
    echo "Usage: listen-speed <multiplier>  (e.g. listen-speed 1.2)"
    return 1
  fi
  local pct=$(python3 -c "v=float('$speed'); p=round((v-1)*100); print(f'+{p}%' if p>=0 else f'{p}%')")
  echo "$pct" > ~/.claude/tts_rate
  echo "Speed set to ${speed}x ($pct)"
}
ALIASES
    echo "Added listen commands to $file"
  fi
}

add_aliases "$ZSHRC"
add_aliases "$BASHRC"

echo ""
echo "Done! Open a new terminal (or run: source ~/.zshrc), then:"
echo "  listen-on          — enable voice output"
echo "  listen-off         — disable voice output"
echo "  listen             — check current status and speed"
echo "  listen-stop        — stop audio mid-response"
echo "  listen-speed 1.2   — set speed (e.g. 0.5, 1.0, 1.1, 1.2 ... 2.0)"
echo "  listen-slow        — 0.5x preset"
echo "  listen-normal      — 1.0x preset"
echo "  listen-fast        — 1.5x preset"
