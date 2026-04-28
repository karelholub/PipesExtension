importScripts("../shared/constants.js", "../shared/browser-utils.js", "../shared/admin-utils.js", "../shared/payload-builder.js");

const shared = globalThis.MeiroTrackerShared;
const activeTabs = new Map();
const prismMetadataCache = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await chrome.storage.sync.set({ [shared.STORAGE_KEYS.SETTINGS]: settings });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  activeTabs.delete(tabId);
  removeEnabledTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") {
    return;
  }

  reattachIfEnabled(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => {
      console.error("[Meiro Event Simulator] background error", error);
      sendResponse({ ok: false, error: error.message || String(error) });
    });
  return true;
});

async function handleMessage(message, sender) {
  switch (message && message.type) {
    case "GET_SETTINGS":
      return { ok: true, settings: await getSettings() };
    case "GET_PRISM_CONNECTION":
      return { ok: true, connection: await getPrismConnection() };
    case "SAVE_SETTINGS":
      return saveSettings(message.settings);
    case "SAVE_PRISM_CONNECTION":
      return savePrismConnection(message.connection);
    case "RESET_SETTINGS":
      return resetSettings();
    case "REQUEST_ENDPOINT_PERMISSION":
      return requestEndpointPermission(message.endpoint);
    case "ENABLE_TAB":
      return enableTab(message.tabId, { persist: true });
    case "DISABLE_TAB":
      return disableTab(message.tabId);
    case "GET_TAB_STATUS":
      return getTabStatus(message.tabId);
    case "MEIRO_EVENT":
      return collectEvent(message.payload, sender);
    case "GET_LOGS":
      return { ok: true, logs: await getLogs() };
    case "CLEAR_LOGS":
      await chrome.storage.local.set({ [shared.STORAGE_KEYS.LOGS]: [] });
      return { ok: true };
    case "SEND_CUSTOM_TO_TAB":
      return sendCustomToTab(message.tabId, message.eventName, message.customPayload);
    case "GET_WORKBENCH_STATE":
      return getWorkbenchState(message.tabId);
    case "SAVE_SELECTOR_RULES":
      return saveSelectorRules(message.rules);
    case "SAVE_CONTRACTS":
      return saveContracts(message.contracts);
    case "CREATE_PROFILE":
      return createProfile(message.name);
    case "APPLY_PROFILE":
      return applyProfile(message.profileId);
    case "APPLY_RECIPE":
      return applyRecipe(message.recipeId, message.selection);
    case "REPLAY_EVENT":
      return replayEvent(message.payload);
    case "START_PICKER":
      return startPicker(message.tabId);
    case "PICKER_RESULT":
      return savePickerResult(sender, message.selection);
    case "CREATE_PRISM_EVENT_TYPE":
      return createPrismEventType(message.eventType, message.payload);
    case "SYNC_PRISM_EVENT_TYPE_FROM_EVENT":
      return syncPrismEventTypeFromEvent(message.eventType, message.payload, message.verify);
    case "UPDATE_PRISM_EVENT_TYPE":
      return updatePrismEventType(message.eventTypeId, message.updates);
    case "TEST_PRISM_SOURCE":
      return testPrismSource(message.payload, message.headers);
    case "VERIFY_PRISM_EVENT_PAYLOAD":
      return verifyPrismEventPayload(message.payload);
    case "SAVE_PRISM_TRACKING_RULES":
      return savePrismTrackingRules(message.code);
    case "SAVE_PRISM_SOURCE_FUNCTION":
      return savePrismSourceFunction(message.code);
    default:
      return { ok: false, error: "Unknown message type." };
  }
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(shared.STORAGE_KEYS.SETTINGS);
  return shared.mergeSettings(stored[shared.STORAGE_KEYS.SETTINGS]);
}

async function saveSettings(nextSettings) {
  const settings = shared.mergeSettings(nextSettings);
  validateSettings(settings);
  await chrome.storage.sync.set({ [shared.STORAGE_KEYS.SETTINGS]: settings });
  await broadcastSettings(settings);
  clearPrismCache();
  return { ok: true, settings };
}

async function resetSettings() {
  const settings = shared.mergeSettings();
  await chrome.storage.sync.set({ [shared.STORAGE_KEYS.SETTINGS]: settings });
  await broadcastSettings(settings);
  clearPrismCache();
  return { ok: true, settings };
}

async function getPrismConnection() {
  const stored = await chrome.storage.local.get(shared.STORAGE_KEYS.PRISM_CONNECTION);
  const connection = stored[shared.STORAGE_KEYS.PRISM_CONNECTION] || {};
  return {
    base_url: String(connection.base_url || "").trim(),
    token: String(connection.token || "").trim()
  };
}

async function savePrismConnection(connection) {
  const nextConnection = {
    base_url: String(connection && connection.base_url || "").trim(),
    token: String(connection && connection.token || "").trim()
  };

  if (nextConnection.base_url && !shared.isValidHttpUrl(nextConnection.base_url)) {
    throw new Error("Prism base URL must be a valid http(s) URL.");
  }

  await chrome.storage.local.set({ [shared.STORAGE_KEYS.PRISM_CONNECTION]: nextConnection });
  clearPrismCache();
  return { ok: true, connection: { base_url: nextConnection.base_url, token_present: Boolean(nextConnection.token) } };
}

