# v3.8.29 — Dock redesign + execution motion

## Dock interaction
- Removed the `SM` monogram from the 163 mailbox Dock.
- Replaced it with an abstract route/node glyph that represents deterministic mail flow.
- The primary Dock surface is now a true first-level action: one click opens the SmartMail main workspace (`#batch`).
- Execution details are separated into a small secondary chevron that only appears while an execution context exists.
- `Alt+M` now follows the same first-level behavior and opens the main SmartMail workspace directly.

## Live execution motion
- When execution starts, the compact Dock expands into a restrained live capsule instead of opening a menu.
- A small runner travels along the route glyph while a batch is running.
- The bottom edge becomes the real batch progress track with a moving progress head.
- Each execution phase updates the live label and a five-node detail track: open → content → attachments → schedule → save/cleanup.
- Phase transitions create a short structural pulse rather than a generic spinner.
- A confirmed message completion produces one restrained commit pulse.
- Paused, completed, stopped, and error states switch the motion/color language without changing layout.
- Pause/error states surface the detail sheet automatically because they require attention; normal execution does not interrupt the mailbox.
- Successful completion stays visible briefly, then collapses back to the idle Dock.

## Accessibility / performance
- Motion uses only transform/opacity/width/progress properties and remains local to the small Dock surface.
- `prefers-reduced-motion` disables all nonessential animations.
