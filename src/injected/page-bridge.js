(function installMeiroPageBridge() {
  "use strict";

  if (window.__MEIRO_EVENT_SIMULATOR_BRIDGE__) {
    return;
  }

  // Mirrors GA4_STANDARD_EVENT_NAMES in src/shared/constants.js. Duplicated
  // (not shared) because this file is injected as a real <script> tag and runs
  // in the page's own JS world, isolated from the extension's shared modules.
  const STANDARD_EVENT_NAMES = [
    "page_view", "click", "form_start", "form_submit", "scroll", "file_download", "search",
    "session_start", "first_visit", "user_engagement",
    "video_start", "video_progress", "video_complete",
    "add_to_cart", "remove_from_cart", "view_item", "view_item_list", "view_cart",
    "begin_checkout", "add_shipping_info", "add_payment_info", "purchase", "refund",
    "select_item", "select_promotion", "view_promotion", "add_to_wishlist",
    "generate_lead", "qualify_lead", "working_lead", "close_convert_lead",
    "close_unconvert_lead", "disqualify_lead",
    "select_content", "share", "login", "sign_up", "join_group", "view_search_results",
    "tutorial_begin", "tutorial_complete", "level_start", "level_end", "level_up",
    "post_score", "unlock_achievement", "earn_virtual_currency", "spend_virtual_currency"
  ];

  const state = {
    sdkSourceUrl: null,
    sdkInjected: false,
    sdkConfigured: false,
    sdkConfigSignature: null,
    collectionEndpoint: null,
    enableWebLayers: true,
    consent: null,
    debug: false,
    dataLayerNames: [],
    watchedDataLayers: new Set(),
    requestObserverInstalled: false,
    webLayerObserverInstalled: false,
    webLayerSignals: [],
    webLayerSignalKeys: new Set()
  };

  function debug(message, details) {
    if (!state.debug) {
      return;
    }

    if (details !== undefined) {
      console.debug("[Meiro Event Simulator:page]", message, details);
    } else {
      console.debug("[Meiro Event Simulator:page]", message);
    }
  }

  function dispatchRouteChange(reason) {
    window.dispatchEvent(new CustomEvent("meiro-extension:route-change", {
      detail: {
        reason,
        href: window.location.href,
        title: document.title,
        timestamp: new Date().toISOString()
      }
    }));
  }

  function patchHistoryMethod(methodName) {
    const original = history[methodName];
    if (typeof original !== "function") {
      return;
    }

    history[methodName] = function patchedHistoryMethod() {
      const result = original.apply(this, arguments);
      dispatchRouteChange(methodName);
      return result;
    };
  }

  function ensureMptQueue() {
    if (typeof window.mpt === "function") {
      return window.mpt;
    }

    window.mpt = function queuedMptCommand() {
      (window.mpt.q = window.mpt.q || []).push(Array.prototype.slice.call(arguments));
    };
    return window.mpt;
  }

  function configurePipesSdk(detail) {
    if (!detail || !detail.injectSdk || !detail.collectionEndpoint) {
      return;
    }

    const signature = JSON.stringify({
      collectionEndpoint: detail.collectionEndpoint,
      enableWebLayers: detail.enableWebLayers !== false,
      consentOverride: Boolean(detail.consentOverride),
      consent: detail.consent || null
    });
    if (state.sdkConfigSignature === signature) {
      return;
    }

    const mpt = ensureMptQueue();
    const config = {
      collection_endpoint: detail.collectionEndpoint,
      link_tracking: { enabled: true },
      tracking_rules: { enabled: true }
    };

    if (detail.enableWebLayers !== false) {
      config.web_layers = { enabled: true };
      config.web_banners = { enabled: true };
    }

    mpt("config", config);
    // consent_override means "let the extension declare consent on behalf of the
    // page's SDK for testing". sendingAllowed only controls the extension's own
    // direct POST transport (see service-worker.js) and must not, by itself,
    // cause the real SDK's consent state to change.
    if (detail.consentOverride) {
      state.consent = detail.consent || { storage_persistence: "granted", user_id: "granted", session_id: "granted" };
      mpt("consent", state.consent);
    }

    state.collectionEndpoint = detail.collectionEndpoint;
    state.enableWebLayers = detail.enableWebLayers !== false;
    state.sdkConfigured = true;
    state.sdkConfigSignature = signature;
    debug("Pipes SDK configured", config);
  }

  function injectSdk(url) {
    if (!url || state.sdkInjected) {
      return;
    }

    state.sdkSourceUrl = url;
    const script = document.createElement("script");
    script.async = true;
    script.src = url;
    script.dataset.meiroEventSimulatorSdk = "true";
    script.onload = () => debug("SDK script loaded", url);
    script.onerror = () => debug("SDK script failed to load", url);
    (document.head || document.documentElement).appendChild(script);
    state.sdkInjected = true;
  }

  function safePreview(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_error) {
      return String(value);
    }
  }

  // Mirrors PII_PATTERNS/isLikelyPhoneValue in src/shared/admin-utils.js.
  // Duplicated (not shared) because this file runs in the page's own JS world,
  // isolated from the extension's shared modules — see STANDARD_EVENT_NAMES above.
  function redactText(value) {
    return String(value || "")
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted:email]")
      .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[redacted:credit_card]")
      .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted:ssn]")
      .replace(/\b(?:bearer|token|secret|apikey|api_key)\b/gi, "[redacted:token]")
      .replace(/(?:\+?\d[\d .()-]{7,}\d)/g, (match) => {
        const digits = match.replace(/\D/g, "");
        return digits.length >= 8 && digits.length <= 15 && /[+(). -]/.test(match) ? "[redacted:phone]" : match;
      });
  }

  function isTrackingUrl(url) {
    return /collect|analytics|gtm|segment|rudder|amplitude|mixpanel|clarity|facebook|doubleclick|meiro|pipes|mparticle|snowplow/i.test(String(url || ""));
  }

  function isWebLayerUrl(url) {
    return /meiro|pipes|web[-_]?layer|banner|popup|campaign|personalization|personalisation/i.test(String(url || ""));
  }

  function bodySummary(body) {
    if (body === undefined || body === null) {
      return { bytes: 0, preview: null };
    }

    if (typeof body === "string") {
      return { bytes: body.length, preview: redactText(body.slice(0, 300)) };
    }

    if (body instanceof URLSearchParams) {
      const text = body.toString();
      return { bytes: text.length, preview: redactText(text.slice(0, 300)) };
    }

    if (body instanceof FormData) {
      const pairs = [];
      body.forEach((value, key) => {
        pairs.push(`${key}=${String(value).slice(0, 40)}`);
      });
      const text = pairs.join("&");
      return { bytes: text.length, preview: redactText(text.slice(0, 300)) };
    }

    if (typeof body === "object") {
      const text = JSON.stringify(body);
      return { bytes: text.length, preview: redactText(text.slice(0, 300)) };
    }

    const fallback = String(body);
    return { bytes: fallback.length, preview: redactText(fallback.slice(0, 300)) };
  }

  function dispatchTrackingRequest(detail) {
    window.dispatchEvent(new CustomEvent("meiro-extension:tracking-request", {
      detail: Object.assign({ timestamp: new Date().toISOString() }, detail)
    }));
  }

  function recordWebLayerSignal(signal) {
    const detail = Object.assign({ timestamp: new Date().toISOString() }, signal);
    const key = [
      detail.signal_type,
      detail.status,
      detail.url || detail.name || detail.selector || "",
      detail.http_status || ""
    ].join("|");
    if (state.webLayerSignalKeys.has(key)) {
      return;
    }
    state.webLayerSignalKeys.add(key);
    state.webLayerSignals.unshift(detail);
    state.webLayerSignals = state.webLayerSignals.slice(0, 120);
    window.dispatchEvent(new CustomEvent("meiro-extension:web-layer-signal", {
      detail
    }));
  }

  function installRequestObserver() {
    if (state.requestObserverInstalled) {
      return;
    }

    const originalFetch = window.fetch;
    if (typeof originalFetch === "function") {
      window.fetch = async function patchedFetch(input, init) {
        const url = typeof input === "string" ? input : (input && input.url) || "";
        const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
        const requestBody = bodySummary(init && Object.prototype.hasOwnProperty.call(init, "body") ? init.body : (input && input.body));
        const startedAt = Date.now();
        try {
          const response = await originalFetch.apply(this, arguments);
          if (isTrackingUrl(url)) {
            const responsePreview = await response.clone().text().then((text) => redactText(text.slice(0, 300))).catch(() => null);
            dispatchTrackingRequest({
              transport: "fetch",
              url,
              host: (() => { try { return new URL(url, location.href).host; } catch (_error) { return ""; } })(),
              method,
              status: response.status,
              ok: response.ok,
              duration_ms: Date.now() - startedAt,
              request_bytes: requestBody.bytes,
              request_body_preview: requestBody.preview,
              response_preview: responsePreview
            });
          }
          if (isWebLayerUrl(url)) {
            recordWebLayerSignal({
              signal_type: "request",
              status: response.ok ? "served" : "failed",
              transport: "fetch",
              url,
              host: (() => { try { return new URL(url, location.href).host; } catch (_error) { return ""; } })(),
              method,
              http_status: response.status,
              duration_ms: Date.now() - startedAt
            });
          }
          return response;
        } catch (error) {
          if (isTrackingUrl(url)) {
            dispatchTrackingRequest({
              transport: "fetch",
              url,
              host: (() => { try { return new URL(url, location.href).host; } catch (_error) { return ""; } })(),
              method,
              status: null,
              ok: false,
              duration_ms: Date.now() - startedAt,
              request_bytes: requestBody.bytes,
              request_body_preview: requestBody.preview,
              response_preview: error && error.message ? error.message : "fetch error"
            });
          }
          if (isWebLayerUrl(url)) {
            recordWebLayerSignal({
              signal_type: "request",
              status: "failed",
              transport: "fetch",
              url,
              host: (() => { try { return new URL(url, location.href).host; } catch (_error) { return ""; } })(),
              method,
              http_status: null,
              duration_ms: Date.now() - startedAt,
              error: error && error.message ? error.message : "fetch error"
            });
          }
          throw error;
        }
      };
    }

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
      this.__meiroTrackingRequest = {
        method: String(method || "GET").toUpperCase(),
        url: String(url || ""),
        startedAt: 0
      };
      return originalOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function patchedSend(body) {
      const metadata = this.__meiroTrackingRequest || { method: "GET", url: "" };
      const summary = bodySummary(body);
      if (!isTrackingUrl(metadata.url)) {
        return originalSend.apply(this, arguments);
      }

      metadata.startedAt = Date.now();
      this.addEventListener("loadend", () => {
        dispatchTrackingRequest({
          transport: "xhr",
          url: metadata.url,
          host: (() => { try { return new URL(metadata.url, location.href).host; } catch (_error) { return ""; } })(),
          method: metadata.method,
          status: this.status || null,
          ok: this.status >= 200 && this.status < 400,
          duration_ms: Date.now() - metadata.startedAt,
          request_bytes: summary.bytes,
          request_body_preview: summary.preview,
          response_preview: redactText(String(this.responseText || "").slice(0, 300))
        });
        if (isWebLayerUrl(metadata.url)) {
          recordWebLayerSignal({
            signal_type: "request",
            status: this.status >= 200 && this.status < 400 ? "served" : "failed",
            transport: "xhr",
            url: metadata.url,
            host: (() => { try { return new URL(metadata.url, location.href).host; } catch (_error) { return ""; } })(),
            method: metadata.method,
            http_status: this.status || null,
            duration_ms: Date.now() - metadata.startedAt
          });
        }
      }, { once: true });

      return originalSend.apply(this, arguments);
    };

    state.requestObserverInstalled = true;
    debug("Tracking request observer installed");
  }

  function installWebLayerObserver() {
    if (state.webLayerObserverInstalled || !state.enableWebLayers) {
      return;
    }

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        Array.from(mutation.addedNodes || []).forEach(scanWebLayerElement);
      });
    });

    observer.observe(document.documentElement || document, { childList: true, subtree: true });
    Array.from(document.querySelectorAll("[id], [class], [src], [href], [data-meiro], [data-testid]")).slice(0, 300).forEach(scanWebLayerElement);
    state.webLayerObserverInstalled = true;
    debug("Web layer DOM observer installed");
  }

  function scanWebLayerElement(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }
    const element = node;
    const haystack = [
      element.id,
      element.className,
      element.getAttribute && element.getAttribute("data-testid"),
      element.getAttribute && element.getAttribute("data-meiro"),
      element.getAttribute && element.getAttribute("src"),
      element.getAttribute && element.getAttribute("href"),
      element.getAttribute && element.getAttribute("style")
    ].filter(Boolean).join(" ");
    const descendants = element.querySelectorAll ? Array.from(element.querySelectorAll("[id], [class], [src], [href], [data-meiro], [data-testid]")).slice(0, 5) : [];
    const descendantText = descendants.map((item) => [
      item.id,
      item.className,
      item.getAttribute("src"),
      item.getAttribute("href"),
      item.getAttribute("data-meiro"),
      item.getAttribute("data-testid")
    ].filter(Boolean).join(" ")).join(" ");
    if (!/meiro|mpt|web[-_]?layer|banner|popup|campaign/i.test(`${haystack} ${descendantText}`)) {
      return;
    }

    recordWebLayerSignal({
      signal_type: "dom",
      status: "rendered",
      selector: describeElement(element),
      tag: element.tagName ? element.tagName.toLowerCase() : null,
      text_preview: redactText(String(element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160))
    });
  }

  function describeElement(element) {
    if (!element || !element.tagName) {
      return null;
    }

    const tag = element.tagName.toLowerCase();
    if (element.id) {
      return `${tag}#${String(element.id).replace(/[^a-zA-Z0-9_-]/g, "\\$&")}`;
    }

    const className = typeof element.className === "string" ? element.className : "";
    const classes = className.split(/\s+/).filter(Boolean).slice(0, 2).map((item) => `.${item.replace(/[^a-zA-Z0-9_-]/g, "\\$&")}`).join("");
    return `${tag}${classes}`;
  }

  function inspectDataLayer(name) {
    const value = window[name];
    const isArray = Array.isArray(value);
    return {
      name,
      exists: value !== undefined,
      type: isArray ? "array" : typeof value,
      length: isArray ? value.length : null,
      latest: isArray && value.length ? safePreview(value.slice(-5)) : null
    };
  }

  function collectDiagnostics() {
    const sdkNames = ["MeiroEvents", "Meiro", "meiro", "meirompt", "MEIRO"];
    const trackerNames = ["dataLayer", "gtag", "ga", "fbq", "mixpanel", "amplitude", "analytics", "rudderanalytics", "heap", "clarity"];
    const sdkGlobals = sdkNames.map((name) => {
      const value = window[name];
      return {
        name,
        exists: value !== undefined,
        has_track: Boolean(value && typeof value.track === "function"),
        type: value === undefined ? "undefined" : typeof value
      };
    });
    const trackerGlobals = trackerNames.map((name) => {
      const value = window[name];
      return {
        name,
        exists: value !== undefined,
        type: value === undefined ? "undefined" : typeof value
      };
    });

    const sdkScripts = Array.from(document.scripts)
      .map((script) => script.src || "")
      .filter((src) => /meiro|mpt|pipes/i.test(src))
      .map((src) => ({ src, injected_by_extension: /data:|blob:/.test(src) ? false : src === state.sdkSourceUrl }));

    const cspMeta = Array.from(document.querySelectorAll("meta[http-equiv]"))
      .filter((meta) => /content-security-policy/i.test(meta.getAttribute("http-equiv") || ""))
      .map((meta) => meta.content);

    return {
      url: location.href,
      title: document.title,
      sdk_source_url: state.sdkSourceUrl,
      sdk_injected_by_extension: state.sdkInjected,
      sdk_configured_by_extension: state.sdkConfigured,
      collection_endpoint: state.collectionEndpoint,
      web_layers_enabled: state.enableWebLayers,
      web_layer_signals: state.webLayerSignals,
      sdk_globals: sdkGlobals,
      tracker_globals: trackerGlobals,
      sdk_scripts: sdkScripts,
      data_layers: state.dataLayerNames.map(inspectDataLayer),
      csp_meta: cspMeta,
      consent_apis: {
        tcfapi: typeof window.__tcfapi === "function",
        onetrust: Boolean(window.OneTrust),
        cookiebot: Boolean(window.Cookiebot),
        didomi: Boolean(window.Didomi)
      }
    };
  }

  function watchDataLayers(names) {
    names.forEach((name) => {
      if (!name || state.watchedDataLayers.has(name)) {
        return;
      }

      if (!Array.isArray(window[name])) {
        if (window[name] === undefined) {
          window[name] = [];
        } else {
          return;
        }
      }

      const layer = window[name];
      const originalPush = layer.push;
      if (typeof originalPush !== "function") {
        return;
      }

      layer.push = function patchedDataLayerPush() {
        const entries = Array.from(arguments).map(safePreview);
        const result = originalPush.apply(this, arguments);
        window.dispatchEvent(new CustomEvent("meiro-extension:datalayer-push", {
          detail: {
            name,
            entries,
            length: layer.length,
            timestamp: new Date().toISOString()
          }
        }));
        return result;
      };

      state.watchedDataLayers.add(name);
      debug("Watching data layer", name);
    });
  }

  function callPotentialSdkApi(eventPayload) {
    const eventType = eventPayload.type;

    if (typeof window.mpt === "function") {
      // The real mpt.js only accepts the predefined GA4-style vocabulary and
      // rejects anything else with a console error, so non-standard names
      // (custom selector-rule/recipe event types) are never handed to it.
      if (!STANDARD_EVENT_NAMES.includes(eventType)) {
        debug("Skipped forwarding non-standard event name to Pipes SDK", eventType);
        return {
          attempted: true,
          ok: false,
          sdk: "mpt",
          reason: `"${eventType}" is not in the Web SDK's predefined event vocabulary; the real SDK would reject it.`
        };
      }

      try {
        window.mpt("event", eventType, (eventPayload.payload && eventPayload.payload.custom_payload) || eventPayload.payload || {});
        debug("Forwarded event to Pipes SDK mpt API", eventType);
        return { attempted: true, ok: true, sdk: "mpt" };
      } catch (error) {
        debug("Pipes SDK mpt API rejected event", error);
        return { attempted: true, ok: false, sdk: "mpt", reason: error && error.message ? error.message : "mpt() threw an error." };
      }
    }

    // This generic fallback is intentionally best-effort for deployments with
    // no window.mpt. Replace or extend these candidates when the exact Meiro
    // SDK browser API is known for a target deployment; their contract is
    // unknown, so the standard-vocabulary restriction above does not apply.
    const candidates = [
      window.MeiroEvents && window.MeiroEvents.track,
      window.Meiro && window.Meiro.track,
      window.meiro && window.meiro.track,
      window.meirompt && window.meirompt.track,
      window.MEIRO && window.MEIRO.track
    ].filter((candidate) => typeof candidate === "function");

    if (!candidates.length) {
      debug("No generic SDK track API detected; extension transport will be used.", eventType);
      return { attempted: false, ok: false, sdk: "none", reason: "No window.mpt or known tracker global detected." };
    }

    for (const track of candidates) {
      try {
        track.call(window, eventType, eventPayload.payload);
        debug("Forwarded event to detected SDK API", eventType);
        return { attempted: true, ok: true, sdk: "candidate" };
      } catch (error) {
        debug("Detected SDK API rejected event", error);
      }
    }

    return { attempted: true, ok: false, sdk: "candidate", reason: "All detected candidate SDK APIs threw an error." };
  }

  window.addEventListener("popstate", () => dispatchRouteChange("popstate"));
  patchHistoryMethod("pushState");
  patchHistoryMethod("replaceState");

  window.addEventListener("meiro-extension:configure", (event) => {
    const detail = event.detail || {};
    state.debug = Boolean(detail.debug);
    state.dataLayerNames = Array.isArray(detail.dataLayerNames) ? detail.dataLayerNames : [];
    configurePipesSdk(detail);
    watchDataLayers(state.dataLayerNames);
    if (detail.observeTrackingRequests !== false) {
      installRequestObserver();
    }
    if (detail.enableWebLayers !== false) {
      installWebLayerObserver();
    }
    if (detail.injectSdk && detail.sdkSourceUrl) {
      injectSdk(detail.sdkSourceUrl);
    }
  });

  window.addEventListener("meiro-extension:sdk-event", (event) => {
    const detail = event.detail || {};
    const result = callPotentialSdkApi(detail);
    window.dispatchEvent(new CustomEvent("meiro-extension:sdk-forward-result", {
      detail: Object.assign({ requestId: detail.requestId }, result)
    }));
  });

  window.addEventListener("meiro-extension:diagnostics-request", (event) => {
    window.dispatchEvent(new CustomEvent("meiro-extension:diagnostics-response", {
      detail: {
        requestId: event.detail && event.detail.requestId,
        diagnostics: collectDiagnostics()
      }
    }));
  });

  window.__MEIRO_EVENT_SIMULATOR_BRIDGE__ = {
    injectSdk,
    configurePipesSdk,
    callPotentialSdkApi,
    collectDiagnostics
  };
})();
