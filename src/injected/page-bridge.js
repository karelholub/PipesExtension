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
    watchedDataLayers: new Set()
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
    const globalNames = ["MeiroEvents", "Meiro", "meiro", "meirompt", "MEIRO"];
    const sdkGlobals = globalNames.map((name) => {
      const value = window[name];
      return {
        name,
        exists: value !== undefined,
        has_track: Boolean(value && typeof value.track === "function"),
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
      sdk_scripts: sdkScripts,
      data_layers: state.dataLayerNames.map(inspectDataLayer),
      csp_meta: cspMeta
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
