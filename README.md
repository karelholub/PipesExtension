# Meiro Event Simulator Chrome Extension

Manifest V3 developer extension for injecting or simulating Meiro-style event collection on the current website. It is intended for debugging, QA, demos, and implementation prototyping without changing the website source code.

## Load the Extension

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `/Users/kh/pipesExtension`.
5. Open any normal web page, click the extension icon, then click **Enable on this tab**.
6. Click **Workbench** from the popup to inspect SDK setup, data layers, DOM mappings, and event delivery for that same tab.

Chrome does not allow extension injection on restricted pages such as `chrome://`, the Chrome Web Store, or some browser-owned pages.

After a tab is enabled, the extension collects events continuously in real time. Enabled tabs are remembered, the content script is reattached after page reloads, and the workbench refreshes live while it is open. Use **Disable** when you want collection on that tab to stop.

## DevTools Integration

The extension also installs Chrome DevTools tooling:

- A full **Meiro Workbench** panel in DevTools
- A **Meiro** sidebar pane in the Elements panel

Use it like this:

1. Open a website.
2. Right-click the page and choose **Inspect**.
3. Open the **Meiro Workbench** DevTools tab, or open the **Elements** panel and select the **Meiro** sidebar.
4. Click **Enable tab** from the workbench if tracking is not already active.

When enabling from DevTools, Chrome may ask for permission to access the inspected site origin. This is required because the DevTools panel does not receive the same temporary `activeTab` permission as the toolbar popup.

## Defaults

```json
{
  "sdk_source_url": "https://meiro-internal.eu.pipes.meiro.io/mpt.js",
  "collection_endpoint": "https://meiro-internal.eu.pipes.meiro.io/collect/meiro-io",
  "user_id": "a04b882d-f5a6-42a7-8a17-4b17c7129d48"
}
```

The defaults are already in `src/shared/constants.js`. Change them in the options page if you need another environment.

## Configuration

Open the extension popup and click **Options**. The options page supports:

- SDK source URL
- Collection endpoint
- App or project key
- Prism base URL and Prism API token for direct Pipes configuration from the extension
- Profile API token (`mppak_...`) and Profile API path (default `/profile-api/extension`) for profile lookups; the token is sent as an `X-API-Token` header against the Prism base URL
- User ID, with paste support or one-click random UUID generation
- Global tracking enabled/disabled
- Debug logging
- Consent override
- Sending allowed when consent override is off
- SDK web layers and banner display
- Mode selector: `inject_sdk`, `simulate_only`, or `hybrid`
- Optional scroll depth, outbound click, and file download metadata

When saving a custom endpoint, Chrome may ask for host permission for that endpoint origin. This is required so the service worker can send cross-origin `fetch` POST requests.

The Prism API token and Profile API token are stored in `chrome.storage.local`, not sync storage, so they stay local to the browser profile where the extension is installed.

## Modes

Each mode now maps to exactly one transport, so a real Pipes source never receives duplicate or conflicting traffic for the same interaction:

`inject_sdk`

Injects the configured SDK source into the page context and forwards every captured interaction to it only — the extension's own collector never POSTs to `collection_endpoint` in this mode. If `window.mpt` is present, the page bridge calls `mpt("config", ...)`, applies the configured consent triple when consent override is on, and forwards events via `mpt("event", ...)`. Only event names in the SDK's predefined GA4-style vocabulary (see `GA4_STANDARD_EVENT_NAMES` in `src/shared/constants.js`) are forwarded; custom selector-rule/recipe event types are skipped because the real SDK would reject them client-side. The outcome of each forward attempt (accepted, rejected, or no SDK detected) is still recorded in the debug log/workbench, tagged `sdk_forward`, without any network request from the extension. If no known global tracking function is detected at all, no fallback POST is made — this is intentionally a pure "what would the real SDK actually do" test.

`simulate_only`

Does not inject the external SDK and never touches `window.mpt`. The content script observes browser and DOM events, builds the extension's own Meiro/Pipes-style payload, and POSTs it directly to `collection_endpoint` through the extension service worker — useful for exercising a webhook-style source's transform function independent of any SDK behavior.

`hybrid`

Does both, for side-by-side comparison: the SDK forward attempt (subject to the same standard-vocabulary gating as `inject_sdk`) and the extension's own direct POST. Log entries are tagged with `transport.kind` (`sdk_forward` vs `extension_direct`) and `transport.mode` so the two streams are distinguishable in the debug log and workbench.

## Consent

Consent is modeled as three independent axes, matching the real SDK's `mpt("consent", ...)` contract: `storage_persistence`, `user_id`, and `session_id`, each `granted` or `denied`. Configure them in Options. "Consent override" controls whether the extension declares this consent state to the page's real SDK at all (only relevant in `inject_sdk`/`hybrid` mode); when it's off, the real page's own consent management (CMP) stays in control and the extension does not call `mpt("consent", ...)`. "Sending allowed" is unrelated to the SDK — it only permits the extension's own direct POST transport to run while consent override is off.

