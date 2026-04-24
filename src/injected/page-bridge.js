(function installMeiroPageBridge() {
  "use strict";

  if (window.__MEIRO_EVENT_SIMULATOR_BRIDGE__) {
    return;
  }

  const state = {
    sdkSourceUrl: null,
    sdkInjected: false,
    debug: false,
    dataLayerNames: [],
    watchedDataLayers: new Set(),
    requestObserverInstalled: false
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

  function redactText(value) {
    return String(value || "")
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted:email]")
      .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[redacted:credit_card]")
      .replace(/\b(?:bearer|token|secret|apikey|api_key)\b/gi, "[redacted:token]");
  }

  function isTrackingUrl(url) {
    return /collect|analytics|gtm|segment|rudder|amplitude|mixpanel|clarity|facebook|doubleclick|meiro|pipes|mparticle|snowplow/i.test(String(url || ""));
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
      }, { once: true });

      return originalSend.apply(this, arguments);
    };

    state.requestObserverInstalled = true;
    debug("Tracking request observer installed");
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
    // This is intentionally best-effort. Replace or extend these candidates
    // when the exact Meiro SDK browser API is known for a target deployment.
    const candidates = [
      window.MeiroEvents && window.MeiroEvents.track,
      window.Meiro && window.Meiro.track,
      window.meiro && window.meiro.track,
      window.meirompt && window.meirompt.track,
      window.MEIRO && window.MEIRO.track
    ].filter((candidate) => typeof candidate === "function");

    if (!candidates.length) {
      debug("No generic SDK track API detected; extension transport will be used.", eventPayload.type);
      return false;
    }

    for (const track of candidates) {
      try {
        track.call(window, eventPayload.type, eventPayload.payload);
        debug("Forwarded event to detected SDK API", eventPayload.type);
        return true;
      } catch (error) {
        debug("Detected SDK API rejected event", error);
      }
    }

    return false;
  }

  window.addEventListener("popstate", () => dispatchRouteChange("popstate"));
  patchHistoryMethod("pushState");
  patchHistoryMethod("replaceState");

  window.addEventListener("meiro-extension:configure", (event) => {
    const detail = event.detail || {};
    state.debug = Boolean(detail.debug);
    state.dataLayerNames = Array.isArray(detail.dataLayerNames) ? detail.dataLayerNames : [];
    watchDataLayers(state.dataLayerNames);
    if (detail.observeTrackingRequests !== false) {
      installRequestObserver();
    }
    if (detail.injectSdk && detail.sdkSourceUrl) {
      injectSdk(detail.sdkSourceUrl);
    }
  });

  window.addEventListener("meiro-extension:sdk-event", (event) => {
    callPotentialSdkApi(event.detail);
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
    callPotentialSdkApi,
    collectDiagnostics
  };
})();
