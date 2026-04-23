(async function initWorkbench() {
  "use strict";

  const shared = MeiroTrackerShared;
  const els = {
    pageContext: document.getElementById("pageContext"),
    readinessList: document.getElementById("readinessList"),
    eventList: document.getElementById("eventList"),
    sdkDiagnostics: document.getElementById("sdkDiagnostics"),
    dataLayerNames: document.getElementById("dataLayerNames"),
    dataLayerOutput: document.getElementById("dataLayerOutput"),
    pickerOutput: document.getElementById("pickerOutput"),
    ruleForm: document.getElementById("ruleForm"),
    ruleName: document.getElementById("ruleName"),
    ruleEventType: document.getElementById("ruleEventType"),
    ruleSelector: document.getElementById("ruleSelector"),
    ruleText: document.getElementById("ruleText"),
    ruleHref: document.getElementById("ruleHref"),
    rulesList: document.getElementById("rulesList"),
    contractsEditor: document.getElementById("contractsEditor"),
    profileName: document.getElementById("profileName"),
    profilesList: document.getElementById("profilesList"),
    message: document.getElementById("message")
  };

  let activeTab = null;
  let state = null;
  let loading = false;
  const params = new URLSearchParams(location.search);
  const targetTabId = params.get("tabId");
  const isDevToolsWorkbench = params.get("devtools") === "1";

  document.querySelectorAll(".tabs button").forEach((button) => {
    button.addEventListener("click", () => showTab(button.dataset.tab));
  });
  document.getElementById("refreshButton").addEventListener("click", load);
  document.getElementById("clearLogsButton").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "CLEAR_LOGS" });
    await load();
  });
  document.getElementById("enableButton").addEventListener("click", enableTab);
  document.getElementById("exportSetupButton").addEventListener("click", exportSetup);
  document.getElementById("saveDataLayersButton").addEventListener("click", saveDataLayerNames);
  document.getElementById("pickerButton").addEventListener("click", startPicker);
  document.getElementById("saveContractsButton").addEventListener("click", saveContracts);
  document.getElementById("createProfileButton").addEventListener("click", createProfile);
  els.ruleForm.addEventListener("submit", saveRule);

  await load();
  setInterval(() => {
    if (!document.hidden) {
      load({ silent: true });
    }
  }, 1500);

  async function load() {
    if (loading) {
      return;
    }

    loading = true;
    try {
      activeTab = await getActiveTab();
      const response = await chrome.runtime.sendMessage({ type: "GET_WORKBENCH_STATE", tabId: activeTab && activeTab.id });
      state = response;
      render();
    } finally {
      loading = false;
    }
  }

  function render() {
    if (!state || !state.ok) {
      setMessage(state && state.error ? state.error : "Workbench state unavailable.", true);
      return;
    }

    els.pageContext.textContent = activeTab ? `${activeTab.title || "Active tab"} · ${activeTab.url || ""}` : "No active tab.";
    if (document.activeElement !== els.dataLayerNames) {
      els.dataLayerNames.value = (state.settings.data_layer_names || []).join(", ");
    }
    if (document.activeElement !== els.contractsEditor) {
      els.contractsEditor.value = JSON.stringify(state.contracts, null, 2);
    }
    renderReadiness();
    renderEvents();
    renderSdk();
    renderDataLayer();
    renderMapper();
    renderProfiles();
  }

  function renderReadiness() {
    els.readinessList.textContent = "";
    (state.readiness || []).forEach((item) => {
      const card = document.createElement("article");
      card.className = `check ${item.ok ? "ok" : "bad"}`;
      card.innerHTML = `<div class="entry-head"><strong></strong><span class="pill"></span></div><p></p>`;
      card.querySelector("strong").textContent = item.label;
      const pill = card.querySelector(".pill");
      pill.classList.add(item.ok ? "ok" : "bad");
      pill.textContent = item.ok ? "PASS" : "CHECK";
      card.querySelector("p").textContent = item.detail;
      els.readinessList.appendChild(card);
    });
  }

  function renderEvents() {
    els.eventList.textContent = "";
    const logs = state.logs || [];
    if (!logs.length) {
      els.eventList.append(emptyBox("No events captured yet."));
      return;
    }

    logs.forEach((entry) => {
      const validationErrors = entry.validation_errors || [];
      const piiFindings = entry.pii_findings || [];
      const card = document.createElement("article");
      card.className = "entry";
      const status = entry.ok && !validationErrors.length && !piiFindings.length ? "ok" : "bad";
      card.innerHTML = `
        <div class="entry-head">
          <div><strong></strong><div class="muted"></div></div>
          <div class="actions"><span class="pill ${status}"></span><button type="button" data-action="replay">Replay</button><button type="button" data-action="copy">Copy</button></div>
        </div>
        <p class="muted"></p>
        <pre></pre>
      `;
      card.querySelector("strong").textContent = entry.event_type;
      card.querySelector(".muted").textContent = `${entry.timestamp} · HTTP ${entry.status || "-"}${entry.replayed ? " · replay" : ""}`;
      card.querySelector(".pill").textContent = status === "ok" ? "READY" : "REVIEW";
      card.querySelectorAll(".muted")[1].textContent = [
        entry.error,
        validationErrors.length ? `Validation: ${validationErrors.join(" ")}` : "",
        piiFindings.length ? `PII warning: ${piiFindings.map((item) => `${item.type} at ${item.path}`).join(", ")}` : ""
      ].filter(Boolean).join(" ");
      card.querySelector("pre").textContent = JSON.stringify(shared.redactPotentialPii(entry.payload), null, 2);
      card.querySelector("[data-action='replay']").addEventListener("click", async () => {
        const response = await chrome.runtime.sendMessage({ type: "REPLAY_EVENT", payload: entry.payload });
        setMessage(response.ok ? "Event replayed." : response.error, !response.ok);
        await load();
      });
      card.querySelector("[data-action='copy']").addEventListener("click", async () => {
        await navigator.clipboard.writeText(JSON.stringify(entry.payload, null, 2));
        setMessage("Payload copied.");
      });
      els.eventList.appendChild(card);
    });
  }

  function renderSdk() {
    els.sdkDiagnostics.textContent = "";
    const diagnostics = state.page && state.page.sdk_diagnostics;
    if (!diagnostics) {
      els.sdkDiagnostics.append(emptyBox(state.page && state.page.error ? state.page.error : "No page diagnostics available."));
      return;
    }

    els.sdkDiagnostics.append(
      jsonBox("SDK globals", diagnostics.sdk_globals || []),
      jsonBox("Matching script tags", diagnostics.sdk_scripts || []),
      jsonBox("CSP meta tags", diagnostics.csp_meta || []),
      jsonBox("Page context", {
        url: diagnostics.url,
        sdk_source_url: diagnostics.sdk_source_url,
        sdk_injected_by_extension: diagnostics.sdk_injected_by_extension
      })
    );
  }

  function renderDataLayer() {
    els.dataLayerOutput.textContent = "";
    const diagnostics = state.page && state.page.sdk_diagnostics;
    els.dataLayerOutput.append(
      jsonBox("Current data layers", diagnostics ? diagnostics.data_layers || [] : []),
      jsonBox("Push history", state.page ? state.page.data_layer_pushes || [] : [])
    );
  }

  function renderMapper() {
    const selection = state.page && state.page.picker_selection;
    els.pickerOutput.textContent = "";
    if (selection) {
      els.pickerOutput.append(jsonBox("Last picked element", selection));
      els.ruleSelector.value = els.ruleSelector.value || selection.selector || "";
      els.ruleName.value = els.ruleName.value || selection.text || "";
      els.ruleHref.value = els.ruleHref.value || (selection.href || "");
    } else {
      els.pickerOutput.textContent = "Use Pick element, then click a page element to seed a mapping rule.";
    }

    els.rulesList.textContent = "";
    (state.settings.selector_rules || []).forEach((rule, index) => {
      const score = shared.selectorScore(rule.selector);
      const card = document.createElement("article");
      card.className = "entry";
      card.innerHTML = `<div class="entry-head"><strong></strong><button type="button">Delete</button></div><p class="muted"></p><pre></pre>`;
      card.querySelector("strong").textContent = `${rule.event_type} · ${rule.name || rule.selector}`;
      card.querySelector(".muted").textContent = `Selector score ${score.score}. ${score.warnings.join(" ")}`;
      card.querySelector("pre").textContent = JSON.stringify(rule, null, 2);
      card.querySelector("button").addEventListener("click", async () => {
        const nextRules = state.settings.selector_rules.filter((_item, ruleIndex) => ruleIndex !== index);
        await chrome.runtime.sendMessage({ type: "SAVE_SELECTOR_RULES", rules: nextRules });
        await load();
      });
      els.rulesList.appendChild(card);
    });
  }

  function renderProfiles() {
    els.profilesList.textContent = "";
    (state.profiles || []).forEach((profile) => {
      const card = document.createElement("article");
      card.className = "entry";
      card.innerHTML = `<div class="entry-head"><strong></strong><button type="button">Apply</button></div><p class="muted"></p>`;
      card.querySelector("strong").textContent = profile.name;
      card.querySelector(".muted").textContent = profile.settings && profile.settings.collection_endpoint ? profile.settings.collection_endpoint : "";
      card.querySelector("button").addEventListener("click", async () => {
        const response = await chrome.runtime.sendMessage({ type: "APPLY_PROFILE", profileId: profile.id });
        setMessage(response.ok ? "Profile applied." : response.error, !response.ok);
        await load();
      });
      els.profilesList.appendChild(card);
    });
  }

  async function enableTab() {
    if (!activeTab) {
      return;
    }
    const permission = await ensureEndpointPermission(state.settings.collection_endpoint);
    if (!permission.ok) {
      setMessage(permission.error, true);
      return;
    }
    const sitePermission = await ensureSitePermission(activeTab.url);
    if (!sitePermission.ok) {
      setMessage(sitePermission.error, true);
      return;
    }
    const response = await chrome.runtime.sendMessage({ type: "ENABLE_TAB", tabId: activeTab.id });
    setMessage(response.ok ? "Tracking enabled." : response.error, !response.ok);
    await load();
  }

  async function saveDataLayerNames() {
    const settings = Object.assign({}, state.settings, {
      data_layer_names: els.dataLayerNames.value.split(",").map((item) => item.trim()).filter(Boolean)
    });
    const response = await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });
    setMessage(response.ok ? "Data layer names saved." : response.error, !response.ok);
    await load();
  }

  async function startPicker() {
    if (!activeTab) {
      return;
    }
    const response = await chrome.runtime.sendMessage({ type: "START_PICKER", tabId: activeTab.id });
    setMessage(response.ok ? "Click an element on the page. Press Escape to cancel." : response.error, !response.ok);
  }

  async function saveRule(event) {
    event.preventDefault();
    const rule = {
      id: shared.uuid(),
      name: els.ruleName.value.trim(),
      event_type: els.ruleEventType.value.trim() || "custom_click",
      selector: els.ruleSelector.value.trim(),
      text_contains: els.ruleText.value.trim(),
      href_contains: els.ruleHref.value.trim(),
      enabled: true
    };

    if (!rule.selector) {
      setMessage("Selector is required.", true);
      return;
    }

    const rules = (state.settings.selector_rules || []).concat(rule);
    const response = await chrome.runtime.sendMessage({ type: "SAVE_SELECTOR_RULES", rules });
    setMessage(response.ok ? "Rule saved." : response.error, !response.ok);
    els.ruleForm.reset();
    els.ruleEventType.value = "cta_click";
    await load();
  }

  async function saveContracts() {
    try {
      const contracts = JSON.parse(els.contractsEditor.value);
      const response = await chrome.runtime.sendMessage({ type: "SAVE_CONTRACTS", contracts });
      setMessage(response.ok ? "Contracts saved." : response.error, !response.ok);
      await load();
    } catch (error) {
      setMessage(error.message, true);
    }
  }

  async function createProfile() {
    const response = await chrome.runtime.sendMessage({
      type: "CREATE_PROFILE",
      name: els.profileName.value.trim() || "Workbench profile"
    });
    setMessage(response.ok ? "Profile saved." : response.error, !response.ok);
    await load();
  }

  function exportSetup() {
    const setup = {
      exported_at: new Date().toISOString(),
      settings: state.settings,
      contracts: state.contracts,
      profiles: state.profiles
    };
    const blob = new Blob([JSON.stringify(setup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `meiro-event-workbench-setup-${new Date().toISOString()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function showTab(id) {
    document.querySelectorAll(".tabs button").forEach((button) => button.classList.toggle("active", button.dataset.tab === id));
    document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === id));
  }

  function jsonBox(title, value) {
    const box = document.createElement("section");
    box.className = "box";
    const heading = document.createElement("h2");
    heading.textContent = title;
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(value, null, 2);
    box.append(heading, pre);
    return box;
  }

  function emptyBox(text) {
    const box = document.createElement("div");
    box.className = "notice";
    box.textContent = text;
    return box;
  }

  function setMessage(value, isError) {
    els.message.textContent = value || "";
    els.message.style.color = isError ? "#b42318" : "#256a4a";
  }

  async function getActiveTab() {
    if (targetTabId) {
      try {
        return await chrome.tabs.get(Number(targetTabId));
      } catch (_error) {
        return null;
      }
    }

    if (isDevToolsWorkbench && chrome.devtools && chrome.devtools.inspectedWindow) {
      try {
        return await chrome.tabs.get(chrome.devtools.inspectedWindow.tabId);
      } catch (_error) {
        return {
          id: chrome.devtools.inspectedWindow.tabId,
          title: "Inspected page",
          url: ""
        };
      }
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
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

  async function ensureSitePermission(pageUrl) {
    const pattern = shared.pagePermissionPattern(pageUrl);
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
