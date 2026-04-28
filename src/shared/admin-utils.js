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
      { label: "Tab live", ok: Boolean(page && page.active), detail: page && page.active ? `Live collection started at ${page.started_at || "unknown time"}.` : "This page is not currently collecting live signals." },
      { label: "Endpoint configured", ok: shared.isValidHttpUrl(settings.collection_endpoint), detail: settings.collection_endpoint || "Missing endpoint." },
      { label: "User ID configured", ok: Boolean(settings.user_id), detail: settings.user_id || "Missing user_id." },
      { label: "SDK configured", ok: shared.isValidHttpUrl(settings.sdk_source_url), detail: settings.sdk_source_url || "Missing SDK URL." },
      { label: "SDK detected on page", ok: sdkScripts.length > 0, detail: sdkScripts.length ? `${sdkScripts.length} matching script tag(s).` : "No matching SDK script detected yet." },
      { label: "Data layer detected", ok: dataLayers.some((layer) => layer.exists), detail: dataLayers.filter((layer) => layer.exists).map((layer) => layer.name).join(", ") || "No configured data layer found." },
      { label: "Page view captured", ok: hasPageView, detail: hasPageView ? "A page_view exists in the log." : "No page_view logged yet." },
      { label: "Endpoint accepted event", ok: latestOk, detail: latestOk ? "At least one event returned a successful response." : "No successful response logged yet." }
    ];
  }

  function normalizeTimestamp(value) {
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function deriveFixSuggestions(entry) {
    const suggestions = [];
    const errors = entry && entry.validation_errors ? entry.validation_errors : [];
    const semanticErrors = entry && entry.transport && Array.isArray(entry.transport.semantic_errors)
      ? entry.transport.semantic_errors
      : [];
    if (errors.some((item) => /user_id/i.test(item))) {
      suggestions.push("Set a stable user_id in Options or the active profile.");
    }
    if (errors.some((item) => /payload\.page_url/i.test(item))) {
      suggestions.push("Check page context capture and make sure route changes emit a fresh page_url.");
    }
    if (errors.some((item) => /selector/i.test(item))) {
      suggestions.push("Use the element picker to create a stronger selector rule for this interaction.");
    }
    if (entry && entry.pii_findings && entry.pii_findings.length) {
      suggestions.push("Review payload enrichment and redact or exclude the fields flagged as PII.");
    }
    if (entry && entry.error && /permission/i.test(entry.error)) {
      suggestions.push("Grant site and endpoint permissions, then retry the flow.");
    }
    if ((entry && entry.error && /unknown event[_ ]type|event type lookup/i.test(entry.error)) || semanticErrors.some((item) => /unknown event[_ ]type|event type lookup/i.test(item))) {
      suggestions.push("Define the missing Event Type on the resolved Pipes source directly from the workbench.");
    }
    if (entry && entry.status && entry.status >= 400) {
      suggestions.push("Inspect the endpoint response and compare the payload against the Event Router contract.");
    }
    return suggestions;
  }

  function summarizeValidationEntry(entry) {
    const validationErrors = entry && entry.validation_errors ? entry.validation_errors : [];
    const piiFindings = entry && entry.pii_findings ? entry.pii_findings : [];
    const hasFailures = Boolean(entry && entry.error) || validationErrors.length > 0;
    const severity = hasFailures ? "fail" : (piiFindings.length ? "warn" : "pass");
    return {
      severity,
      label: severity === "pass" ? "Ready" : (severity === "warn" ? "Warning" : "Fail"),
      validation_errors: validationErrors,
      pii_findings: piiFindings,
      suggestions: deriveFixSuggestions(entry)
    };
  }

  function buildEventCatalog(logs) {
    const catalog = {};
    (logs || []).forEach((entry) => {
      const key = entry.event_type || "unknown";
      if (!catalog[key]) {
        catalog[key] = {
          event_type: key,
          count: 0,
          ok_count: 0,
          fail_count: 0,
          last_seen_at: null
        };
      }
      catalog[key].count += 1;
      if (entry.ok) {
        catalog[key].ok_count += 1;
      } else {
        catalog[key].fail_count += 1;
      }
      if (!catalog[key].last_seen_at || normalizeTimestamp(entry.timestamp) > normalizeTimestamp(catalog[key].last_seen_at)) {
        catalog[key].last_seen_at = entry.timestamp;
      }
    });
    return Object.values(catalog).sort((left, right) => right.count - left.count);
  }

  function buildDeliverySummary(logs) {
    const summary = {
      total: 0,
      ok: 0,
      failed: 0,
      validation_failures: 0,
      pii_warnings: 0,
      by_status: {}
    };
    (logs || []).forEach((entry) => {
      summary.total += 1;
      if (entry.ok) {
        summary.ok += 1;
      } else {
        summary.failed += 1;
      }
      if (entry.validation_errors && entry.validation_errors.length) {
        summary.validation_failures += 1;
      }
      if (entry.pii_findings && entry.pii_findings.length) {
        summary.pii_warnings += 1;
      }
      const statusKey = entry.status === null || entry.status === undefined ? "none" : String(entry.status);
      summary.by_status[statusKey] = (summary.by_status[statusKey] || 0) + 1;
    });
    return summary;
  }

  function buildSourceCoverage(page) {
    const diagnostics = page && page.sdk_diagnostics ? page.sdk_diagnostics : {};
    const sources = page && page.sources ? page.sources : {};
    return [
      { label: "Data layers", count: (diagnostics.data_layers || []).filter((item) => item.exists).length, detail: (diagnostics.data_layers || []).filter((item) => item.exists).map((item) => item.name).join(", ") || "None detected" },
      { label: "Storage keys", count: (sources.local_storage || []).length + (sources.session_storage || []).length, detail: `${(sources.local_storage || []).length} local, ${(sources.session_storage || []).length} session` },
      { label: "Cookies", count: (sources.cookies || []).length, detail: `${(sources.cookies || []).length} visible cookie(s)` },
      { label: "Meta tags", count: (sources.meta_tags || []).length, detail: `${(sources.meta_tags || []).length} meta/schema hints` },
      { label: "Tracker globals", count: (diagnostics.tracker_globals || []).filter((item) => item.exists).length, detail: (diagnostics.tracker_globals || []).filter((item) => item.exists).map((item) => item.name).join(", ") || "None detected" },
      { label: "Tracked resources", count: (sources.network_resources || []).length, detail: `${(sources.network_resources || []).length} tracking-related network resource(s)` },
      { label: "Live request signals", count: (sources.tracking_requests || []).length, detail: `${(sources.tracking_requests || []).length} observed fetch/XHR tracking request(s)` }
    ];
  }

  function buildTimeline(logs, page, settings) {
    const timeline = [];
    const pushes = page && page.data_layer_pushes ? page.data_layer_pushes : [];
    const resources = page && page.sources && page.sources.network_resources ? page.sources.network_resources : [];
    const requestSignals = page && page.request_signals ? page.request_signals : [];
    const endpointHost = settings && settings.collection_endpoint ? (() => {
      try {
        return new URL(settings.collection_endpoint).host;
      } catch (_error) {
        return "";
      }
    })() : "";

    pushes.forEach((push) => {
      timeline.push({
        kind: "data_layer_push",
        timestamp: push.timestamp,
        label: `${push.name}.push`,
        detail: `${(push.entries || []).length} entr${(push.entries || []).length === 1 ? "y" : "ies"}`,
        source: push,
        sort_time: normalizeTimestamp(push.timestamp)
      });
    });

    resources.forEach((resource) => {
      timeline.push({
        kind: "network_resource",
        timestamp: resource.timestamp || new Date().toISOString(),
        label: resource.name,
        detail: `${resource.initiatorType || "resource"} · ${Math.round(resource.duration || 0)} ms`,
        source: resource,
        sort_time: normalizeTimestamp(resource.timestamp)
      });
    });

    requestSignals.forEach((requestSignal) => {
      timeline.push({
        kind: "tracking_request",
        timestamp: requestSignal.timestamp,
        label: `${requestSignal.transport || "request"} ${requestSignal.method || "GET"} ${requestSignal.host || requestSignal.url || ""}`,
        detail: `${requestSignal.status || "n/a"} · ${requestSignal.duration_ms || 0} ms`,
        source: requestSignal,
        sort_time: normalizeTimestamp(requestSignal.timestamp)
      });
    });

    (logs || []).forEach((entry) => {
      const validation = summarizeValidationEntry(entry);
      const nearestPush = pushes
        .filter((push) => Math.abs(normalizeTimestamp(push.timestamp) - normalizeTimestamp(entry.timestamp)) < 2000)
        .sort((left, right) => Math.abs(normalizeTimestamp(left.timestamp) - normalizeTimestamp(entry.timestamp)) - Math.abs(normalizeTimestamp(right.timestamp) - normalizeTimestamp(entry.timestamp)))[0] || null;
      const matchingRequest = requestSignals
        .filter((requestSignal) => requestSignal.host && endpointHost && requestSignal.host === endpointHost)
        .sort((left, right) => Math.abs(normalizeTimestamp(left.timestamp) - normalizeTimestamp(entry.timestamp)) - Math.abs(normalizeTimestamp(right.timestamp) - normalizeTimestamp(entry.timestamp)))[0]
        || resources
          .filter((resource) => resource.host && endpointHost && resource.host === endpointHost)
          .sort((left, right) => Math.abs(normalizeTimestamp(left.timestamp) - normalizeTimestamp(entry.timestamp)) - Math.abs(normalizeTimestamp(right.timestamp) - normalizeTimestamp(entry.timestamp)))[0]
        || null;

      timeline.push({
        kind: "event",
        timestamp: entry.timestamp,
        label: entry.event_type,
        detail: `${entry.ok ? "sent" : "issue"}${entry.status ? ` · HTTP ${entry.status}` : ""}`,
        source: entry,
        validation,
        correlated_signal: nearestPush,
        correlated_delivery: matchingRequest,
        sort_time: normalizeTimestamp(entry.timestamp)
      });
    });

    return timeline.sort((left, right) => right.sort_time - left.sort_time);
  }

  function flattenObject(value, prefix, target) {
    const output = target || {};
    const base = prefix || "$";
    if (Array.isArray(value)) {
      output[base] = `[array:${value.length}]`;
      value.forEach((entry, index) => flattenObject(entry, `${base}[${index}]`, output));
      return output;
    }
    if (value && typeof value === "object") {
      Object.keys(value).forEach((key) => flattenObject(value[key], `${base}.${key}`, output));
      return output;
    }
    output[base] = value;
    return output;
  }

  function diffEvents(left, right) {
    if (!left || !right) {
      return [];
    }
    const leftFlat = flattenObject(left);
    const rightFlat = flattenObject(right);
    const keys = Array.from(new Set(Object.keys(leftFlat).concat(Object.keys(rightFlat)))).sort();
    return keys
      .filter((key) => JSON.stringify(leftFlat[key]) !== JSON.stringify(rightFlat[key]))
      .map((key) => ({
        path: key,
        left: leftFlat[key],
        right: rightFlat[key]
      }));
  }

  root.MeiroTrackerShared = Object.assign(shared, {
    PII_PATTERNS,
    getByPath,
    validateAgainstContracts,
    scanForPii,
    selectorScore,
    redactPotentialPii,
    summarizeReadiness,
    normalizeTimestamp,
    summarizeValidationEntry,
    buildEventCatalog,
    buildDeliverySummary,
    buildSourceCoverage,
    buildTimeline,
    diffEvents
  });
})(globalThis);
