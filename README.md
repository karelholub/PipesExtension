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
- User ID, with paste support or one-click random UUID generation
- Global tracking enabled/disabled
- Debug logging
- Consent override
- Sending allowed when consent override is off
- Mode selector: `inject_sdk`, `simulate_only`, or `hybrid`
- Optional scroll depth, outbound click, and file download metadata

When saving a custom endpoint, Chrome may ask for host permission for that endpoint origin. This is required so the service worker can send cross-origin `fetch` POST requests.

The Prism API token is stored in `chrome.storage.local`, not sync storage, so it stays local to the browser profile where the extension is installed.

## Modes

`inject_sdk`

Injects the configured SDK source into the page context. The extension still observes events and sends payloads through the service worker, because a generic Meiro SDK API cannot be assumed on every site. If a known global tracking function is detected, the page bridge also attempts to forward events to it.

`simulate_only`

Does not inject the external SDK. The content script observes browser and DOM events, builds Meiro/Pipes-style payloads, and sends them directly to the configured collection endpoint through the extension service worker.

`hybrid`

Injects the SDK and also runs simulated observers. This is the best mode for demos and QA because it gives visibility in the debug log even when the injected SDK behavior is opaque.

## Captured Events

The extension captures:

- `page_view` on initial enablement
- SPA route-change `page_view` events
- `click`
- `form_submit`
- `scroll_depth` at 25, 50, 75, 90, and 100 percent when enabled

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
- Event inspector with payload validation, PII warnings, copy, and replay
- Direct Pipes source control: when the collect endpoint reports an unknown `event_type`, the workbench can create that Event Type on the resolved source without leaving the extension, including inferred schema and identifier rules when a sample is available
- Pipes setup queue that summarizes captured Event Types missing from Pipes or recently failing delivery, with one-click definition sync from captured payloads
- Event Type sync from validation cards, creating missing definitions or additively updating existing definitions with inferred schema and identifier rules
- Router-side source validation from captured events, so admins can verify whether the Pipes source transform emits valid Event Router events before replaying traffic
- Inline Event Type management for the resolved source, including JSON Schema and identifier-rule editing
- Event Type preview checks that validate the configured JSON Schema and show identifier-rule extraction results against source-test output or recent captured examples before saving to Pipes
- One-click JSON Schema inference for Event Types from source-test output or recent captured payloads
- Identifier-rule builder that uses Pipes identifier types and payload-path suggestions so admins can add rules without hand-writing JSON
- Source transform test harness that runs the current source function against recent example payloads from Pipes
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
