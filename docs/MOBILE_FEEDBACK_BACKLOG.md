# Mobile / APK feedback backlog

**Process:** Collect notes here. Ship in **bulk** when ready — not one-by-one pushes.

---

## How to add items

- Append under **Open** with date + short note.
- When bulk ships, move items to **Done**.

---

## Open

### Audio: load MP3 → OGG for `.indies` (parked for next batch)

5. **MP3 (etc.) in, real OGG out — separate convert if heavy**  
   - Export still renames without re-encoding (don’t ship wrong packages).  
   - Prefer separate connected convert step on mobile; desktop can encode in-process later.  
   - **Not in batch 1** — keep charting smooth first.

---

## Done

### Batch 1 — 2026-07-15 (mobile smoothness + layout)

| Item | Resolution |
|------|------------|
| Portrait vs landscape choice | **Removed.** Single **Mobile charting** shell (tall highway + side overview). Old portrait/landscape prefs migrate to `mobile`. |
| Landscape-on-portrait-lock looks better | That shell is now **the** mobile layout. |
| More highway / less bottom buffer | Side overview only on mobile; no bottom scroll strip. |
| Tool hint blocks highway | **Tap to dismiss** + **auto-hide after 10s**; shows again when Edit/Seek tool changes. |
| Audio lag / heavy phone | Cap canvas DPR 1.25; flat gems/receptors (no gradients/shadows); single mono wave strip; cheaper strike/phase cues; coarser wave peaks; overview simplified. |
| Gradients / simplify wave / lighter strike | As above. |

---

## Parked / later

_(none beyond open OGG convert)_