function validateSettings(settings) {
  if (!shared.isValidHttpUrl(settings.sdk_source_url)) {
    throw new Error("SDK source URL must be a valid http(s) URL.");
  }

  if (!shared.isValidHttpUrl(settings.collection_endpoint)) {
    throw new Error("Collection endpoint must be a valid http(s) URL.");
  }

  if (!Object.values(shared.MODES).includes(settings.mode)) {
    throw new Error("Invalid tracking mode.");
  }

  if (!settings.user_id || typeof settings.user_id !== "string") {
    throw new Error("User ID is required.");
  }
}

async function getIdentity() {
  const stored = await chrome.storage.local.get(shared.STORAGE_KEYS.IDENTITY);
  const identity = stored[shared.STORAGE_KEYS.IDENTITY] || {};
  const nextIdentity = {
    session_id: identity.session_id || shared.uuid(),
    meiro_user_id: identity.meiro_user_id || `meiro_${shared.uuid()}`,
    created_at: identity.created_at || new Date().toISOString()
  };

  await chrome.storage.local.set({ [shared.STORAGE_KEYS.IDENTITY]: nextIdentity });
  return nextIdentity;
}

async function enableTab(tabId, options) {
  const opts = Object.assign({ persist: false, auto: false }, options || {});
  if (!tabId) {
    throw new Error("Missing tab id.");
  }

  const settings = await getSettings();
  validateSettings(settings);

  await chrome.scripting.executeScript({
    target: { tabId },
    files: [
      "src/shared/constants.js",
      "src/shared/browser-utils.js",
      "src/shared/admin-utils.js",
      "src/shared/payload-builder.js",
      "src/content/content-script.js"
    ]
  });

  const identity = await getIdentity();
  await chrome.tabs.sendMessage(tabId, {
    type: "CONTENT_START",
    settings,
    identity
  });

  activeTabs.set(tabId, { enabled: true, enabled_at: new Date().toISOString() });
  if (opts.persist) {
    await persistEnabledTab(tabId);
  }
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#197a4b" });
  await chrome.action.setBadgeText({ tabId, text: "ON" });
  return { ok: true, status: { enabled: true, auto: opts.auto } };
}

async function disableTab(tabId) {
  if (!tabId) {
    throw new Error("Missing tab id.");
  }

  try {
    await chrome.tabs.sendMessage(tabId, { type: "CONTENT_STOP" });
  } catch (_error) {
    // The content script may not be present on restricted Chrome pages.
  }

  activeTabs.delete(tabId);
  await removeEnabledTab(tabId);
  await chrome.action.setBadgeText({ tabId, text: "" });
  return { ok: true, status: { enabled: false } };
}

async function getTabStatus(tabId) {
  if (!tabId) {
    return { ok: true, status: { enabled: false } };
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    if (response && response.active) {
      activeTabs.set(tabId, { enabled: true, enabled_at: response.started_at || null });
      return { ok: true, status: { enabled: true, started_at: response.started_at || null } };
    }
  } catch (_error) {
    // No injected content script on this tab.
  }

  const enabledTabs = await getEnabledTabs();
  return { ok: true, status: { enabled: Boolean(activeTabs.get(tabId) || enabledTabs[String(tabId)]) } };
}

async function collectEvent(payload, sender) {
  const settings = await getSettings();
  const contracts = await getContracts();
  const tabId = sender && sender.tab ? sender.tab.id : null;
  const validationErrors = shared.validatePayload(payload).concat(shared.validateAgainstContracts(payload, contracts));
  const piiFindings = shared.scanForPii(payload);

  if (validationErrors.length) {
    await appendLog(logEntry(tabId, payload || { type: "unknown" }, settings.collection_endpoint, false, null, validationErrors.join(" "), validationErrors, piiFindings));
    return { ok: false, error: validationErrors.join(" ") };
  }

  if (!settings.tracking_enabled) {
    await appendLog(logEntry(tabId, payload, settings.collection_endpoint, false, null, "Tracking is disabled in options.", validationErrors, piiFindings));
    return { ok: false, skipped: true, error: "Tracking is disabled in options." };
  }

  if (!settings.consent_override && !settings.sending_allowed) {
    await appendLog(logEntry(tabId, payload, settings.collection_endpoint, false, null, "Consent gate blocked sending.", validationErrors, piiFindings));
    return { ok: false, skipped: true, error: "Consent gate blocked sending." };
  }

  const permission = await hasEndpointPermission(settings.collection_endpoint);
  if (!permission.ok) {
    await appendLog(logEntry(tabId, payload, settings.collection_endpoint, false, null, permission.error, validationErrors, piiFindings));
    return { ok: false, error: permission.error };
  }

  const result = await postEvent(settings, payload);
  await appendLog(logEntry(tabId, payload, settings.collection_endpoint, result.ok, result.status, result.error, validationErrors, piiFindings, false, result.transport));
  return result;
}