## Captured Events

The extension captures, using the real SDK's predefined event names where a direct match exists:

- `page_view` on initial enablement
- SPA route-change `page_view` events
- `click`
- `form_submit`
- `scroll` at 25, 50, 75, 90, and 100 percent scroll depth (`custom_payload.depth_percent`) when enabled
- `file_download` when a clicked link points at a known downloadable file extension

`outbound_link_click`, plus any selector-rule/recipe-driven event type, are extension-specific custom names with no predefined-vocabulary counterpart. They are always included in the extension's own direct POST (useful for testing custom source transforms) but are never forwarded to a real `window.mpt` SDK.

Click payloads include text, element tag, href, id, classes, selector, coordinates, outbound marker, and file download marker.

Form payloads include form action, method, id, classes, selector, and input metadata. The extension does **not** collect input values. Passwords, card fields, CVV/CVC, SSN/national ID, token, secret, auth, CSRF, OTP, and PIN-like fields are explicitly marked as excluded.

## SPA Tracking

The content script injects `src/injected/page-bridge.js` into the page context. The bridge patches `history.pushState` and `history.replaceState`, listens to `popstate`, and emits a custom route-change event back to the content script. This is needed because regular content scripts run in an isolated JavaScript world and cannot reliably observe app-level history patching on their own.

## Debug Logs

Open **Debug log** from the popup or options page. The debug page shows:

- event type
- timestamp
- outgoing payload
- endpoint
- response status
- validation or network errors

The log is stored in `chrome.storage.local` and keeps the latest 200 entries. Use **Export JSON** to download the current log.

When debug mode is enabled, useful messages are also printed to the page console and extension service worker console.

## Admin Workbench

The workbench is now organized around operator workflows instead of technical tabs. It is designed for admins and implementers working with event collection, data layer mapping, behavioral tracking, and CDP-oriented signal inspection.

Primary workflow areas:

- **Overview**: readiness checks, source coverage, and a mixed live timeline combining data layer pushes, captured events, and tracking-related network resources
- **Signals**: data layer, cookies, query params, local/session storage, meta tags, tracker globals, consent hints, tracking-related resource inspection, and live tracking-request observation
- **Event Builder**: element picker, selector rule creation, detected forms, and interactive DOM elements
- **Validation**: event catalog, contract failures, PII warnings, fix suggestions, and event diffing
- **Delivery**: endpoint outcomes, replay, transport latency/size hints, and tab-scoped delivery logs
- **Profiles**: environment profiles and payload contract editing

It includes:

