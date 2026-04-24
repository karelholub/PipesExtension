(function installContentScript(root) {
  "use strict";

  const shared = root.MeiroTrackerShared;
  const state = root.__MEIRO_EVENT_SIMULATOR_CONTENT__ || {
    active: false,
    started_at: null,
    settings: null,
    identity: null,
    cleanup: [],
    lastClick: null,
    scrollDepthsSent: new Set(),
    routeTimer: null,
    dataLayerPushes: [],
    requestSignals: [],
    pickerSelection: null,
    pickerCleanup: null
  };

  root.__MEIRO_EVENT_SIMULATOR_CONTENT__ = state;

  if (root.__MEIRO_EVENT_SIMULATOR_CONTENT_LISTENER__) {
    return;
  }
  root.__MEIRO_EVENT_SIMULATOR_CONTENT_LISTENER__ = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) {
      return false;
    }

    if (message.type === "PING") {
      sendResponse({ active: state.active, started_at: state.started_at });
      return true;
    }

    if (message.type === "CONTENT_START") {
      start(message.settings, message.identity);
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === "CONTENT_STOP") {
      stop();
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === "CONTENT_CUSTOM_EVENT") {
      sendCustomEvent(message.eventName, message.customPayload || {});
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === "CONTENT_INSPECT_PAGE") {
      inspectPage().then(sendResponse);
      return true;
    }

    if (message.type === "CONTENT_START_PICKER") {
      startElementPicker();
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === "CONTENT_UPDATE_SETTINGS") {
      state.settings = shared.mergeSettings(message.settings);
      configurePageBridge();
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });

  function start(settings, identity) {
    stop();
    state.settings = shared.mergeSettings(settings);
    state.identity = identity;
    state.active = true;
    state.started_at = new Date().toISOString();
    state.scrollDepthsSent = new Set();
    state.dataLayerPushes = [];
    state.requestSignals = [];

    installPageBridge(configurePageBridge);
    setTimeout(configurePageBridge, 100);
    installObservers();
    sendPayload(shared.buildPageView(state.identity, state.settings, { route_change: false }));
    shared.debugLog(state.settings, "Tracking started", state.settings);
  }

  function stop() {
    while (state.cleanup.length) {
      const cleanup = state.cleanup.pop();
      try {
        cleanup();
      } catch (error) {
        console.debug("[Meiro Event Simulator] cleanup failed", error);
      }
    }

    if (state.routeTimer) {
      clearTimeout(state.routeTimer);
      state.routeTimer = null;
    }

    state.active = false;
    stopElementPicker();
  }

  function installPageBridge(onReady) {
    // The page bridge runs in the page's JavaScript world so SPA history
    // patching and optional SDK forwarding are visible to the website runtime.
    if (document.querySelector("script[data-meiro-event-simulator-bridge='true']")) {
      if (typeof onReady === "function") {
        onReady();
      }
      return;
    }

    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("src/injected/page-bridge.js");
    script.async = false;
    script.dataset.meiroEventSimulatorBridge = "true";
    script.addEventListener("load", () => {
      script.remove();
      if (typeof onReady === "function") {
        onReady();
      }
    }, { once: true });
    (document.head || document.documentElement).appendChild(script);
  }

  function configurePageBridge() {
    const injectSdk = state.settings.mode === shared.MODES.INJECT_SDK || state.settings.mode === shared.MODES.HYBRID;
    root.dispatchEvent(new CustomEvent("meiro-extension:configure", {
      detail: {
        debug: state.settings.debug,
        injectSdk,
        sdkSourceUrl: state.settings.sdk_source_url,
        dataLayerNames: state.settings.data_layer_names || [],
        observeTrackingRequests: state.settings.observe_tracking_requests !== false
      }
    }));
  }

  function installObservers() {
    const onClick = (event) => {
      if (!state.active) {
        return;
      }

      const element = shared.closestInteractiveElement(event.target) || event.target;
      if (!element || element === document || element === root) {
        return;
      }

      const payload = shared.buildClick(state.identity, state.settings, event, element);
      const fingerprint = `${payload.payload.custom_payload.selector}|${payload.payload.custom_payload.x}|${payload.payload.custom_payload.y}`;
      const now = Date.now();
      if (state.lastClick && state.lastClick.fingerprint === fingerprint && now - state.lastClick.time < 250) {
        return;
      }

      state.lastClick = { fingerprint, time: now };
      sendPayload(payload);

      const clickMetadata = payload.payload.custom_payload;
      if (state.settings.capture_outbound_clicks && clickMetadata.outbound) {
        sendPayload(shared.buildCustom(state.identity, state.settings, "outbound_link_click", clickMetadata));
      }

      if (state.settings.capture_file_downloads && clickMetadata.file_download) {
        sendPayload(shared.buildCustom(state.identity, state.settings, "file_download_click", clickMetadata));
      }

      evaluateSelectorRules(element, event);
    };

    const onSubmit = (event) => {
      if (!state.active) {
        return;
      }

      const form = event.target && event.target.closest ? event.target.closest("form") : event.target;
      if (form) {
        sendPayload(shared.buildFormSubmit(state.identity, state.settings, form));
      }
    };

    const onRouteChange = () => {
      if (!state.active) {
        return;
      }

      if (state.routeTimer) {
        clearTimeout(state.routeTimer);
      }

      state.routeTimer = setTimeout(() => {
        sendPayload(shared.buildPageView(state.identity, state.settings, { route_change: true }));
      }, 100);
    };

    const onScroll = throttle(() => {
      if (!state.active || !state.settings.capture_scroll_depth) {
        return;
      }

      const doc = document.documentElement;
      const scrollable = Math.max(doc.scrollHeight - root.innerHeight, 1);
      const depth = Math.min(100, Math.round(((root.scrollY + root.innerHeight) / scrollable) * 100));
      [25, 50, 75, 90, 100].forEach((mark) => {
        if (depth >= mark && !state.scrollDepthsSent.has(mark)) {
          state.scrollDepthsSent.add(mark);
          sendPayload(shared.buildScrollDepth(state.identity, state.settings, mark));
        }
      });
    }, 500);

    const onDataLayerPush = (event) => {
      state.dataLayerPushes.unshift(event.detail);
      state.dataLayerPushes = state.dataLayerPushes.slice(0, 100);
      shared.debugLog(state.settings, "Data layer push", event.detail);
    };

    const onTrackingRequest = (event) => {
      state.requestSignals.unshift(event.detail);
      state.requestSignals = state.requestSignals.slice(0, 120);
      shared.debugLog(state.settings, "Tracking request", event.detail);
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    root.addEventListener("meiro-extension:route-change", onRouteChange);
    root.addEventListener("scroll", onScroll, { passive: true });
    root.addEventListener("meiro-extension:datalayer-push", onDataLayerPush);
    root.addEventListener("meiro-extension:tracking-request", onTrackingRequest);

    state.cleanup.push(() => document.removeEventListener("click", onClick, true));
    state.cleanup.push(() => document.removeEventListener("submit", onSubmit, true));
    state.cleanup.push(() => root.removeEventListener("meiro-extension:route-change", onRouteChange));
    state.cleanup.push(() => root.removeEventListener("scroll", onScroll));
    state.cleanup.push(() => root.removeEventListener("meiro-extension:datalayer-push", onDataLayerPush));
    state.cleanup.push(() => root.removeEventListener("meiro-extension:tracking-request", onTrackingRequest));
  }

  function evaluateSelectorRules(element, event) {
    const rules = Array.isArray(state.settings.selector_rules) ? state.settings.selector_rules : [];
    rules.filter((rule) => rule.enabled !== false && rule.selector && rule.event_type).forEach((rule) => {
      let matched = null;
      try {
        matched = element.matches(rule.selector) ? element : element.closest(rule.selector);
      } catch (_error) {
        return;
      }

      if (!matched) {
        return;
      }

      const text = shared.safeTrimmedText(matched, 180) || "";
      const href = shared.nearestHref(matched) || "";
      if (rule.text_contains && !text.toLowerCase().includes(String(rule.text_contains).toLowerCase())) {
        return;
      }
      if (rule.href_contains && !href.includes(rule.href_contains)) {
        return;
      }

      sendPayload(shared.buildCustom(state.identity, state.settings, rule.event_type, {
        rule_id: rule.id,
        rule_name: rule.name || null,
        selector: rule.selector,
        text,
        href,
        x: event && typeof event.clientX === "number" ? event.clientX : null,
        y: event && typeof event.clientY === "number" ? event.clientY : null,
        element_tag: matched.tagName ? matched.tagName.toLowerCase() : null,
        element_id: matched.id || null,
        element_classes: shared.getClassList(matched)
      }));
    });
  }

  function sendCustomEvent(eventName, customPayload) {
    if (!state.active) {
      return;
    }

    sendPayload(shared.buildCustom(state.identity, state.settings, eventName, customPayload));
  }

  function sendPayload(payload) {
    const sdkMode = state.settings.mode === shared.MODES.INJECT_SDK || state.settings.mode === shared.MODES.HYBRID;
    if (sdkMode) {
      root.dispatchEvent(new CustomEvent("meiro-extension:sdk-event", { detail: payload }));
    }

    chrome.runtime.sendMessage({ type: "MEIRO_EVENT", payload }, (response) => {
      if (chrome.runtime.lastError) {
        shared.debugLog(state.settings, "Failed to send event", chrome.runtime.lastError.message);
        return;
      }

      shared.debugLog(state.settings, "Event sent", {
        type: payload.type,
        response
      });
    });
  }

  async function inspectPage() {
    const diagnostics = await requestPageDiagnostics();
    const forms = Array.from(document.forms).slice(0, 20).map((form) => ({
      selector: shared.simplifiedSelector(form),
      action: form.action || null,
      method: (form.method || "get").toLowerCase(),
      id: form.id || null,
      classes: shared.getClassList(form),
      input_fields: shared.inputMetadata(form)
    }));

    const interactive = Array.from(document.querySelectorAll("a, button, input, select, textarea, [role='button'], [role='link'], [data-meiro-event]"))
      .slice(0, 80)
      .map((element) => ({
        selector: shared.simplifiedSelector(element),
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        classes: shared.getClassList(element),
        text: shared.safeTrimmedText(element, 100),
        href: shared.nearestHref(element)
      }));

    const localStorageEntries = readStorage(root.localStorage);
    const sessionStorageEntries = readStorage(root.sessionStorage);
    const cookies = document.cookie
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 60)
      .map((item) => {
        const parts = item.split("=");
        const name = parts.shift() || "";
        const value = parts.join("=");
        return {
          name,
          value_preview: shared.redactPotentialPii ? shared.redactPotentialPii(String(value).slice(0, 80)) : String(value).slice(0, 80)
        };
      });

    const queryParams = Array.from(new URLSearchParams(location.search).entries()).map(([key, value]) => ({
      key,
      value: shared.redactPotentialPii ? shared.redactPotentialPii(value) : value
    }));

    const metaTags = Array.from(document.querySelectorAll("meta[name], meta[property]"))
      .slice(0, 60)
      .map((meta) => ({
        name: meta.getAttribute("name") || meta.getAttribute("property"),
        content: (meta.getAttribute("content") || "").slice(0, 180)
      }));

    const networkResources = performance.getEntriesByType("resource")
      .filter((entry) => /collect|analytics|gtm|segment|rudder|amplitude|mixpanel|clarity|facebook|doubleclick|meiro|pipes/i.test(entry.name))
      .slice(-80)
      .map((entry) => ({
        name: entry.name,
        host: safeHost(entry.name),
        initiatorType: entry.initiatorType || null,
        duration: entry.duration || 0,
        transferSize: entry.transferSize || 0,
        timestamp: new Date(performance.timeOrigin + entry.startTime).toISOString()
      }));

    const consent = {
      has_tcfapi: typeof root.__tcfapi === "function",
      has_onetrust: Boolean(root.OneTrust),
      has_cookiebot: Boolean(root.Cookiebot),
      has_didomi: Boolean(root.Didomi),
      consent_like_cookies: cookies.filter((item) => /consent|cookie|optanon|euconsent/i.test(item.name)).map((item) => item.name),
      consent_like_storage_keys: localStorageEntries.concat(sessionStorageEntries).filter((item) => /consent|cookie|optanon|euconsent/i.test(item.key)).map((item) => item.key)
    };

    return {
      ok: true,
      active: state.active,
      started_at: state.started_at,
      url: location.href,
      title: document.title,
      forms,
      interactive,
      data_layer_pushes: state.dataLayerPushes,
      request_signals: state.requestSignals,
      picker_selection: state.pickerSelection,
      sdk_diagnostics: diagnostics,
      sources: {
        query_params: queryParams,
        cookies,
        local_storage: localStorageEntries,
        session_storage: sessionStorageEntries,
        meta_tags: metaTags,
        network_resources: networkResources,
        tracking_requests: state.requestSignals,
        consent
      }
    };
  }

  function readStorage(storage) {
    try {
      return Array.from({ length: Math.min(storage.length, 60) }, (_value, index) => {
        const key = storage.key(index);
        const value = key ? storage.getItem(key) : "";
        return {
          key,
          value_preview: shared.redactPotentialPii ? shared.redactPotentialPii(String(value || "").slice(0, 140)) : String(value || "").slice(0, 140)
        };
      }).filter((item) => item.key);
    } catch (_error) {
      return [];
    }
  }

  function safeHost(value) {
    try {
      return new URL(value, location.href).host;
    } catch (_error) {
      return "";
    }
  }

  function requestPageDiagnostics() {
    return new Promise((resolve) => {
      const requestId = shared.uuid();
      const timeout = setTimeout(() => {
        root.removeEventListener("meiro-extension:diagnostics-response", onResponse);
        resolve(null);
      }, 700);

      function onResponse(event) {
        if (!event.detail || event.detail.requestId !== requestId) {
          return;
        }
        clearTimeout(timeout);
        root.removeEventListener("meiro-extension:diagnostics-response", onResponse);
        resolve(event.detail.diagnostics || null);
      }

      root.addEventListener("meiro-extension:diagnostics-response", onResponse);
      root.dispatchEvent(new CustomEvent("meiro-extension:diagnostics-request", {
        detail: { requestId }
      }));
    });
  }

  function startElementPicker() {
    stopElementPicker();
    const overlay = document.createElement("div");
    overlay.style.cssText = [
      "position:fixed",
      "z-index:2147483647",
      "pointer-events:none",
      "border:2px solid #168a5e",
      "background:rgba(22,138,94,0.12)",
      "box-shadow:0 0 0 99999px rgba(0,0,0,0.08)",
      "display:none"
    ].join(";");
    document.documentElement.appendChild(overlay);

    const move = (event) => {
      const element = event.target;
      if (!element || element === overlay || element === document.documentElement || element === document.body) {
        return;
      }
      const rect = element.getBoundingClientRect();
      overlay.style.display = "block";
      overlay.style.left = `${rect.left}px`;
      overlay.style.top = `${rect.top}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
    };

    const choose = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const element = event.target;
      const selection = describeElement(element);
      state.pickerSelection = selection;
      chrome.runtime.sendMessage({ type: "PICKER_RESULT", selection });
      stopElementPicker();
    };

    const cancel = (event) => {
      if (event.key === "Escape") {
        stopElementPicker();
      }
    };

    document.addEventListener("mousemove", move, true);
    document.addEventListener("click", choose, true);
    document.addEventListener("keydown", cancel, true);
    state.pickerCleanup = () => {
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("click", choose, true);
      document.removeEventListener("keydown", cancel, true);
      overlay.remove();
    };
  }

  function stopElementPicker() {
    if (state.pickerCleanup) {
      state.pickerCleanup();
      state.pickerCleanup = null;
    }
  }

  function describeElement(element) {
    const selector = shared.simplifiedSelector(element);
    return {
      timestamp: new Date().toISOString(),
      page_url: location.href,
      selector,
      selector_score: shared.selectorScore ? shared.selectorScore(selector) : null,
      tag: element && element.tagName ? element.tagName.toLowerCase() : null,
      id: element ? element.id || null : null,
      classes: shared.getClassList(element),
      text: shared.safeTrimmedText(element, 180),
      href: shared.nearestHref(element),
      attributes: element && element.attributes ? Array.from(element.attributes).slice(0, 30).map((attribute) => ({
        name: attribute.name,
        value: attribute.value.slice(0, 180)
      })) : []
    };
  }

  function throttle(fn, wait) {
    let pending = false;
    return function throttled() {
      if (pending) {
        return;
      }

      pending = true;
      setTimeout(() => {
        pending = false;
        fn();
      }, wait);
    };
  }
})(window);