async function postEvent(settings, payload) {
  const body = JSON.stringify(payload);
  const headers = { "Content-Type": "application/json" };
  if (settings.app_key) {
    headers["X-App-Key"] = settings.app_key;
  }

  // Meiro/Pipes deployments may require a different envelope or auth scheme.
  // Keep this isolated so collector-specific transport can be swapped later.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const startedAt = Date.now();
    try {
      const response = await fetch(settings.collection_endpoint, {
        method: "POST",
        headers,
        body,
        credentials: "omit",
        cache: "no-store"
      });
      const responseData = await readResponseData(response.clone());
      const semanticErrors = collectTransportErrors(responseData.json);
      const transport = {
        latency_ms: Date.now() - startedAt,
        request_bytes: body.length,
        response_preview: responseData.preview,
        response_json: responseData.json,
        semantic_errors: semanticErrors
      };
      const errorMessage = semanticErrors.length
        ? semanticErrors.join(" ")
        : (!response.ok ? responseData.preview || `HTTP ${response.status}` : null);
      const semanticFailure = semanticErrors.length > 0;

      if (response.ok || semanticFailure || attempt === 1 || response.status < 500) {
        return {
          ok: response.ok && !semanticFailure,
          status: response.status,
          error: errorMessage,
          transport
        };
      }
    } catch (error) {
      if (attempt === 1) {
        return {
          ok: false,
          status: null,
          error: error.message || String(error),
          transport: {
            latency_ms: Date.now() - startedAt,
            request_bytes: body.length,
            response_preview: null
          }
        };
      }
    }

    await sleep(500);
  }

  return { ok: false, status: null, error: "Unknown transport error." };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readResponsePreview(response) {
  try {
    const text = await response.text();
    return text ? text.slice(0, 300) : null;
  } catch (_error) {
    return null;
  }
}

async function readResponseData(response) {
  try {
    const text = await response.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (_error) {
        json = null;
      }
    }
    return {
      preview: text ? text.slice(0, 300) : null,
      json
    };
  } catch (_error) {
    return { preview: null, json: null };
  }
}

function collectTransportErrors(body) {
  if (!body || typeof body !== "object") {
    return [];
  }

  if (Array.isArray(body.errors)) {
    return body.errors.map((item) => String(item)).filter(Boolean);
  }

  if (body.error) {
    return [String(body.error)];
  }

  return [];
}

async function hasEndpointPermission(endpoint) {
  const pattern = shared.endpointPermissionPattern(endpoint);
  if (!pattern) {
    return { ok: false, error: "Invalid collection endpoint URL." };
  }

  const granted = await chrome.permissions.contains({ origins: [pattern] });
  if (granted) {
    return { ok: true };
  }

  return {
    ok: false,
    error: `Missing host permission for ${pattern}. Open options and save/request endpoint permission.`
  };
}

async function requestEndpointPermission(endpoint) {
  const pattern = shared.endpointPermissionPattern(endpoint);
  if (!pattern) {
    return { ok: false, error: "Invalid collection endpoint URL." };
  }

  const granted = await chrome.permissions.request({ origins: [pattern] });
  return { ok: granted, pattern, error: granted ? null : "Endpoint permission was not granted." };
}

function logEntry(tabId, payload, endpoint, ok, status, error, validationErrors, piiFindings, replayed, transport) {
  return {
    id: shared.uuid(),
    tabId,
    event_type: payload.type,
    timestamp: new Date().toISOString(),
    payload,
    endpoint,
    ok,
    status,
    error: error || null,
    validation_errors: validationErrors || [],
    pii_findings: piiFindings || [],
    replayed: Boolean(replayed),
    transport: transport || null
  };
}

async function getLogs() {
  const stored = await chrome.storage.local.get(shared.STORAGE_KEYS.LOGS);
  return stored[shared.STORAGE_KEYS.LOGS] || [];
}

async function appendLog(entry) {
  const logs = await getLogs();
  logs.unshift(entry);
  await chrome.storage.local.set({ [shared.STORAGE_KEYS.LOGS]: logs.slice(0, shared.LOG_LIMIT) });
}

async function sendCustomToTab(tabId, eventName, customPayload) {
  if (!tabId) {
    throw new Error("Missing tab id.");
  }

  await chrome.tabs.sendMessage(tabId, {
    type: "CONTENT_CUSTOM_EVENT",
    eventName: eventName || "manual_custom_event",
    customPayload: customPayload || {}
  });
  return { ok: true };
}

async function getContracts() {
  const stored = await chrome.storage.sync.get(shared.STORAGE_KEYS.CONTRACTS);
  return stored[shared.STORAGE_KEYS.CONTRACTS] || shared.DEFAULT_CONTRACTS;
}

async function getProfiles() {
  const stored = await chrome.storage.sync.get(shared.STORAGE_KEYS.PROFILES);
  return stored[shared.STORAGE_KEYS.PROFILES] || shared.DEFAULT_PROFILES;
}