- DevTools panel and Elements sidebar support for inspect-first workflows
- Persistent workbench UI state, so the active view, sidebar mode, and operator filters survive reloads
- Collapsible rail mode for narrow DevTools layouts, so the panel stays usable without horizontal scrolling
- Tab-scoped logs, so the workbench focuses on the currently inspected site instead of mixing unrelated tabs
- Live refresh while the workbench is open
- Readiness checklist for tracking state, endpoint, user ID, SDK URL, SDK detection, data layers, page views, and successful endpoint responses
- Source coverage summary across data layers, storage, cookies, globals, meta tags, and tracking-related resources
- Live observation of tracking-like `fetch` and `XMLHttpRequest` calls from the inspected page, with method, status, duration, request size, and sanitized request/response previews
- Web layer and banner debugging signals, including likely SDK banner requests, served/failed status, and rendered DOM clues
- Event inspector with payload validation, PII warnings, copy, and replay
- Direct Pipes source control: when the collect endpoint reports an unknown `event_type`, the workbench can create that Event Type on the resolved source without leaving the extension, including inferred schema and identifier rules when a sample is available
- Pipes setup queue that summarizes captured Event Types missing from Pipes or recently failing delivery, with one-click definition sync from captured payloads
- Event Type sync from validation cards, creating missing definitions or additively updating existing definitions with inferred schema and identifier rules
- Router-side source validation from captured events, so admins can verify whether the Pipes source transform emits valid Event Router events before replaying traffic
- Inline Event Type management for the resolved source, including JSON Schema and identifier-rule editing, with delete support (two-step confirm)
- Identifier type merge/overflow limits (`maxIdentifiers`, `priority`) surfaced directly, instead of just names, so admins can see profile-merge behavior without leaving the extension
- Event routing visibility: which Pipes (Delivery) route this source's events onward, to which Event Destination, enable/disable toggling, and on-demand delivery inspection — separate from ingestion/Event Types
- Event journey tracer: a Trace action on validation entries follows one captured event step-by-step — capture, /collect delivery, transform output, Event Type definition, identifier extraction, routing, and recent downstream deliveries — and reports where the journey breaks
- Profile lookup: query the Pipes Profile API (`identifier_type` + `identifier_value`, type picked from the source's available identifier types, value prefilled with the configured user ID) to confirm identity resolution stitched captured events onto a unified profile
- Transform regression tests: pin captured payloads as named test cases (snapshotting expected event count/types/identifiers), then re-run the whole suite against the live transform after edits to catch drift
- Instance health panel in Overview: ingestion queue status, dashboard volume, and error stats from the connected Pipes instance, to explain accepted-but-not-visible situations
- dataLayer → tracking rules generator: turns observed dataLayer event pushes into on.dataLayer(...) tracking-rule stubs, auto-mapped to predefined Web SDK event names where possible
- Selector coverage overlay: highlights elements covered by selector rules and tracking-rule selectors (solid green) versus untracked interactive elements (dashed red) directly on the inspected page
- Identity-resolution simulator: local simulation of the documented merge/overflow algorithm using the source's identifier rules and each identifier type's maxIdentifiers/priority, run against captured events
- Event Type preview checks that validate the configured JSON Schema and show identifier-rule extraction results against source-test output or recent captured examples before saving to Pipes
- One-click JSON Schema inference for Event Types from source-test output or recent captured payloads
- Identifier-rule builder that uses Pipes identifier types and payload-path suggestions so admins can add rules without hand-writing JSON
- Source transform test harness that runs the current source function against recent example payloads from Pipes
- Structured source test inspector with emitted events, identifier extraction, validation errors, transform logs, and raw JSON output
- Tracking rules editor for the resolved source, including generation from local selector rules and saving to Pipes
- Source transform editor for updating the resolved source function after testing changes
- SDK setup diagnostics for matching script tags, likely Meiro globals, injected SDK state, consent APIs, and CSP meta tags
- Data layer inspector for `dataLayer`, `digitalData`, `utag_data`, or custom global names
- Data layer push history captured after tracking is enabled
- DOM element picker that creates selector-based mapping rules
- Built-in mapping recipes for common tracking patterns such as CTA clicks, outbound links, file downloads, lead forms, and newsletter signups
- Selector robustness warnings for brittle selectors
- Event diffing to compare two captured payloads path-by-path inside the workbench
- Timeline, validation, and delivery filters for narrowing the live stream to the event types or issue classes you are actively debugging
- Payload contract editor for required paths per event type
- Environment profiles for saving and applying SDK/endpoint/user/rule configurations
- Setup export as JSON for handoff to implementation teams

Selector rules run on click events. A matching rule emits the configured custom event type with selector, text, href, coordinates, tag, id, and classes.

## Manual Custom Events

The popup includes a **Custom event** field and **Send** button. This sends a custom event from the currently enabled tab with a small metadata payload:

```json
{
  "source": "popup",
  "sent_by": "manual_button"
}
```

## Payload Samples

See `examples/payloads.json` for sample `page_view`, `click`, and `form_submit` payloads.

## Extension Structure

```text
manifest.json
src/background/service-worker.js
src/content/content-script.js
src/injected/page-bridge.js
src/shared/constants.js
src/shared/browser-utils.js
src/shared/payload-builder.js
popup/popup.html
popup/popup.css
popup/popup.js
options/options.html
options/options.css
options/options.js
debug/debug.html
debug/debug.css
debug/debug.js
devtools/devtools.html
devtools/devtools.js
workbench/workbench.html
workbench/workbench.css
workbench/workbench.js
examples/payloads.json
README.md
```

## Meiro-Specific Integration Notes

The current page bridge tries several generic SDK APIs such as `Meiro.track` and `MeiroEvents.track`. Real Meiro SDK deployments may expose different methods, queue names, or initialization semantics. Expand `callPotentialSdkApi` in `src/injected/page-bridge.js` when a concrete SDK contract is available.

The transport currently posts the event JSON directly to `collection_endpoint` and optionally sends `X-App-Key` when `app_key` is configured. Adjust `postEvent` in `src/background/service-worker.js` if your collector expects a different envelope, authentication header, or batching format.

## Limitations

- The extension only tracks tabs where it has been manually enabled from the popup.
- Enabled tabs continue collecting after reloads when the inspected site permission has been granted.
- It cannot run on Chrome restricted pages.
- A custom endpoint needs Chrome host permission before events can be sent.
- Some sites may block external SDK script tags with a strict page Content Security Policy.
- SDK API forwarding is best-effort until the exact Meiro SDK browser API is known.
- The simulated collector intentionally avoids raw form values, so it is useful for behavioral QA but not for testing payloads that require submitted field values.
