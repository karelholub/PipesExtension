---
target: meiro workbench
total_score: 25
p0_count: 0
p1_count: 2
timestamp: 2026-07-09T06-03-01Z
slug: workbench-workbench-html
---
⚠️ DEGRADED: single-context (sub-agent tool is exposed, but its own policy forbids spawning unless the user explicitly asks for delegated/parallel agent work)

Target: workbench/workbench.html

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Live/offline state exists, but disconnected/static failure collapses into raw technical error text. |
| 2 | Match System / Real World | 3 | Strong operator vocabulary, though "Profiles" contains unrelated source/admin functions. |
| 3 | User Control and Freedom | 3 | Clear enable/disable/refresh controls; sidebar collapse exists. |
| 4 | Consistency and Standards | 3 | Consistent cards/forms/buttons, but nav/button hidden short labels create noisy accessible text. |
| 5 | Error Prevention | 2 | High-risk save actions sit beside editors with little preview gating or guardrail hierarchy. |
| 6 | Recognition Rather Than Recall | 3 | Workflow navigation helps; nested admin tools still require domain memory. |
| 7 | Flexibility and Efficiency | 3 | Persistent filters/state and DevTools usage are good; missing web-layer/page-view filters weaken new debugging flow. |
| 8 | Aesthetic and Minimalist Design | 2 | Card-heavy, sparse when empty, and visually under-prioritized for the debugging task. |
| 9 | Error Recovery | 2 | Errors surface, but raw messages do not explain what to do next. |
| 10 | Help and Documentation | 2 | Empty states are generic and do not teach next debugging steps. |
| **Total** | | **25/40** | **Functional but not yet confident under real operator stress.** |

## Anti-Patterns Verdict

**LLM assessment**: The Workbench does not read as flashy AI slop. It is a sober product UI with a sensible left rail and workflow views. Its main weakness is the opposite: it feels like a scaffolding shell. Large blank cards, uniform surfaces, generic card hierarchy, and raw JSON-heavy presentation make the product feel less decisive than the debugging problem deserves.

**Deterministic scan**: `node /Users/kh/.cursor/skills/impeccable/scripts/detect.mjs workbench/workbench.html workbench/workbench.css workbench/workbench.js` found 1 issue:
- `workbench/workbench.css:3` `[overused-font] font-family: Inter`

`node /Users/kh/.cursor/skills/impeccable/scripts/detect.mjs --json workbench/workbench.html` returned `[]`. URL scan was attempted against `http://127.0.0.1:8765/workbench/workbench.html`, but the detector reported Puppeteer is not installed, so automated browser overlays were unavailable.

**Visual overlays**: No reliable user-visible Impeccable overlay is available for this run. Browser inspection did succeed via local screenshot/evaluation. Desktop layout rendered, and the narrow 390px viewport exposed a severe responsive layout bug.

## Overall Impression

The Workbench has the right bones: workflow-based navigation, live signal panels, validation, delivery, and source control. The biggest opportunity is to make the debugging path feel guided and resilient instead of exposing a wall of similarly weighted containers. For the specific web-layer/banner debugging use case, it needs sharper status hierarchy and filters that match the new signal types.

## What's Working

1. The left navigation maps to real operator tasks rather than implementation modules: Overview, Signals, Builder, Validation, Delivery, Profiles.
2. The Workbench already preserves useful operator state: active view, filters, sidebar mode, editor state, and scroll positions.
3. The recent web-layer additions are placed in the right conceptual areas: Overview, Source coverage, Signals, and Timeline.

## Priority Issues

**[P1] Narrow DevTools layouts are broken**

Why it matters: At 390px, the sidebar keeps its fixed desktop column and the content gets squeezed into a narrow strip. This is exactly the kind of width a DevTools panel or split browser can hit.

Fix: Reorder or rewrite the media queries in `workbench/workbench.css` so the `max-width: 980px` single-column rule wins after the `max-width: 1280px` rule. Also verify rail mode and DevTools widths around 360, 480, 768, and 980px.

Suggested command: `/impeccable adapt meiro workbench`

**[P1] Empty and disconnected states do not guide debugging**

Why it matters: In the static/disconnected state, the UI shows "Cannot read properties of undefined (reading 'query')" and mostly empty cards. A banner debugging tool should immediately tell the operator what is missing: extension context, selected tab, enabled collection, SDK config, page_view, web-layer request, rendered DOM.

Fix: Replace raw top-level errors with a structured connection panel: current context, missing requirement, next action. In the Overview empty state, show a web-layer debugging checklist instead of blank Readiness/Source coverage cards.

Suggested command: `/impeccable harden meiro workbench`

**[P2] Timeline filtering does not match the new signal model**

Why it matters: The Workbench now emits `web_layer` timeline items, but the timeline dropdown has no Web layers option. The Page views option uses `value="page_view"`, while timeline filtering compares against `item.kind`, so it will not match normal event timeline items unless special-cased.

Fix: Add a `web_layer` filter option. Change filter logic so event subtype filters can match `item.source.event_type` / `item.label`, while transport filters still match `item.kind`.

Suggested command: `/impeccable polish meiro workbench`

**[P2] Profiles is carrying too many unrelated admin jobs**

Why it matters: "Profiles" currently contains Pipes control, tracking rules, source transform, source transform test, event types, payload contracts, and environment profiles. That makes critical source-admin actions feel buried and increases cognitive load.

Fix: Split this into clearer modes, likely "Pipes" or "Source Admin" plus "Profiles". Keep environment profiles focused on environment switching, not transform editing.

Suggested command: `/impeccable layout meiro workbench`

**[P3] The visual system is competent but generic**

Why it matters: Generic product UI is acceptable here, but the current card-heavy shell makes all work equally important. Debugging banners needs a stronger primary narrative: request served, eligibility, blocked, rendered.

Fix: Keep the restrained palette, but introduce stronger state rows, denser diagnostic tables, and a dedicated web-layer status strip. Treat cards as containers for repeated entities, not every page section.

Suggested command: `/impeccable colorize meiro workbench`

## Persona Red Flags

**Priya (Implementation Engineer debugging SDK setup)**: She lands on Overview and sees empty Readiness/Source coverage cards plus a raw error. She has to infer whether the issue is extension context, tab connection, SDK injection, or page targeting.

**Matej (CDP Admin validating a campaign)**: He needs to know whether a pop-up was eligible, served, blocked, or rendered. The new web-layer data exists, but it is spread across metrics, Signals JSON, and timeline, with no purpose-built diagnostic sequence.

**Alex (Power User in DevTools split view)**: At narrow widths, the Workbench becomes unusable because content compresses to a thin column. This is a high-risk failure for the most likely usage environment.

## Minor Observations

- `Inter` is flagged by the detector, but in a product/debugging tool this is a low-priority issue; system familiarity is acceptable.
- The nav buttons include hidden short labels in text extraction (`OvrOverview`, `SigSignals`). Visually okay, but worth checking accessible names.
- The sidebar error color `#b42318` on dark `#14202a` has about 2.52:1 contrast, below WCAG body text contrast.
- The Workbench uses many same-weight cards. A table/list vocabulary would better fit diagnostic scanning.

## Questions to Consider

- Should web-layer debugging have a dedicated first-class panel instead of being distributed across Overview and Signals?
- What is the single most important operator question: "Was a banner eligible?", "Was it served?", or "Why did it not render?"
- Should source-transform editing live beside environment profiles, or does it deserve its own Source Admin workflow?