async function getWorkbenchState(tabId) {
  if (tabId) {
    await ensureEnabledTabRunning(tabId);
  }

  const [settings, logs, contracts, profiles, status] = await Promise.all([
    getSettings(),
    getLogs(),
    getContracts(),
    getProfiles(),
    getTabStatus(tabId)
  ]);
  let page = null;

  if (tabId) {
    try {
      page = await chrome.tabs.sendMessage(tabId, { type: "CONTENT_INSPECT_PAGE" });
    } catch (_error) {
      page = { ok: false, error: "Enable tracking on this tab to inspect DOM, data layer, and SDK state." };
    }
  }

  const scopedLogs = tabId ? logs.filter((entry) => entry.tabId === tabId || entry.tabId === null) : logs;
  const enrichedLogs = scopedLogs.map((entry) => Object.assign({}, entry, {
    validation_summary: shared.summarizeValidationEntry(entry)
  }));
  const pipes = await getPrismWorkbenchState(settings);

  return {
    ok: true,
    settings,
    logs: enrichedLogs,
    contracts,
    recipes: shared.DEFAULT_RECIPES,
    profiles,
    status: status.status,
    page,
    pipes,
    readiness: shared.summarizeReadiness({ settings, logs: scopedLogs, page }),
    event_catalog: shared.buildEventCatalog(scopedLogs),
    delivery_summary: shared.buildDeliverySummary(scopedLogs),
    source_coverage: shared.buildSourceCoverage(page),
    timeline: shared.buildTimeline(scopedLogs, page, settings)
  };
}

async function saveSelectorRules(rules) {
  const settings = await getSettings();
  const cleanRules = Array.isArray(rules) ? rules.slice(0, 100).map((rule) => ({
    id: rule.id || shared.uuid(),
    name: String(rule.name || "").slice(0, 120),
    event_type: String(rule.event_type || "custom_click").slice(0, 120),
    selector: String(rule.selector || "").slice(0, 500),
    text_contains: String(rule.text_contains || "").slice(0, 180),
    href_contains: String(rule.href_contains || "").slice(0, 300),
    enabled: rule.enabled !== false
  })) : [];

  const nextSettings = Object.assign({}, settings, { selector_rules: cleanRules });
  validateSettings(nextSettings);
  await chrome.storage.sync.set({ [shared.STORAGE_KEYS.SETTINGS]: nextSettings });
  await broadcastSettings(nextSettings);
  return { ok: true, settings: nextSettings };
}

async function saveContracts(contracts) {
  if (!Array.isArray(contracts)) {
    throw new Error("Contracts must be an array.");
  }

  const cleanContracts = contracts.slice(0, 100).map((contract) => ({
    event_type: String(contract.event_type || "").slice(0, 120),
    required_paths: Array.isArray(contract.required_paths) ? contract.required_paths.map(String).slice(0, 80) : []
  })).filter((contract) => contract.event_type);

  await chrome.storage.sync.set({ [shared.STORAGE_KEYS.CONTRACTS]: cleanContracts });
  return { ok: true, contracts: cleanContracts };
}

async function getPrismWorkbenchState(settings) {
  const connection = await getPrismConnection();
  const baseUrl = resolvePrismBaseUrl(settings, connection);
  const sourceSlug = extractSourceSlug(settings && settings.collection_endpoint);

  if (!connection.token) {
    return {
      ok: false,
      configured: false,
      base_url: baseUrl,
      source_slug: sourceSlug,
      error: "Add a Prism API token in Options to manage Pipes directly from the extension."
    };
  }

  if (!baseUrl || !shared.isValidHttpUrl(baseUrl)) {
    return {
      ok: false,
      configured: false,
      base_url: baseUrl,
      source_slug: sourceSlug,
      error: "Prism base URL is missing or invalid."
    };
  }

  const permission = await hasPrismPermission(baseUrl);
  if (!permission.ok) {
    return {
      ok: false,
      configured: true,
      base_url: baseUrl,
      source_slug: sourceSlug,
      permission_required: true,
      error: permission.error
    };
  }

  const cacheKey = `${baseUrl}::${sourceSlug || ""}`;
  const cached = prismMetadataCache.get(cacheKey);
  if (cached && (Date.now() - cached.created_at < 10000)) {
    return cached.value;
  }

  try {
    const [sources, identifierTypes] = await Promise.all([
      prismApiRequest(connection, baseUrl, "/api/event-streams"),
      prismApiRequest(connection, baseUrl, "/api/identifier-types")
    ]);
    const sourceSummary = (sources || []).find((item) => item.slug === sourceSlug) || null;
    let source = sourceSummary;
    let recentExamples = [];
    if (sourceSummary && sourceSummary.id) {
      const [sourceDetail, sourceExamples] = await Promise.all([
        prismApiRequest(connection, baseUrl, `/api/event-streams/${sourceSummary.id}`),
        prismApiRequest(connection, baseUrl, `/api/event-streams/${sourceSummary.id}/examples`)
      ]);
      source = sourceDetail || sourceSummary;
      recentExamples = Array.isArray(sourceExamples) ? sourceExamples.slice(0, 5).map((item) => ({
        id: item.id,
        received_at: item.receivedAt || null,
        payload: item.payload
      })) : [];
    }
    const value = {
      ok: true,
      configured: true,
      base_url: baseUrl,
      source_slug: sourceSlug,
      source,
      event_types: source && Array.isArray(source.eventTypes) ? source.eventTypes : [],
      recent_examples: recentExamples,
      identifier_types: Array.isArray(identifierTypes) ? identifierTypes.map((item) => ({
        id: item.id,
        name: item.name
      })) : []
    };
    prismMetadataCache.set(cacheKey, { created_at: Date.now(), value });
    return value;
  } catch (error) {
    return {
      ok: false,
      configured: true,
      base_url: baseUrl,
      source_slug: sourceSlug,
      error: error.message || String(error)
    };
  }
}

