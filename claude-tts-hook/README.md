# Claude Code TTS Hook

Automatically reads Claude Code's responses aloud using Microsoft's neural text-to-speech engine. Designed for a fully hands-free workflow — speak your prompts via Wispr Flow or any dictation tool, and hear Claude's replies spoken back to you in a natural human voice.

## How It Works

Claude Code supports [hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) — shell commands that fire on events. This project wires a `Stop` hook to a Python script that:

1. Receives Claude's last response as JSON
2. Strips code blocks, markdown symbols, and URLs (hearing raw code is useless)
3. Sends the cleaned text to Microsoft Edge's free neural TTS engine at your chosen speed
4. Plays the audio through your speakers via `afplay` (macOS)

The result: every time Claude finishes a response, it's read aloud automatically.

## Requirements

- macOS (uses `afplay` for audio playback)
- Python 3.8+
- Claude Code CLI
- Internet connection (Edge TTS streams from Microsoft's servers)

## Installation

**1. Clone and run the installer:**

```bash
git clone https://github.com/hannahstanek/claude-tts-hook
cd claude-tts-hook
chmod +x install.sh && ./install.sh
```

The installer will:
- Install the `edge-tts` Python package
- Copy `tts_hook.py` to `~/.claude/scripts/`
- Auto-inject the Stop hook into `~/.claude/settings.json`
- Add all listen commands to your shell config

**2. Reload your shell:**

```bash
source ~/.zshrc
```

## How Commands Work

All listen commands are run directly in your **terminal** — not inside Claude Code, not through Codex or any other AI tool. They are shell aliases that adjust your settings instantly.

```
Your terminal  →  listen-on / listen-speed 1.2 / listen-stop
Claude Code    →  where you have AI conversations (responses get read aloud automatically)
```

Think of the listen commands as controls you adjust from your terminal, and Claude Code as the thing that benefits from those settings. You never need to tell Claude Code to "use listen mode" — it happens automatically via the hook whenever Claude finishes a response.

## Commands

| Command | What it does |
|---|---|
| `listen-on` | Enable — Aria reads every Claude response aloud |
| `listen-off` | Disable — silent mode |
| `listen` | Show current status and speed |
| `listen-stop` | Immediately stop audio mid-response |
| `listen-speed 1.2` | Set any speed (0.5 to 2.0, e.g. 1.1, 1.3, 1.75) |
| `listen-slow` | 0.5x preset |
| `listen-normal` | 1.0x preset (default) |
| `listen-fast` | 1.5x preset |

Listen mode is **off by default** and persists across sessions.

### Speed control

`listen-speed` accepts any decimal multiplier:

```bash
listen-speed 0.5    # half speed
listen-speed 0.8    # slightly slower
listen-speed 1.0    # normal
listen-speed 1.1    # slightly faster
listen-speed 1.2    # noticeably faster
listen-speed 1.5    # fast
listen-speed 2.0    # double speed
```

Check your current speed anytime with `listen`.

## Changing the Voice

The default voice is **Aria** (`en-US-AriaNeural`). To use a different voice, open `~/.claude/scripts/tts_hook.py` and change the `VOICE` constant.

List all available neural voices:

```bash
edge-tts --list-voices | grep en-US
```

Some good options:

| Voice | Style |
|---|---|
| `en-US-AriaNeural` | Female, natural and warm (default) |
| `en-US-JennyNeural` | Female, clear and conversational |
| `en-US-GuyNeural` | Male, calm and professional |
| `en-US-DavisNeural` | Male, expressive |

## What Gets Skipped

The script strips the following before speaking:

- Fenced code blocks (` ``` `)
- Inline code (`` ` ``)
- URLs
- Markdown headers, bold, italic
- Table rows
- Bullet/numbered list markers (content is still read)

Responses over 600 words are truncated and Aria will say "response truncated" so you know to scroll for the rest.

## Hands-Free Workflow

This hook covers the **output** side. For the **input** side (speaking your prompts), use any system-wide dictation tool:

- **[Wispr Flow](https://wisprflow.ai)** — high-accuracy AI dictation that types into any app, including the Claude Code terminal
- macOS built-in dictation (System Settings → Keyboard → Dictation)

Combined workflow:
1. Activate dictation → speak your prompt → it types into Claude Code
2. Claude generates a response
3. Hook fires → Aria reads the response aloud at your chosen speed
4. Speak your next prompt

Fully hands-free, no screen reading required.

## Manual Hook Setup

If you prefer not to use the installer, add this to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 ~/.claude/scripts/tts_hook.py",
            "async": true
          }
        ]
      }
    ]
  }
}
```

## Troubleshooting

**TTS isn't speaking:**
- Run `listen` to check if it's enabled
- Check `edge-tts` is installed: `edge-tts --version`
- Confirm the hook is in `~/.claude/settings.json`

**Audio is delayed:**
- Edge TTS requires a network request. On slow connections there may be a 1-2 second delay.

**Want offline TTS:**
- Replace the `speak()` function body with: `subprocess.run(["say", "-r", "220", text])`
- Quality will be lower but works without internet.

**Need to stop audio immediately:**
- Run `listen-stop`

## License

MIT
