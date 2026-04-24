importScripts("../shared/constants.js", "../shared/browser-utils.js", "../shared/admin-utils.js", "../shared/payload-builder.js");

const shared = globalThis.MeiroTrackerShared;
const activeTabs = new Map();

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
    case "SAVE_SETTINGS":
      return saveSettings(message.settings);
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
  return { ok: true, settings };
}

async function resetSettings() {
  const settings = shared.mergeSettings();
  await chrome.storage.sync.set({ [shared.STORAGE_KEYS.SETTINGS]: settings });
  await broadcastSettings(settings);
  return { ok: true, settings };
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
      const responsePreview = await readResponsePreview(response.clone());

      if (response.ok || attempt === 1 || response.status < 500) {
        return {
          ok: response.ok,
          status: response.status,
          transport: {
            latency_ms: Date.now() - startedAt,
            request_bytes: body.length,
            response_preview: responsePreview
          }
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

  return {
    ok: true,
    settings,
    logs: enrichedLogs,
    contracts,
    recipes: shared.DEFAULT_RECIPES,
    profiles,
    status: status.status,
    page,
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