async function createPrismEventType(eventType, payload) {
  const name = String(eventType || "").trim();
  if (!name) {
    throw new Error("Event type name is required.");
  }

  const settings = await getSettings();
  const connection = await getPrismConnection();
  const pipes = await getPrismWorkbenchState(settings);
  if (!pipes.ok) {
    throw new Error(pipes.error || "Prism connection is not ready.");
  }
  if (!pipes.source || !pipes.source.id) {
    throw new Error(`No Pipes source matches the configured collection endpoint slug${pipes.source_slug ? ` '${pipes.source_slug}'` : ""}.`);
  }

  const existing = (pipes.event_types || []).find((item) => item.name === name);
  if (existing) {
    return { ok: true, created: false, event_type: existing };
  }

  const body = {
    name,
    jsonSchema: inferEventTypeJsonSchema(payload),
    identifierRules: inferIdentifierRules(payload, pipes.identifier_types || [])
  };
  const created = await prismApiRequest(connection, pipes.base_url, `/api/event-streams/${pipes.source.id}/event-types`, {
    method: "POST",
    body: JSON.stringify(body)
  });

  clearPrismCache();
  return {
    ok: true,
    created: true,
    event_type: created,
    source: pipes.source
  };
}

async function syncPrismEventTypeFromEvent(eventType, payload, verify) {
  const name = String(eventType || "").trim();
  if (!name) {
    throw new Error("Event type name is required.");
  }

  const settings = await getSettings();
  const connection = await getPrismConnection();
  const pipes = await getPrismWorkbenchState(settings);
  if (!pipes.ok) {
    throw new Error(pipes.error || "Prism connection is not ready.");
  }
  if (!pipes.source || !pipes.source.id) {
    throw new Error(`No Pipes source matches the configured collection endpoint slug${pipes.source_slug ? ` '${pipes.source_slug}'` : ""}.`);
  }

  const inferredSchema = inferEventTypeJsonSchema(payload);
  const inferredRules = inferIdentifierRules(payload, pipes.identifier_types || []);
  const existing = (pipes.event_types || []).find((item) => item.name === name);
  if (!existing) {
    const created = await prismApiRequest(connection, pipes.base_url, `/api/event-streams/${pipes.source.id}/event-types`, {
      method: "POST",
      body: JSON.stringify({
        name,
        jsonSchema: inferredSchema,
        identifierRules: inferredRules
      })
    });
    clearPrismCache();
    const result = {
      ok: true,
      action: "created",
      event_type: created,
      source: pipes.source,
      inferred: {
        schema: Boolean(inferredSchema),
        identifier_rules: inferredRules.length
      }
    };
    return verify ? attachSourceVerification(result, payload) : result;
  }

  const mergedRules = mergeIdentifierRules(existing.identifierRules || [], inferredRules);
  const normalizedExistingSchema = normalizeJsonSchemaTypes(existing.jsonSchema);
  const hasSchema = normalizedExistingSchema !== null && normalizedExistingSchema !== undefined;
  const changedRules = mergedRules.length !== (existing.identifierRules || []).length;
  const shouldUpdateSchema = !hasSchema && Boolean(inferredSchema);
  const changedSchemaTypes = JSON.stringify(normalizedExistingSchema) !== JSON.stringify(existing.jsonSchema);
  if (!changedRules && !shouldUpdateSchema && !changedSchemaTypes) {
    const result = {
      ok: true,
      action: "unchanged",
      event_type: existing,
      source: pipes.source,
      inferred: {
        schema: Boolean(inferredSchema),
        identifier_rules: inferredRules.length
      }
    };
    return verify ? attachSourceVerification(result, payload) : result;
  }

  const body = normalizePrismEventTypePayload(existing, {
    jsonSchema: shouldUpdateSchema ? inferredSchema : normalizedExistingSchema,
    identifierRules: mergedRules
  });
  const updated = await prismApiRequest(connection, pipes.base_url, `/api/event-streams/${pipes.source.id}/event-types/${existing.id}`, {
    method: "PUT",
    body: JSON.stringify(body)
  });
  clearPrismCache();
  const result = {
    ok: true,
    action: "updated",
    event_type: updated,
    source: pipes.source,
    inferred: {
      schema: shouldUpdateSchema || changedSchemaTypes,
      identifier_rules: inferredRules.length
    }
  };
  return verify ? attachSourceVerification(result, payload) : result;
}

async function updatePrismEventType(eventTypeId, updates) {
  const id = String(eventTypeId || "").trim();
  if (!id) {
    throw new Error("Event Type id is required.");
  }

  const settings = await getSettings();
  const connection = await getPrismConnection();
  const pipes = await getPrismWorkbenchState(settings);
  if (!pipes.ok || !pipes.source || !pipes.source.id) {
    throw new Error(pipes.error || "Resolved Pipes source is unavailable.");
  }

  const existing = (pipes.event_types || []).find((item) => item.id === id);
  if (!existing) {
    throw new Error("Event Type was not found on the resolved source.");
  }

  const body = normalizePrismEventTypePayload(existing, updates);
  const updated = await prismApiRequest(connection, pipes.base_url, `/api/event-streams/${pipes.source.id}/event-types/${id}`, {
    method: "PUT",
    body: JSON.stringify(body)
  });
  clearPrismCache();
  return { ok: true, event_type: updated };
}

