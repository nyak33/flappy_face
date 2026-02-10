# Flappy Face

Flappy Face is a lightweight, browser-based Flappy Bird clone that lets you play using your own face (or a built-in character). Upload or capture a photo, crop it into a circle, and flap through the pipes.

## Features
- Face picker with built-in characters (bird, chicken, fish, dino)
- Upload a photo or use the camera, then crop with drag/zoom/rotate
- Sound effects with a toggle
- Pause/resume
- Best score saved in `localStorage`
- Works offline as a PWA (service worker + manifest)

## Controls
- Click / tap / `Space`: flap (and start/restart)
- `P`: pause/resume
- On-screen buttons: sound toggle, upload face, pause

## Run Locally
This is a static app. Any static server works.

1. Open `index.html` directly in a browser, or
2. Run a local server (recommended so the service worker registers):

```bash
# From this folder
python -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

## PWA Notes
- The service worker registers on page load.
- The app stores your selected face and best score in `localStorage`.
- Saved faces auto-expire after ~30 minutes of inactivity.

## Tech
- Vanilla HTML/CSS/JS
- Canvas rendering
- Web Audio API for sound
- MediaDevices getUserMedia for camera capture

## License
Add a license if you plan to distribute this project.
