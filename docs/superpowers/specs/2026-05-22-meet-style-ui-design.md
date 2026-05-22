# Design: Google Meet–style video chat UI

**Status:** Approved
**Date:** 2026-05-22

## Goal

Replace the current dashboard-grid layout (settings sidebar + call container + transcript box + visualizers) with a clean Google Meet–style video calling experience. Two screens: a pre-call lobby and an immersive in-call view. Captions overlay replaces the inline transcript list. Fully responsive — desktop and mobile (no separate mobile build).

## Two screens

### Lobby (when `state === 'INACTIVE'`)

- Dark full-screen layout, centered card (~960px max width).
- **Left pane:** local camera preview (16:9 on desktop, 9:16 portrait on mobile). Shows "Camera Off" pill with a microphone-style avatar when camera is off. Includes small mic/camera toggle pills overlaid at bottom-left of the preview (just like Meet's pre-call screen).
- **Right pane:** "Ready to join?" heading. Avatar dropdown, voice dropdown, **Join now** button (rounded, accent color, full-width). Below: a one-line tip about barge-in.
- Top-left header: app logo + "LiveCall AI".
- Stacks vertically on mobile (<768px): preview on top, controls below.

### In-call (when `state !== 'INACTIVE'`)

- Avatar `<video>` fills the entire viewport, `object-fit: cover`, no margins.
- **User PiP** (top-right):
  - Desktop: 240×135 (16:9), 12px from top-right corner.
  - Mobile: 112×150 (9:16), 8px from top-right corner.
  - Tap toggles camera on/off. Off state shows a circular monogram tile.
- **Captions overlay** (bottom-center, above controls):
  - Semi-transparent black background, rounded, white text.
  - Shows at most 2 lines: the latest user utterance (smaller, dimmer) and the assistant's currently-streaming reply (larger, brighter).
  - Auto-fades after 6s of no new deltas; reappears on next delta.
  - Toggled by **CC** button. Default ON.
  - Max width 640px desktop, full width minus 24px mobile.
- **Status pill** (top-left): connection dot + state text. Hides when state is CONNECTED for 3 seconds.
- **Control bar** (bottom-center, below captions):
  - Pill-shaped, semi-transparent dark surface.
  - Buttons: Mic, Camera, CC (toggle captions), End call (red, slightly larger).
  - Desktop hover shows label tooltip.
  - Mobile: full-width minus 16px margins, larger touch targets (52px).

## Components

Single component `src/App.tsx` keeps its current responsibility (orchestrating realtime + avatar clients) but its JSX is restructured into two sub-blocks:

```tsx
{state === 'INACTIVE' ? <Lobby/> : <CallView/>}
```

Both blocks can be inlined as JSX inside `App.tsx` to avoid premature componentization (YAGNI). If either grows past ~150 lines, split into `src/components/Lobby.tsx` and `src/components/CallView.tsx`.

## State additions

- `captionsOn: boolean` — defaults `true`. Toggled by CC button.
- `liveAssistantCaption: string` — accumulates `onAssistantTranscriptDelta`; reset on `onAssistantTranscriptDone` or new user transcript.
- `liveUserCaption: string` — last user transcript text; updated on `onUserTranscript`.
- `captionFadeTimer: ref<setTimeout>` — kicks 6s after last assistant delta; on fire, sets a `captionsVisible` boolean to false.

Existing `transcripts` array stays in state but is no longer rendered as a list — it's still useful for future scrollback. (Strictly YAGNI says drop it; we keep it because removal is one-line if we change our mind.)

## Files touched

| Path | Change |
|---|---|
| `src/App.tsx` | Restructure JSX. Remove dashboard-grid / settings-panel / transcript-box / waveform-box. Add Lobby + CallView. Add caption state. |
| `src/index.css` | Strip layout sections (~600 lines). Add new sections (lobby, call-stage, user-pip, captions, controls-bar). |
| `src/App.css` | Delete (Vite scaffold leftover). |

## CSS architecture

- Mobile-first. Default styles target mobile; `@media (min-width: 768px)` upgrades to desktop.
- CSS variables kept from current `index.css` (colors, shadows). Strip unused layout vars.
- One stylesheet, no CSS-in-JS, no new dependencies.

## Responsive rules

| Element | Mobile (<768px) | Desktop (≥768px) |
|---|---|---|
| Lobby layout | stacked vertical | side-by-side |
| User PiP | 112×150 portrait | 240×135 landscape |
| Control bar | full-width minus 16px | 480px wide pill |
| Captions | full-width minus 24px | 640px max width |
| Button size | 52×52 (touch) | 44×44 |

## Captions: timing detail

- On `onAssistantTranscriptDelta(delta)`: append to `liveAssistantCaption`, reset fade timer (6s).
- On `onAssistantTranscriptDone(text)`: replace `liveAssistantCaption` with final text, reset fade timer.
- On `onUserTranscript(text)`: set `liveUserCaption = text`, push `liveAssistantCaption` to empty (assistant turn ended), reset fade timer.
- On fade timer fire: hide captions (CSS opacity 0). Any new delta unhides instantly.

## Out of scope

- Drag-to-reposition PiP.
- Full transcript scrollback / chat panel.
- Reactions, hand-raise, screen share.
- Immersive-mode toggle (call view IS immersive now).
- Sandbox mode UI toggle (always LITE mode).
- Settings drawer during call.
- Avatar/voice swap mid-call.
