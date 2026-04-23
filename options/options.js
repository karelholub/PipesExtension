(async function initOptions() {
  "use strict";

  const shared = MeiroTrackerShared;
  const form = document.getElementById("settingsForm");
  const message = document.getElementById("message");
  const fields = {
    sdk_source_url: document.getElementById("sdkSourceUrl"),
    collection_endpoint: document.getElementById("collectionEndpoint"),
    app_key: document.getElementById("appKey"),
    user_id: document.getElementById("userId"),
    mode: document.getElementById("mode"),
    tracking_enabled: document.getElementById("trackingEnabled"),
    debug: document.getElementById("debug"),
    consent_override: document.getElementById("consentOverride"),
    sending_allowed: document.getElementById("sendingAllowed"),
    capture_scroll_depth: document.getElementById("captureScrollDepth"),
    capture_outbound_clicks: document.getElementById("captureOutboundClicks"),
    capture_file_downloads: document.getElementById("captureFileDownloads")
  };

  const response = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  render(response.settings || shared.DEFAULT_SETTINGS);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const settings = readForm();
    const error = validate(settings);
    if (error) {
      setMessage(error, true);
      return;
    }

    const permission = await ensureEndpointPermission(settings.collection_endpoint);
    if (!permission.ok) {
      setMessage(permission.error, true);
      return;
    }

    const saveResponse = await chrome.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      settings
    });
    setMessage(saveResponse.ok ? "Settings saved." : saveResponse.error, !saveResponse.ok);
  });

  document.getElementById("resetButton").addEventListener("click", async () => {
    const resetResponse = await chrome.runtime.sendMessage({ type: "RESET_SETTINGS" });
    render(resetResponse.settings);
    setMessage("Defaults restored.");
  });

  document.getElementById("debugButton").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("debug/debug.html") });
  });

  document.getElementById("workbenchButton").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("workbench/workbench.html") });
  });

  document.getElementById("generateUserIdButton").addEventListener("click", () => {
    fields.user_id.value = shared.uuid();
    setMessage("Generated a new user ID. Save to apply it.");
  });

  function render(settings) {
    Object.entries(shared.mergeSettings(settings)).forEach(([key, value]) => {
      if (!fields[key]) {
        return;
      }

      if (fields[key].type === "checkbox") {
        fields[key].checked = Boolean(value);
      } else {
        fields[key].value = value;
      }
    });
  }

  function readForm() {
    return {
      sdk_source_url: fields.sdk_source_url.value.trim(),
      collection_endpoint: fields.collection_endpoint.value.trim(),
      app_key: fields.app_key.value.trim(),
      user_id: fields.user_id.value.trim(),
      mode: fields.mode.value,
      tracking_enabled: fields.tracking_enabled.checked,
      debug: fields.debug.checked,
      consent_override: fields.consent_override.checked,
      sending_allowed: fields.sending_allowed.checked,
      capture_scroll_depth: fields.capture_scroll_depth.checked,
      capture_outbound_clicks: fields.capture_outbound_clicks.checked,
      capture_file_downloads: fields.capture_file_downloads.checked
    };
  }

  function validate(settings) {
    if (!shared.isValidHttpUrl(settings.sdk_source_url)) {
      return "SDK source URL must be a valid http(s) URL.";
    }

    if (!shared.isValidHttpUrl(settings.collection_endpoint)) {
      return "Collection endpoint must be a valid http(s) URL.";
    }

    if (!settings.user_id) {
      return "User ID is required.";
    }

    return null;
  }

  function setMessage(value, isError) {
    message.textContent = value || "";
    message.style.color = isError ? "#b42318" : "#256a4a";
  }

  async function ensureEndpointPermission(endpoint) {
    const pattern = shared.endpointPermissionPattern(endpoint);
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
})();
