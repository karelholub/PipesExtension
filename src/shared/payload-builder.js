(function exposePayloadBuilder(root) {
  "use strict";

  const shared = root.MeiroTrackerShared || {};

  function browserMetrics() {
    return {
      screen_width: root.screen ? root.screen.width : null,
      screen_height: root.screen ? root.screen.height : null,
      viewport_width: root.innerWidth,
      viewport_height: root.innerHeight,
      language: root.navigator ? root.navigator.language : null,
      user_agent: root.navigator ? root.navigator.userAgent : null
    };
  }

  function pagePayload(customPayload) {
    const url = root.location ? root.location.href : null;
    const referrer = root.document && root.document.referrer ? root.document.referrer : null;
    return {
      page_title: root.document ? root.document.title : null,
      page_url: url,
      page_referrer: referrer,
      // The Pipes Web SDK source transform template reads event.payload.url /
      // event.payload.referrer (for context.url/referrer and the
      // meiro_mobile_identity query-param lookup), not page_url/page_referrer.
      // Kept alongside page_url/page_referrer, which this extension's own
      // contracts/validation/display code already depends on.
      url,
      referrer,
      custom_payload: customPayload || {}
    };
  }

  function baseEvent(type, identity, settings, payload) {
    const customPayload = Object.assign({}, payload.custom_payload || {});
    if (settings && settings.app_key) {
      customPayload.app_key = settings.app_key;
    }

    return {
      type,
      version: shared.EVENT_VERSION,
      timestamp: new Date().toISOString(),
      user_id: settings && settings.user_id ? settings.user_id : null,
      session_id: identity.session_id,
      payload: Object.assign({}, payload, { custom_payload: customPayload }),
      client_ids: {
        meiro_user_id: identity.meiro_user_id
      },
      browser_metrics: browserMetrics()
    };
  }

  function buildPageView(identity, settings, metadata) {
    return baseEvent("page_view", identity, settings, pagePayload(metadata || {}));
  }

  function buildClick(identity, settings, event, element) {
    const href = shared.nearestHref(element);
    const customPayload = {
      text: shared.safeTrimmedText(element, 160),
      element_tag: element && element.tagName ? element.tagName.toLowerCase() : null,
      href,
      element_id: element ? element.id || null : null,
      element_classes: shared.getClassList(element),
      selector: shared.simplifiedSelector(element),
      x: event && typeof event.clientX === "number" ? event.clientX : null,
      y: event && typeof event.clientY === "number" ? event.clientY : null,
      outbound: shared.isOutboundUrl(href),
      file_download: shared.isDownloadUrl(href)
    };

    return baseEvent("click", identity, settings, pagePayload(customPayload));
  }

  function buildFormSubmit(identity, settings, form) {
    const customPayload = {
      form_action: form ? form.action || null : null,
      form_method: form ? (form.method || "get").toLowerCase() : null,
      form_id: form ? form.id || null : null,
      form_classes: shared.getClassList(form),
      selector: shared.simplifiedSelector(form),
      input_fields: shared.inputMetadata(form)
    };

    return baseEvent("form_submit", identity, settings, pagePayload(customPayload));
  }

  function buildScrollDepth(identity, settings, depthPercent) {
    // "scroll" is the real Web SDK's predefined event name (see GA4_STANDARD_EVENT_NAMES);
    // depth_percent is extension-specific detail carried in custom_payload.
    return baseEvent("scroll", identity, settings, pagePayload({
      depth_percent: depthPercent
    }));
  }

  function buildCustom(identity, settings, eventName, customPayload) {
    return baseEvent(eventName || "custom_event", identity, settings, pagePayload(customPayload || {}));
  }

  function validatePayload(payload) {
    const errors = [];
    if (!payload || typeof payload !== "object") {
      return ["Payload must be an object."];
    }

    ["type", "version", "timestamp", "user_id", "session_id", "payload", "client_ids", "browser_metrics"].forEach((field) => {
      if (!(field in payload)) {
        errors.push(`Missing ${field}.`);
      }
    });

    if (payload.timestamp && Number.isNaN(Date.parse(payload.timestamp))) {
      errors.push("timestamp must be ISO-8601 parseable.");
    }

    if (!payload.payload || typeof payload.payload !== "object") {
      errors.push("payload must be an object.");
    }

    return errors;
  }

  root.MeiroTrackerShared = Object.assign(shared, {
    browserMetrics,
    pagePayload,
    baseEvent,
    buildPageView,
    buildClick,
    buildFormSubmit,
    buildScrollDepth,
    buildCustom,
    validatePayload
  });
})(globalThis);
