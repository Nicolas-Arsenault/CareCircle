# The demo video, as code

The CareCircle demo is generated, not edited: a script drives the real app to capture its screens and replies, and an HTML motion-design scene animates the story around them. Re-run it whenever the app changes and the video stays current.

## What's in it (97 seconds, 1080p, 30 fps)

| Time | Scene |
|---|---|
| 0:00 | Title |
| 0:06 | The problem: Mom lives alone, Sarah lives three hours away |
| 0:15 | Morning check-in: Mom talks to Alexa, `log_checkin` flows to Lambda and DynamoDB |
| 0:32 | The real family dashboard, zooming in on the check-in and medication widgets |
| 0:41 | "Alexa, how's Mom today?" and the `get_status` answer |
| 0:53 | 10:00, no check-in: EventBridge, the checker Lambda, SNS, and the family's phone |
| 1:07 | Friday's doctor summary, with the week's numbers |
| 1:19 | Architecture: one MCP server, eight tools, serverless on AWS |
| 1:31 | Outro |

Every reply, tool call, time and alert in it comes from the real app (`captures/data.json`).

## Make it

Needs Node 20+, ffmpeg, and Python 3 with numpy. Run `npm install` in the repo root first.

```bash
cd video
npm install
npm run build        # capture, then render
```

Or step by step:

| Command | Does |
|---|---|
| `npm run capture` | Starts the app in emulated-AWS mode twice (a good morning, then a missed check-in), drives it with Playwright, and saves screens and replies to `captures/` |
| `npm run render` | Renders `scene.html` frame by frame to `out/carecircle-demo.mp4`, with a synthesized soundtrack |
| `npm run preview` | Serves the scene at <http://127.0.0.1:4173/scene.html> to watch it live (space pauses, arrows scrub, `?t=40` jumps) |

`node render.mjs --fps 60` renders smoother motion, `--stills 4,20,88` writes single frames, and `--gif` adds a looping GIF of the architecture scene. The committed copy, `docs/video/carecircle-hero.mp4`, is re-encoded at CRF 26 to keep the repo small.

## How it works

- **`capture.mjs`** picks a time zone where it's morning right now, so the clock on screen is believable whenever you record.
- **`scene.html`** is a pure function of time: `seek(t)` lays out the whole 1920x1080 stage for second `t`. Nothing depends on the wall clock, so every render is identical.
- **`render.mjs`** steps through `seek(t)` in headless Chromium and pipes JPEG frames into ffmpeg (H.264, CRF 20).
- **`music.py`** synthesizes the soundtrack (an ambient chord pad, a soft arpeggio, and chimes timed to the scene's cue points), so there's no music licence to worry about.