async function testPrismSource(payload, headers) {
  const settings = await getSettings();
  const connection = await getPrismConnection();
  const pipes = await getPrismWorkbenchState(settings);
  if (!pipes.ok || !pipes.source || !pipes.source.id) {
    throw new Error(pipes.error || "Resolved Pipes source is unavailable.");
  }

  const body = {
    code: pipes.source.functionCode || "",
    payload: payload === undefined ? null : payload,
    headers: headers && typeof headers === "object" ? headers : {}
  };
  const result = await prismApiRequest(connection, pipes.base_url, `/api/event-streams/${pipes.source.id}/function/test`, {
    method: "POST",
    body: JSON.stringify(body)
  });
  return { ok: true, result };
}

async function verifyPrismEventPayload(payload) {
  const verification = await testPrismSource(payload, {});
  return {
    ok: true,
    verification: summarizePrismSourceTest(verification.result),
    result: verification.result
  };
}

async function attachSourceVerification(result, payload) {
  try {
    const verification = await testPrismSource(payload, {});
    return Object.assign({}, result, {
      verification: summarizePrismSourceTest(verification.result),
      verification_result: verification.result
    });
  } catch (error) {
    return Object.assign({}, result, {
      verification: {
        ok: false,
        event_count: 0,
        valid_event_count: 0,
        errors: [error.message || String(error)]
      }
    });
  }
}

function summarizePrismSourceTest(result) {
  const validation = result && result.validation ? result.validation : {};
  const eventResults = Array.isArray(validation.eventResults) ? validation.eventResults : [];
  const errors = [];
  if (Array.isArray(validation.errors)) {
    errors.push(...validation.errors.map((item) => String(item)));
  }
  eventResults.forEach((item) => {
    if (Array.isArray(item.errors) && item.errors.length) {
      errors.push(...item.errors.map((error) => `event ${item.index}: ${String(error)}`));
    }
  });
  return {
    ok: Boolean(result && result.ok && validation.ok !== false && errors.length === 0),
    event_count: Array.isArray(result && result.events) ? result.events.length : eventResults.length,
    valid_event_count: eventResults.filter((item) => item.ok !== false).length,
    event_types: eventResults.map((item) => item.eventType).filter(Boolean),
    identifiers: eventResults.reduce((count, item) => count + (Array.isArray(item.identifiers) ? item.identifiers.length : 0), 0),
    errors
  };
}

async function savePrismTrackingRules(code) {
  const sourceContext = await getResolvedPrismSourceContext();
  const nextCode = String(code || "").trim();
  const result = await prismApiRequest(sourceContext.connection, sourceContext.pipes.base_url, `/api/event-streams/${sourceContext.pipes.source.id}/tracking-rules`, {
    method: "PUT",
    body: JSON.stringify({ code: nextCode })
  });
  clearPrismCache();
  return { ok: true, result };
}

async function savePrismSourceFunction(code) {
  const sourceContext = await getResolvedPrismSourceContext();
  const nextCode = String(code || "").trim();
  if (!nextCode) {
    throw new Error("Source transform code is required.");
  }

  const result = await prismApiRequest(sourceContext.connection, sourceContext.pipes.base_url, `/api/event-streams/${sourceContext.pipes.source.id}/function`, {
    method: "PUT",
    body: JSON.stringify({ code: nextCode })
  });
  clearPrismCache();
  return { ok: true, result };
}

async function getResolvedPrismSourceContext() {
  const settings = await getSettings();
  const connection = await getPrismConnection();
  const pipes = await getPrismWorkbenchState(settings);
  if (!pipes.ok || !pipes.source || !pipes.source.id) {
    throw new Error(pipes.error || "Resolved Pipes source is unavailable.");
  }

  return { settings, connection, pipes };
}

async function createProfile(name) {
  const settings = await getSettings();
  const profiles = await getProfiles();
  const profile = {
    id: shared.uuid(),
    name: String(name || `Profile ${profiles.length + 1}`).slice(0, 80),
    created_at: new Date().toISOString(),
    settings
  };

  const nextProfiles = [profile].concat(profiles).slice(0, 20);
  await chrome.storage.sync.set({ [shared.STORAGE_KEYS.PROFILES]: nextProfiles });
  return { ok: true, profile, profiles: nextProfiles };
}

async function applyProfile(profileId) {
  const profiles = await getProfiles();
  const profile = profiles.find((item) => item.id === profileId);
  if (!profile) {
    throw new Error("Profile not found.");
  }

  const settings = shared.mergeSettings(profile.settings);
  validateSettings(settings);
  await chrome.storage.sync.set({ [shared.STORAGE_KEYS.SETTINGS]: settings });
  await broadcastSettings(settings);
  clearPrismCache();
  return { ok: true, settings };
}

