(function exposeAdminUtils(root) {
  "use strict";

  const shared = root.MeiroTrackerShared || {};

  const PII_PATTERNS = Object.freeze([
    { type: "email", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
    { type: "phone", pattern: /(?:\+?\d[\d .()-]{7,}\d)/ },
    { type: "credit_card", pattern: /\b(?:\d[ -]*?){13,19}\b/ },
    { type: "ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
    { type: "token", pattern: /\b(?:bearer|token|secret|apikey|api_key)\b/i }
  ]);

  function getByPath(object, path) {
    return String(path || "").split(".").reduce((value, key) => {
      if (value === null || value === undefined || key === "") {
        return undefined;
      }
      return value[key];
    }, object);
  }

  function validateAgainstContracts(payload, contracts) {
    if (!payload || typeof payload !== "object") {
      return [];
    }

    const matching = (contracts || []).filter((contract) => contract.event_type === payload.type);
    const errors = [];

    matching.forEach((contract) => {
      (contract.required_paths || []).forEach((path) => {
        const value = getByPath(payload, path);
        const empty = value === null || value === undefined || value === "";
        if (empty || (Array.isArray(value) && value.length === 0)) {
          errors.push(`Missing required path ${path}.`);
        }
      });
    });

    return errors;
  }

  function scanForPii(value, basePath, findings) {
    const nextFindings = findings || [];
    const path = basePath || "$";

    if (typeof value === "string") {
      PII_PATTERNS.forEach((item) => {
        if (item.pattern.test(value)) {
          nextFindings.push({ type: item.type, path });
        }
      });
      return nextFindings;
    }

    if (!value || typeof value !== "object") {
      return nextFindings;
    }

    if (Array.isArray(value)) {
      value.slice(0, 50).forEach((entry, index) => scanForPii(entry, `${path}[${index}]`, nextFindings));
      return nextFindings;
    }

    Object.keys(value).slice(0, 120).forEach((key) => {
      scanForPii(value[key], `${path}.${key}`, nextFindings);
    });

    return nextFindings;
  }

  function selectorScore(selector) {
    const warnings = [];
    if (!selector) {
      return { score: 0, warnings: ["Selector is empty."] };
    }

    if (/:nth-|>/.test(selector)) {
      warnings.push("Selector depends on DOM position.");
    }
    if (/\.[a-z0-9_-]{8,}/i.test(selector)) {
      warnings.push("Selector may contain generated class names.");
    }
    if (!/#|data-|aria-|\[href/.test(selector)) {
      warnings.push("Selector lacks a stable id, data attribute, aria attribute, or href constraint.");
    }

    return {
      score: Math.max(0, 100 - warnings.length * 25),
      warnings
    };
  }

  function redactPotentialPii(value) {
    if (typeof value === "string") {
      return PII_PATTERNS.reduce((text, item) => text.replace(item.pattern, `[redacted:${item.type}]`), value);
    }

    if (!value || typeof value !== "object") {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map(redactPotentialPii);
    }

    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactPotentialPii(entry)]));
  }

  function summarizeReadiness(state) {
    const settings = state.settings || {};
    const logs = state.logs || [];
    const page = state.page || {};
    const latestOk = logs.some((entry) => entry.ok);
    const hasPageView = logs.some((entry) => entry.event_type === "page_view");
    const dataLayers = page.sdk_diagnostics && page.sdk_diagnostics.data_layers ? page.sdk_diagnostics.data_layers : [];
    const sdkScripts = page.sdk_diagnostics && page.sdk_diagnostics.sdk_scripts ? page.sdk_diagnostics.sdk_scripts : [];

    return [
      { label: "Tracking enabled", ok: Boolean(settings.tracking_enabled), detail: settings.tracking_enabled ? "Global sending is enabled." : "Global sending is disabled." },
      { label: "Endpoint configured", ok: shared.isValidHttpUrl(settings.collection_endpoint), detail: settings.collection_endpoint || "Missing endpoint." },
      { label: "User ID configured", ok: Boolean(settings.user_id), detail: settings.user_id || "Missing user_id." },
      { label: "SDK configured", ok: shared.isValidHttpUrl(settings.sdk_source_url), detail: settings.sdk_source_url || "Missing SDK URL." },
      { label: "SDK detected on page", ok: sdkScripts.length > 0, detail: sdkScripts.length ? `${sdkScripts.length} matching script tag(s).` : "No matching SDK script detected yet." },
      { label: "Data layer detected", ok: dataLayers.some((layer) => layer.exists), detail: dataLayers.filter((layer) => layer.exists).map((layer) => layer.name).join(", ") || "No configured data layer found." },
      { label: "Page view captured", ok: hasPageView, detail: hasPageView ? "A page_view exists in the log." : "No page_view logged yet." },
      { label: "Endpoint accepted event", ok: latestOk, detail: latestOk ? "At least one event returned a successful response." : "No successful response logged yet." }
    ];
  }

  root.MeiroTrackerShared = Object.assign(shared, {
    PII_PATTERNS,
    getByPath,
    validateAgainstContracts,
    scanForPii,
    selectorScore,
    redactPotentialPii,
    summarizeReadiness
  });
})(globalThis);
