(async function initPopup() {
  "use strict";

  const elements = {
    tabLabel: document.getElementById("tabLabel"),
    statusBadge: document.getElementById("statusBadge"),
    modeValue: document.getElementById("modeValue"),
    sdkValue: document.getElementById("sdkValue"),
    endpointValue: document.getElementById("endpointValue"),
    enableButton: document.getElementById("enableButton"),
    disableButton: document.getElementById("disableButton"),
    workbenchButton: document.getElementById("workbenchButton"),
    debugButton: document.getElementById("debugButton"),
    optionsButton: document.getElementById("optionsButton"),
    customEventName: document.getElementById("customEventName"),
    customEventButton: document.getElementById("customEventButton"),
    message: document.getElementById("message")
  };

  const activeTab = await getActiveTab();
  const settingsResponse = await sendMessage({ type: "GET_SETTINGS" });
  const statusResponse = activeTab ? await sendMessage({ type: "GET_TAB_STATUS", tabId: activeTab.id }) : null;
  const settings = settingsResponse.settings || MeiroTrackerShared.DEFAULT_SETTINGS;

  render(settings, statusResponse && statusResponse.status, activeTab);

  elements.enableButton.addEventListener("click", async () => {
    if (!activeTab) {
      setMessage("No active tab found.");
      return;
    }

    const permission = await ensureEndpointPermission(settings.collection_endpoint);
    if (!permission.ok) {
      setMessage(permission.error);
      return;
    }

    const sitePermission = await ensureSitePermission(activeTab.url);
    if (!sitePermission.ok) {
      setMessage(sitePermission.error);
      return;
    }

    const response = await sendMessage({ type: "ENABLE_TAB", tabId: activeTab.id });
    setMessage(response.ok ? "Tracking enabled on this tab." : response.error);
    render(settings, response.status, activeTab);
  });

  elements.disableButton.addEventListener("click", async () => {
    if (!activeTab) {
      return;
    }

    const response = await sendMessage({ type: "DISABLE_TAB", tabId: activeTab.id });
    setMessage(response.ok ? "Tracking disabled on this tab." : response.error);
    render(settings, response.status, activeTab);
  });

  elements.customEventButton.addEventListener("click", async () => {
    if (!activeTab) {
      return;
    }

    const eventName = elements.customEventName.value.trim() || "manual_custom_event";
    const response = await sendMessage({
      type: "SEND_CUSTOM_TO_TAB",
      tabId: activeTab.id,
      eventName,
      customPayload: {
        source: "popup",
        sent_by: "manual_button"
      }
    });
    setMessage(response.ok ? `Sent ${eventName}.` : response.error);
  });

  elements.debugButton.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("debug/debug.html") });
  });

  elements.workbenchButton.addEventListener("click", () => {
    const suffix = activeTab ? `?tabId=${encodeURIComponent(activeTab.id)}` : "";
    chrome.tabs.create({ url: chrome.runtime.getURL(`workbench/workbench.html${suffix}`) });
  });

  elements.optionsButton.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  function render(nextSettings, status, tab) {
    const enabled = Boolean(status && status.enabled);
    elements.statusBadge.textContent = enabled ? "On" : "Off";
    elements.statusBadge.classList.toggle("on", enabled);
    elements.modeValue.textContent = nextSettings.mode;
    elements.sdkValue.textContent = nextSettings.sdk_source_url;
    elements.endpointValue.textContent = nextSettings.collection_endpoint;
    elements.tabLabel.textContent = tab && tab.title ? tab.title : "Active tab";
  }

  function setMessage(value) {
    elements.message.textContent = value || "";
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  function sendMessage(message) {
    return chrome.runtime.sendMessage(message);
  }

  async function ensureEndpointPermission(endpoint) {
    const pattern = MeiroTrackerShared.endpointPermissionPattern(endpoint);
    if (!pattern) {
      return { ok: false, error: "Invalid collection endpoint URL." };
    }

    const granted = await chrome.permissions.contains({ origins: [pattern] });
    if (granted) {
      return { ok: true };
    }

    const requested = await chrome.permissions.request({ origins: [pattern] });
    return {
      ok: requested,
      error: requested ? null : `Endpoint permission was not granted for ${pattern}.`
    };
  }

  async function ensureSitePermission(pageUrl) {
    const pattern = MeiroTrackerShared.pagePermissionPattern(pageUrl);
    if (!pattern) {
      return { ok: true };
    }

    const granted = await chrome.permissions.contains({ origins: [pattern] });
    if (granted) {
      return { ok: true };
    }

    const requested = await chrome.permissions.request({ origins: [pattern] });
    return {
      ok: requested,
      error: requested ? null : `Site permission was not granted for ${pattern}.`
    };
  }
})();
