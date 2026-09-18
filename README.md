# Bathroom Timer — installable timer app for Android & iPhone

A countdown timer with repeating interval alerts and a synthesized **smooth jazz
trumpet** completion sound. It is built as a **PWA (Progressive Web App)**, so the
same code installs to the home screen and runs full-screen and offline on both
**Android** and **iOS** — no app store, no build toolchain.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The whole app: UI, timer logic, trumpet sound synthesis |
| `manifest.webmanifest` | App name, icons, colours, standalone display mode |
| `sw.js` | Service worker — offline app shell |
| `icons/` | App icons (192/512 + maskable + Apple touch icon) |
| `tools/serve.mjs` | Zero-dependency local/LAN test server |
| `tools/make-icons.mjs` | Regenerates the icon PNGs |
| `tools/test-schedule.mjs` | Test: asserts alerts are queued for screen-off playback |

## Run it locally

```bash
node tools/serve.mjs 8099
```

Then open `http://localhost:8099/`. The printed `Network:` URL is reachable from a
phone on the same Wi-Fi.

## Install on a phone

### Android (Chrome / Edge / Samsung Internet)
1. Open the app URL.
2. Tap the **Add to Home Screen** button that appears in the app, or use the
   browser menu → *Install app* / *Add to Home screen*.
3. Launch it from the home screen — it opens full-screen with no browser UI.

### iPhone / iPad (Safari)
1. Open the app URL **in Safari** (Chrome on iOS cannot install web apps).
2. Tap the **Share** button (square with an arrow).
3. Choose **Add to Home Screen** → **Add**.

> **HTTPS note:** offline caching (the service worker) only activates on
> `https://` or `localhost`. Over a plain `http://192.168.x.x` LAN address the app
> still works and still installs to the home screen — it just won't cache for
> offline use. For full offline behaviour, host the folder on any static HTTPS
> host (GitHub Pages, Netlify drop, Cloudflare Pages, Vercel) — just upload these
> files as-is.

## How the alerts work

- **Timer duration** — hours / minutes / seconds, plus 1/5/10/25-minute presets.
- **Completion sound interval** — how often the trumpet fires during the run.
  Example: duration `20 min`, interval `10 min` → it rings at 10 min and 20 min.
- **Intermediate intervals** ring the trumpet and blink the ring **6 times**, then
  stop automatically. The timer keeps running and the user cannot cancel them.
- **The final interval** (timer end) rings and blinks **continuously** until the
  user presses **Reset** or **Clear**.
- **Start is blocked** while the final alert is still ringing — press Reset or
  Clear first.
- **🎺 Test** previews the sound at any time.

## Playing the trumpet while the screen is off

Phones **freeze page JavaScript** when the screen sleeps or the app is
backgrounded, so a `setInterval`-driven alarm simply never fires. This app does
not rely on JavaScript at alert time:

1. **Every alert is pre-scheduled on the audio thread.** When you press Start, the
   trumpet phrase is rendered once into an audio buffer and each alert is queued
   with an exact `AudioContext` timestamp — the intermediate ones as 6-repeat
   loops, the final one as an endless loop. The audio thread keeps rendering even
   while page JavaScript is completely frozen, so the sound fires on time.
2. **A real audio session is held open** so the OS keeps that audio thread alive:
   - `navigator.audioSession.type = 'playback'` (iOS 16.4+) marks the page as media
     playback, which keeps audio running with the screen locked **and makes it
     ignore the iPhone silent switch**.
   - a silent looping `<audio>` element + **Media Session** metadata make the app
     count as background media (Android shows it as a playing media item).
   - an inaudible ~30 Hz keep-alive tone (-62 dBFS) stops the browser from
     suspending the audio context while nothing is ringing.
3. **Drift correction** — when you return to the app, the queue is only rebuilt if
   the audio clock actually slipped (>0.5 s) or the OS suspended the context, so a
   ring in progress is never cut short.

Verify the scheduling logic at any time:

```bash
node tools/test-schedule.mjs
```

It runs the real code from `index.html` against a stubbed Web Audio API and
asserts a 20-minute/10-minute setup queues a 6-ring alert at 10 min, an endless
alert at 20 min, and that Reset cancels both.

### Limits worth knowing
- **Don't swipe the app away.** Alerts survive a locked screen and backgrounding,
  but force-quitting the app destroys the queued audio. (If the timer already
  expired while closed, the alert fires as soon as you reopen it.)
- **iOS below 16.4** lacks `audioSession`, so audio may still stop when locked —
  keep the app in the foreground on older iPhones.
- **Aggressive battery savers** (some Android OEM skins) can kill background tabs;
  allow background activity / disable battery optimisation for your browser if
  alerts are missed.
- **Android may show a media notification** while the timer runs — that is the
  background audio session; leave it in place.

## Mobile-specific behaviour

- **Accurate in the background** — the countdown is anchored to a wall-clock
  deadline, so it stays correct even when the phone throttles timers or the screen
  sleeps; it re-syncs the moment you return to the app.
- **Survives being closed** — timer state is saved, so reopening the app resumes
  the countdown (or fires the final alert if the time already passed).
- **Screen wake lock** — on Android/Chromium the screen is kept awake while the
  timer runs, so alerts are not missed.
- **Audio unlock** — mobile browsers only allow sound after a tap, so the audio
  engine is unlocked on your first touch.
- **Vibration** accompanies each alert on Android (iOS Safari does not expose it).
- **Safe-area insets**, 52px touch targets, and 16px inputs (prevents iOS zoom-on-focus).

### iPhone caveats
- On **iOS 16.4+** the app requests a `playback` audio session, which also makes
  the trumpet ignore the silent switch. On **older iOS**, the silent/ring switch
  mutes Web Audio — turn silent mode **off** there.
- The Screen Wake Lock API is unavailable on iOS, so the screen still sleeps; the
  pre-scheduled audio is what keeps the alert working in that state.

## Regenerate icons

```bash
node tools/make-icons.mjs .
```

## Optional: native store builds

If you later want real `.apk` / `.ipa` store binaries, this PWA can be wrapped
with [Capacitor](https://capacitorjs.com/) or
[PWABuilder](https://www.pwabuilder.com/) without changing the app code. Building
Android needs Android Studio; building iOS needs a Mac with Xcode.