async function replayEvent(payload) {
  const settings = await getSettings();
  const contracts = await getContracts();
  const eventPayload = payload || { type: "unknown" };
  const validationErrors = shared.validatePayload(payload).concat(shared.validateAgainstContracts(payload, contracts));
  const piiFindings = shared.scanForPii(eventPayload);

  if (validationErrors.length) {
    await appendLog(logEntry(null, eventPayload, settings.collection_endpoint, false, null, validationErrors.join(" "), validationErrors, piiFindings, true));
    return { ok: false, error: validationErrors.join(" ") };
  }

  const permission = await hasEndpointPermission(settings.collection_endpoint);
  if (!permission.ok) {
    await appendLog(logEntry(null, eventPayload, settings.collection_endpoint, false, null, permission.error, validationErrors, piiFindings, true));
    return { ok: false, error: permission.error };
  }

  const result = await postEvent(settings, eventPayload);
  await appendLog(logEntry(null, eventPayload, settings.collection_endpoint, result.ok, result.status, result.error, validationErrors, piiFindings, true, result.transport));
  return result;
}

async function applyRecipe(recipeId, selection) {
  const recipe = shared.DEFAULT_RECIPES.find((item) => item.id === recipeId);
  if (!recipe) {
    throw new Error("Recipe not found.");
  }

  const settings = await getSettings();
  const selected = selection || {};
  const rule = {
    id: shared.uuid(),
    name: selected.text ? `${recipe.rule.name}: ${String(selected.text).slice(0, 40)}` : recipe.rule.name,
    event_type: recipe.rule.event_type,
    selector: selected.selector || recipe.rule.selector,
    text_contains: recipe.rule.text_contains || "",
    href_contains: recipe.rule.href_contains || (selected.href ? String(selected.href).slice(0, 300) : ""),
    enabled: true
  };

  const nextRules = (settings.selector_rules || []).concat(rule);
  return saveSelectorRules(nextRules);
}

async function startPicker(tabId) {
  if (!tabId) {
    throw new Error("Missing tab id.");
  }

  await chrome.tabs.sendMessage(tabId, { type: "CONTENT_START_PICKER" });
  return { ok: true };
}

async function savePickerResult(sender, selection) {
  const tabId = sender && sender.tab ? sender.tab.id : null;
  if (tabId) {
    const current = activeTabs.get(tabId) || {};
    activeTabs.set(tabId, Object.assign({}, current, { picker_selection: selection }));
  }
  return { ok: true };
}

async function broadcastSettings(settings) {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map((tab) => (
    tab.id ? chrome.tabs.sendMessage(tab.id, { type: "CONTENT_UPDATE_SETTINGS", settings }) : Promise.resolve()
  )));
}

function clearPrismCache() {
  prismMetadataCache.clear();
}

function resolvePrismBaseUrl(settings, connection) {
  if (connection && connection.base_url) {
    return connection.base_url;
  }

  if (!settings || !shared.isValidHttpUrl(settings.collection_endpoint)) {
    return "";
  }

  const endpoint = new URL(settings.collection_endpoint);
  return `${endpoint.protocol}//${endpoint.host}`;
}

function extractSourceSlug(collectionEndpoint) {
  if (!shared.isValidHttpUrl(collectionEndpoint)) {
    return "";
  }

  const url = new URL(collectionEndpoint);
  const parts = url.pathname.split("/").filter(Boolean);
  const collectIndex = parts.indexOf("collect");
  return collectIndex >= 0 ? (parts[collectIndex + 1] || "") : "";
}

async function hasPrismPermission(baseUrl) {
  const pattern = shared.endpointPermissionPattern(baseUrl);
  if (!pattern) {
    return { ok: false, error: "Invalid Prism base URL." };
  }

  const granted = await chrome.permissions.contains({ origins: [pattern] });
  if (granted) {
    return { ok: true };
  }

  return {
    ok: false,
    error: `Missing host permission for ${pattern}. Open options and save the Prism connection to grant access.`
  };
}

async function prismApiRequest(connection, baseUrl, path, init) {
  const method = (init && init.method ? init.method : "GET").toUpperCase();
  const requestInit = {
    method,
    headers: Object.assign({
      "Authorization": `Bearer ${connection.token}`
    }, init && init.headers ? init.headers : {}),
    cache: "no-store"
  };

  if (method !== "GET" && method !== "HEAD") {
    requestInit.headers["Content-Type"] = requestInit.headers["Content-Type"] || "application/json";
    if (init && init.body !== undefined) {
      requestInit.body = init.body;
    }
  }

  const response = await fetch(new URL(path, baseUrl).toString(), requestInit);

  const responseData = await readResponseData(response.clone());
  if (!response.ok) {
    throw new Error(responseData.preview || `Prism API request failed with HTTP ${response.status}.`);
  }

  return responseData.json;
}

function inferIdentifierRules(payload, identifierTypes) {
  const rules = [];
  const candidates = [
    { name: "user_id", path: "$.user_id" },
    { name: "email", path: "$.email" },
    { name: "google_analytics_id", path: "$.client_ids.ga" },
    { name: "facebook_id", path: "$.client_ids.fb" },
    { name: "linkedin_id", path: "$.payload.li_fat_id" },
    { name: "meiro_id", path: "$.client_ids.meiro_user_id" }
  ];

  candidates.forEach((candidate) => {
    const identifierType = (identifierTypes || []).find((item) => item.name === candidate.name);
    if (!identifierType) {
      return;
    }
    if (shared.getByPath(payload, candidate.path.replace(/^\$\./, "")) === undefined) {
      return;
    }
    rules.push({
      identifierTypeId: identifierType.id,
      rule: candidate.path
    });
  });

  return rules;
}

function mergeIdentifierRules(existingRules, inferredRules) {
  const merged = (existingRules || []).map((rule) => ({
    identifierTypeId: rule.identifierTypeId,
    rule: rule.rule
  })).filter((rule) => rule.identifierTypeId && rule.rule);
  const seen = new Set(merged.map((rule) => `${rule.identifierTypeId}::${rule.rule}`));
  (inferredRules || []).forEach((rule) => {
    const nextRule = {
      identifierTypeId: rule.identifierTypeId,
      rule: rule.rule
    };
    const key = `${nextRule.identifierTypeId}::${nextRule.rule}`;
    if (nextRule.identifierTypeId && nextRule.rule && !seen.has(key)) {
      merged.push(nextRule);
      seen.add(key);
    }
  });
  return merged;
}

function inferEventTypeJsonSchema(payload) {
  const sample = payload && payload.payload && typeof payload.payload === "object"
    ? payload.payload
    : payload;
  if (sample === undefined) {
    return null;
  }
  return inferJsonSchemaFromSample(sample);
}

function normalizeJsonSchemaTypes(schema) {
  if (schema === null || schema === undefined) {
    return schema;
  }
  if (Array.isArray(schema)) {
    return schema.map(normalizeJsonSchemaTypes);
  }
  if (!schema || typeof schema !== "object") {
    return schema;
  }

  const normalized = {};
  Object.entries(schema).forEach(([key, value]) => {
    if (key === "type") {
      normalized[key] = normalizeJsonSchemaTypeValue(value);
      return;
    }
    normalized[key] = normalizeJsonSchemaTypes(value);
  });
  return normalized;
}

function normalizeJsonSchemaTypeValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeJsonSchemaTypeValue);
  }
  if (!value) {
    return value;
  }
  const type = String(value).toLowerCase();
  return type === "integer" || type === "number" || type === "string" || type === "boolean" || type === "object" || type === "array" || type === "null"
    ? type
    : value;
}

function inferJsonSchemaFromSample(value) {
  if (Array.isArray(value)) {
    const firstDefined = value.find((item) => item !== undefined);
    return {
      type: "array",
      items: firstDefined === undefined ? {} : inferJsonSchemaFromSample(firstDefined)
    };
  }
  if (value && typeof value === "object") {
    const properties = {};
    Object.entries(value).forEach(([key, childValue]) => {
      properties[key] = inferJsonSchemaFromSample(childValue);
    });
    return {
      type: "object",
      properties
    };
  }
  if (typeof value === "number") {
    return { type: Number.isInteger(value) ? "integer" : "number" };
  }
  if (typeof value === "boolean") {
    return { type: "boolean" };
  }
  if (value === null) {
    return { type: "null" };
  }
  return { type: "string" };
}

function normalizePrismEventTypePayload(existing, updates) {
  const normalizedRules = Array.isArray(updates && updates.identifierRules)
    ? updates.identifierRules
      .map((rule) => ({
        identifierTypeId: String(rule.identifierTypeId || "").trim(),
        rule: String(rule.rule || "").trim()
      }))
      .filter((rule) => rule.identifierTypeId && rule.rule)
    : (existing.identifierRules || []).map((rule) => ({
      identifierTypeId: rule.identifierTypeId,
      rule: rule.rule
    }));

  return {
    jsonSchema: normalizeJsonSchemaTypes(updates && Object.prototype.hasOwnProperty.call(updates, "jsonSchema")
      ? updates.jsonSchema
      : (existing.jsonSchema === undefined ? null : existing.jsonSchema)),
    identifierRules: normalizedRules
  };
}

async function getEnabledTabs() {
  const stored = await chrome.storage.local.get(shared.STORAGE_KEYS.ENABLED_TABS);
  return stored[shared.STORAGE_KEYS.ENABLED_TABS] || {};
}

async function persistEnabledTab(tabId) {
  const enabledTabs = await getEnabledTabs();
  enabledTabs[String(tabId)] = {
    enabled_at: new Date().toISOString()
  };
  await chrome.storage.local.set({ [shared.STORAGE_KEYS.ENABLED_TABS]: enabledTabs });
}

async function removeEnabledTab(tabId) {
  const enabledTabs = await getEnabledTabs();
  delete enabledTabs[String(tabId)];
  await chrome.storage.local.set({ [shared.STORAGE_KEYS.ENABLED_TABS]: enabledTabs });
}

async function reattachIfEnabled(tabId) {
  const enabledTabs = await getEnabledTabs();
  if (!enabledTabs[String(tabId)]) {
    return;
  }

  try {
    await enableTab(tabId, { persist: false, auto: true });
  } catch (error) {
    console.debug("[Meiro Event Simulator] automatic reattach failed", error);
  }
}

async function ensureEnabledTabRunning(tabId) {
  const enabledTabs = await getEnabledTabs();
  if (!enabledTabs[String(tabId)]) {
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    if (response && response.active) {
      return;
    }
  } catch (_error) {
    // Content script is not present or not active after navigation/service-worker sleep.
  }

  try {
    await enableTab(tabId, { persist: false, auto: true });
  } catch (error) {
    console.debug("[Meiro Event Simulator] automatic activation check failed", error);
  }
}
