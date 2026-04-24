(async function initWorkbench() {
  "use strict";

  const shared = MeiroTrackerShared;
  const params = new URLSearchParams(location.search);
  const targetTabId = params.get("tabId");
  const isDevToolsWorkbench = params.get("devtools") === "1";
  const UI_STATE_KEY = "meiro-workbench-ui-state";

  const els = {
    appShell: document.getElementById("appShell"),
    sidebarToggle: document.getElementById("sidebarToggle"),
    pageContext: document.getElementById("pageContext"),
    statusPills: document.getElementById("statusPills"),
    message: document.getElementById("message"),
    overviewSummary: document.getElementById("overviewSummary"),
    readinessList: document.getElementById("readinessList"),
    sourceCoverage: document.getElementById("sourceCoverage"),
    timelineList: document.getElementById("timelineList"),
    timelineSearch: document.getElementById("timelineSearch"),
    timelineKind: document.getElementById("timelineKind"),
    dataLayerNames: document.getElementById("dataLayerNames"),
    signalsGrid: document.getElementById("signalsGrid"),
    pickerOutput: document.getElementById("pickerOutput"),
    ruleForm: document.getElementById("ruleForm"),
    ruleName: document.getElementById("ruleName"),
    ruleEventType: document.getElementById("ruleEventType"),
    ruleSelector: document.getElementById("ruleSelector"),
    ruleText: document.getElementById("ruleText"),
    ruleHref: document.getElementById("ruleHref"),
    rulesList: document.getElementById("rulesList"),
    recipeList: document.getElementById("recipeList"),
    formsList: document.getElementById("formsList"),
    interactiveList: document.getElementById("interactiveList"),
    eventCatalog: document.getElementById("eventCatalog"),
    validationList: document.getElementById("validationList"),
    validationSearch: document.getElementById("validationSearch"),
    validationStatus: document.getElementById("validationStatus"),
    diffLeft: document.getElementById("diffLeft"),
    diffRight: document.getElementById("diffRight"),
    diffSummary: document.getElementById("diffSummary"),
    diffList: document.getElementById("diffList"),
    deliverySummary: document.getElementById("deliverySummary"),
    deliveryList: document.getElementById("deliveryList"),
    deliverySearch: document.getElementById("deliverySearch"),
    deliveryStatus: document.getElementById("deliveryStatus"),
    contractsEditor: document.getElementById("contractsEditor"),
    profileName: document.getElementById("profileName"),
    profilesList: document.getElementById("profilesList")
  };

  let activeTab = null;
  let state = null;
  let loading = false;
  let contextInvalidated = false;
  let pollTimer = null;
  let selectedDiffLeftId = null;
  let selectedDiffRightId = null;
  const uiState = loadUiState();

  document.querySelectorAll(".nav button").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });
  els.sidebarToggle.addEventListener("click", toggleSidebar);

  document.getElementById("refreshButton").addEventListener("click", load);
  document.getElementById("enableButton").addEventListener("click", enableTab);
  document.getElementById("disableButton").addEventListener("click", disableTab);
  document.getElementById("exportSetupButton").addEventListener("click", exportSetup);
  document.getElementById("saveDataLayersButton").addEventListener("click", saveDataLayerNames);
  document.getElementById("pickerButton").addEventListener("click", startPicker);
  document.getElementById("clearLogsButton").addEventListener("click", clearLogs);
  document.getElementById("saveContractsButton").addEventListener("click", saveContracts);
  document.getElementById("createProfileButton").addEventListener("click", createProfile);
  els.ruleForm.addEventListener("submit", saveRule);
  els.diffLeft.addEventListener("change", () => {
    selectedDiffLeftId = els.diffLeft.value || null;
    renderValidation();
  });
  els.diffRight.addEventListener("change", () => {
    selectedDiffRightId = els.diffRight.value || null;
    renderValidation();
  });
  bindFilterInput(els.timelineSearch, "timeline", "search");
  bindFilterInput(els.timelineKind, "timeline", "kind");
  bindFilterInput(els.validationSearch, "validation", "search");
  bindFilterInput(els.validationStatus, "validation", "status");
  bindFilterInput(els.deliverySearch, "delivery", "search");
  bindFilterInput(els.deliveryStatus, "delivery", "status");

  applyUiState();
  await load();
  pollTimer = setInterval(() => {
    if (!document.hidden) {
      load();
    }
  }, 1500);
  window.addEventListener("beforeunload", stopPolling, { once: true });

  async function load() {
    if (loading || contextInvalidated) {
      return;
    }

    loading = true;
    try {
      activeTab = await getActiveTab();
      if (contextInvalidated) {
        return;
      }
      state = await runtimeMessage({ type: "GET_WORKBENCH_STATE", tabId: activeTab && activeTab.id });
      render();
    } catch (error) {
      if (!handlePossibleContextInvalidation(error)) {
        setMessage(error && error.message ? error.message : String(error), true);
      }
    } finally {
      loading = false;
    }
  }

  function render() {
    if (!state || !state.ok) {
      setMessage(state && state.error ? state.error : "Workbench state unavailable.", true);
      return;
    }

    renderHeader();
    renderOverview();
    renderSignals();
    renderBuilder();
    renderValidation();
    renderDelivery();
    renderProfiles();
  }

  function renderHeader() {
    applyUiState();
    els.pageContext.textContent = activeTab
      ? `${activeTab.title || "Inspected page"}${activeTab.url ? ` · ${activeTab.url}` : ""}`
      : "No inspected page available.";

    els.statusPills.textContent = "";
    [
      pill(state.status && state.status.enabled ? "Live collection on" : "Live collection off", state.status && state.status.enabled ? "good" : "bad"),
      pill(state.settings.mode, "warn"),
      pill((state.page && state.page.active) ? "Tab connected" : "Tab disconnected", (state.page && state.page.active) ? "good" : "bad")
    ].forEach((item) => els.statusPills.appendChild(item));

    if (document.activeElement !== els.dataLayerNames) {
      els.dataLayerNames.value = (state.settings.data_layer_names || []).join(", ");
    }
    if (document.activeElement !== els.contractsEditor) {
      els.contractsEditor.value = JSON.stringify(state.contracts, null, 2);
    }
  }

  function renderOverview() {
    const page = state.page || {};
    const delivery = state.delivery_summary || {};
    const eventCatalog = state.event_catalog || [];
    const filteredTimeline = filterTimeline(state.timeline || []);
    syncFilterInputs();
    renderMetrics(els.overviewSummary, [
      metric("Captured events", delivery.total || 0, `${eventCatalog.length} event type(s)`),
      metric("Successful sends", delivery.ok || 0, `${delivery.failed || 0} issue(s)`),
      metric("PII warnings", delivery.pii_warnings || 0, `${delivery.validation_failures || 0} validation failure(s)`),
      metric("Data layer pushes", (page.data_layer_pushes || []).length, `${((page.sdk_diagnostics || {}).data_layers || []).filter((item) => item.exists).length} layer(s) active`)
    ]);

    renderStack(els.readinessList, (state.readiness || []).map((item) => readinessCard(item)));
    renderStack(els.sourceCoverage, (state.source_coverage || []).map((item) => sourceCoverageCard(item)));
    renderStack(els.timelineList, filteredTimeline.map((item) => timelineCard(item)), "No timeline items match the current filters.");
  }

  function renderSignals() {
    const page = state.page || {};
    const diagnostics = page.sdk_diagnostics || {};
    const sources = page.sources || {};

    const cards = [
      jsonCard("Data layers", diagnostics.data_layers || []),
      jsonCard("Data layer push history", page.data_layer_pushes || []),
      jsonCard("Live tracking requests", page.request_signals || []),
      jsonCard("Storage", {
        local_storage: sources.local_storage || [],
        session_storage: sources.session_storage || []
      }),
      jsonCard("Cookies and query params", {
        cookies: sources.cookies || [],
        query_params: sources.query_params || []
      }),
      jsonCard("Tracker globals and SDK", {
        sdk_globals: diagnostics.sdk_globals || [],
        tracker_globals: diagnostics.tracker_globals || [],
        consent_apis: diagnostics.consent_apis || {}
      }),
      jsonCard("Consent and network resources", {
        consent: sources.consent || {},
        network_resources: sources.network_resources || [],
        meta_tags: sources.meta_tags || []
      })
    ];

    renderStack(els.signalsGrid, cards);
  }

  function renderBuilder() {
    const page = state.page || {};
    const selection = page.picker_selection;
    els.pickerOutput.textContent = "";
    if (selection) {
      els.pickerOutput.appendChild(jsonCard("Last picked element", selection));
      if (!els.ruleSelector.value) {
        els.ruleSelector.value = selection.selector || "";
      }
      if (!els.ruleName.value) {
        els.ruleName.value = selection.text || "";
      }
      if (!els.ruleHref.value) {
        els.ruleHref.value = selection.href || "";
      }
    } else {
      els.pickerOutput.textContent = "Pick a page element to seed a mapping rule with selector, text, href, and attributes.";
    }

    renderStack(els.rulesList, (state.settings.selector_rules || []).map((rule, index) => selectorRuleCard(rule, index)));
    renderStack(els.recipeList, (state.recipes || []).map((recipe) => recipeCard(recipe, selection)));
    renderStack(els.formsList, (page.forms || []).map((form) => compactJsonCard(form.selector || "form", form)));
    renderStack(els.interactiveList, (page.interactive || []).map((item) => compactJsonCard(item.selector || item.tag || "element", item)));
  }

  function renderValidation() {
    const filteredLogs = filterValidationLogs(state.logs || []);
    syncFilterInputs();
    renderMetrics(els.eventCatalog, (state.event_catalog || []).map((item) => (
      metric(item.event_type, item.count, `ok ${item.ok_count} · issues ${item.fail_count}`)
    )));

    renderStack(els.validationList, filteredLogs.map((entry) => validationCard(entry)), "No validation items match the current filters.");
    renderDiff();
  }

  function renderDelivery() {
    const summary = state.delivery_summary || {};
    const filteredLogs = filterDeliveryLogs(state.logs || []);
    syncFilterInputs();
    renderMetrics(els.deliverySummary, [
      metric("Delivered", summary.ok || 0, "HTTP success"),
      metric("Failed", summary.failed || 0, "HTTP/network/permission issues"),
      metric("Validation failures", summary.validation_failures || 0, "contract/schema issues"),
      metric("PII warnings", summary.pii_warnings || 0, "payload policy warnings")
    ]);

    renderStack(els.deliveryList, filteredLogs.map((entry) => deliveryCard(entry)), "No delivery items match the current filters.");
  }

  function renderProfiles() {
    renderStack(els.profilesList, (state.profiles || []).map((profile) => profileCard(profile)));
  }

  async function enableTab() {
    if (!activeTab) {
      return;
    }
    const endpointPermission = await ensureEndpointPermission(state.settings.collection_endpoint);
    if (!endpointPermission.ok) {
      setMessage(endpointPermission.error, true);
      return;
    }
    const sitePermission = await ensureSitePermission(activeTab.url);
    if (!sitePermission.ok) {
      setMessage(sitePermission.error, true);
      return;
    }
    const response = await runtimeMessage({ type: "ENABLE_TAB", tabId: activeTab.id });
    setMessage(response.ok ? "Live collection enabled on this tab." : response.error, !response.ok);
    await load();
  }

  async function disableTab() {
    if (!activeTab) {
      return;
    }
    const response = await runtimeMessage({ type: "DISABLE_TAB", tabId: activeTab.id });
    setMessage(response.ok ? "Live collection disabled for this tab." : response.error, !response.ok);
    await load();
  }

  async function saveDataLayerNames() {
    const settings = Object.assign({}, state.settings, {
      data_layer_names: els.dataLayerNames.value.split(",").map((item) => item.trim()).filter(Boolean)
    });
    const response = await runtimeMessage({ type: "SAVE_SETTINGS", settings });
    setMessage(response.ok ? "Signal sources updated." : response.error, !response.ok);
    await load();
  }

  async function startPicker() {
    if (!activeTab) {
      return;
    }
    const response = await runtimeMessage({ type: "START_PICKER", tabId: activeTab.id });
    setMessage(response.ok ? "Click a page element to inspect and seed a rule." : response.error, !response.ok);
  }

  async function clearLogs() {
    await runtimeMessage({ type: "CLEAR_LOGS" });
    setMessage("Delivery log cleared.");
    await load();
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
    const response = await runtimeMessage({ type: "SAVE_SELECTOR_RULES", rules });
    setMessage(response.ok ? "Selector rule saved." : response.error, !response.ok);
    els.ruleForm.reset();
    els.ruleEventType.value = "cta_click";
    await load();
  }

  async function saveContracts() {
    try {
      const contracts = JSON.parse(els.contractsEditor.value);
      const response = await runtimeMessage({ type: "SAVE_CONTRACTS", contracts });
      setMessage(response.ok ? "Payload contracts saved." : response.error, !response.ok);
      await load();
    } catch (error) {
      setMessage(error.message, true);
    }
  }

  async function createProfile() {
    const response = await runtimeMessage({
      type: "CREATE_PROFILE",
      name: els.profileName.value.trim() || "Workbench profile"
    });
    setMessage(response.ok ? "Environment profile saved." : response.error, !response.ok);
    await load();
  }

  function exportSetup() {
    const data = {
      exported_at: new Date().toISOString(),
      settings: state.settings,
      contracts: state.contracts,
      profiles: state.profiles
    };
    downloadJson(`meiro-workbench-setup-${new Date().toISOString()}.json`, data);
  }

  function renderStack(target, nodes, emptyText) {
    target.textContent = "";
    if (!nodes.length) {
      target.appendChild(emptyState(emptyText || "Nothing to show yet."));
      return;
    }
    nodes.forEach((node) => target.appendChild(node));
  }

  function renderMetrics(target, items) {
    target.textContent = "";
    if (!items.length) {
      target.appendChild(emptyState("No metrics available."));
      return;
    }
    items.forEach((item) => target.appendChild(item));
  }

  function showView(viewId) {
    document.querySelectorAll(".nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === viewId));
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
    uiState.activeView = viewId;
    saveUiState();
  }

  function toggleSidebar() {
    uiState.sidebarCollapsed = !uiState.sidebarCollapsed;
    applyUiState();
    saveUiState();
  }

  function metric(label, value, detail) {
    const article = document.createElement("article");
    article.className = "metric";
    article.innerHTML = `<div class="item-title"></div><div class="metric-value"></div><div class="metric-sub"></div>`;
    article.querySelector(".item-title").textContent = label;
    article.querySelector(".metric-value").textContent = String(value);
    article.querySelector(".metric-sub").textContent = detail;
    return article;
  }

  function readinessCard(item) {
    const article = document.createElement("article");
    article.className = "item";
    article.innerHTML = `<div class="item-head"><div class="item-title"></div></div><p class="item-meta"></p>`;
    article.querySelector(".item-title").textContent = item.label;
    article.querySelector(".item-head").appendChild(pill(item.ok ? "PASS" : "CHECK", item.ok ? "good" : "bad"));
    article.querySelector(".item-meta").textContent = item.detail;
    return article;
  }

  function sourceCoverageCard(item) {
    const article = document.createElement("article");
    article.className = "item";
    article.innerHTML = `<div class="row"><strong></strong><span class="pill warn"></span></div><p class="item-meta"></p>`;
    article.querySelector("strong").textContent = item.label;
    article.querySelector(".pill").textContent = String(item.count);
    article.querySelector(".item-meta").textContent = item.detail;
    return article;
  }

  function timelineCard(item) {
    const article = document.createElement("article");
    article.className = "timeline-item";
    const labelPill = item.kind === "event"
      ? pill(item.validation && item.validation.severity === "pass" ? "READY" : (item.validation && item.validation.severity === "warn" ? "WARN" : "FAIL"), item.validation && item.validation.severity === "pass" ? "good" : (item.validation && item.validation.severity === "warn" ? "warn" : "bad"))
      : pill(item.kind.replace(/_/g, " "), "warn");
    article.innerHTML = `<div class="timeline-head"><div><div class="timeline-kind"></div><div class="item-meta"></div></div></div><div class="timeline-body"></div>`;
    article.querySelector(".timeline-kind").textContent = item.label;
    article.querySelector(".item-meta").textContent = `${item.timestamp || "unknown time"} · ${item.detail || ""}`;
    article.querySelector(".timeline-head").appendChild(labelPill);

    const body = article.querySelector(".timeline-body");
    if (item.kind === "event") {
      const fields = document.createElement("div");
      fields.className = "kv";
      [
        kvBox("Selector", shared.getByPath(item.source, "payload.custom_payload.selector") || "n/a"),
        kvBox("Page URL", shared.getByPath(item.source, "payload.page_url") || "n/a"),
        kvBox("HTTP", item.source.status ? String(item.source.status) : "n/a"),
        kvBox("Issues", String((item.validation && item.validation.validation_errors ? item.validation.validation_errors.length : 0) + (item.validation && item.validation.pii_findings ? item.validation.pii_findings.length : 0)))
      ].forEach((node) => fields.appendChild(node));
      body.appendChild(fields);

      if (item.correlated_signal) {
        body.appendChild(subtleBox(`Correlated signal: ${item.correlated_signal.name}.push`));
      }
      if (item.correlated_delivery) {
        const deliveryLabel = item.correlated_delivery.transport
          ? `Correlated request: ${item.correlated_delivery.transport} ${item.correlated_delivery.method || "GET"} ${item.correlated_delivery.host || item.correlated_delivery.url || ""}`
          : `Correlated delivery resource: ${item.correlated_delivery.name || item.correlated_delivery.host || "resource"}`;
        body.appendChild(subtleBox(deliveryLabel));
      }
      if (item.validation && item.validation.suggestions && item.validation.suggestions.length) {
        body.appendChild(subtleBox(item.validation.suggestions.join(" ")));
      }
    } else if (item.kind === "tracking_request") {
      const fields = document.createElement("div");
      fields.className = "kv";
      fields.appendChild(kvBox("Method", item.source.method || "GET"));
      fields.appendChild(kvBox("Status", item.source.status !== null && item.source.status !== undefined ? item.source.status : "n/a"));
      fields.appendChild(kvBox("Duration", item.source.duration_ms !== null && item.source.duration_ms !== undefined ? `${item.source.duration_ms} ms` : "n/a"));
      fields.appendChild(kvBox("Bytes", item.source.request_bytes !== null && item.source.request_bytes !== undefined ? item.source.request_bytes : "n/a"));
      body.appendChild(fields);
      if (item.source.request_body_preview) {
        body.appendChild(subtleBox(`Request preview: ${item.source.request_body_preview}`));
      }
      if (item.source.response_preview) {
        body.appendChild(subtleBox(`Response preview: ${item.source.response_preview}`));
      }
    } else {
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify(item.source, null, 2);
      body.appendChild(pre);
    }
    return article;
  }

  function selectorRuleCard(rule, index) {
    const score = shared.selectorScore(rule.selector);
    const article = document.createElement("article");
    article.className = "item";
    article.innerHTML = `<div class="item-head"><div><div class="item-title"></div><div class="item-meta"></div></div><div class="inline-buttons"></div></div><pre></pre>`;
    article.querySelector(".item-title").textContent = `${rule.event_type} · ${rule.name || rule.selector}`;
    article.querySelector(".item-meta").textContent = `Selector score ${score.score}. ${score.warnings.join(" ")}`;
    article.querySelector("pre").textContent = JSON.stringify(rule, null, 2);
    const buttons = article.querySelector(".inline-buttons");
    buttons.appendChild(pill(rule.enabled !== false ? "enabled" : "disabled", rule.enabled !== false ? "good" : "bad"));
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "Delete";
    removeButton.addEventListener("click", async () => {
      const rules = (state.settings.selector_rules || []).filter((_item, ruleIndex) => ruleIndex !== index);
      await runtimeMessage({ type: "SAVE_SELECTOR_RULES", rules });
      await load();
    });
    buttons.appendChild(removeButton);
    return article;
  }

  function validationCard(entry) {
    const article = document.createElement("article");
    article.className = "item";
    const summary = entry.validation_summary || shared.summarizeValidationEntry(entry);
    article.innerHTML = `<div class="item-head"><div><div class="item-title"></div><div class="item-meta"></div></div><div class="inline-buttons"></div></div><div class="item-body"></div>`;
    article.querySelector(".item-title").textContent = entry.event_type;
    article.querySelector(".item-meta").textContent = `${entry.timestamp} · ${entry.payload && entry.payload.payload ? entry.payload.payload.page_url || "" : ""}`;
    article.querySelector(".inline-buttons").appendChild(pill(summary.label, summary.severity === "pass" ? "good" : (summary.severity === "warn" ? "warn" : "bad")));
    const body = article.querySelector(".item-body");

    if (summary.validation_errors.length) {
      body.appendChild(subtleBox(`Validation: ${summary.validation_errors.join(" ")}`));
    }
    if (summary.pii_findings.length) {
      body.appendChild(subtleBox(`PII: ${summary.pii_findings.map((item) => `${item.type} at ${item.path}`).join(", ")}`));
    }
    if (summary.suggestions.length) {
      body.appendChild(subtleBox(`Suggested fix: ${summary.suggestions.join(" ")}`));
    }

    const actions = document.createElement("div");
    actions.className = "inline-buttons";
    const replayButton = document.createElement("button");
    replayButton.type = "button";
    replayButton.textContent = "Replay";
    replayButton.addEventListener("click", async () => {
      const response = await runtimeMessage({ type: "REPLAY_EVENT", payload: entry.payload });
      setMessage(response.ok ? "Payload replayed." : response.error, !response.ok);
      await load();
    });
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.textContent = "Copy JSON";
    copyButton.addEventListener("click", async () => {
      await navigator.clipboard.writeText(JSON.stringify(entry.payload, null, 2));
      setMessage("Payload copied.");
    });
    actions.append(replayButton, copyButton);
    body.appendChild(actions);

    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(shared.redactPotentialPii(entry.payload), null, 2);
    body.appendChild(pre);
    return article;
  }

  function deliveryCard(entry) {
    const article = document.createElement("article");
    article.className = "item";
    article.innerHTML = `<div class="item-head"><div><div class="item-title"></div><div class="item-meta"></div></div><div class="inline-buttons"></div></div><div class="item-body"></div>`;
    article.querySelector(".item-title").textContent = `${entry.event_type} -> ${entry.endpoint || "endpoint"}`;
    article.querySelector(".item-meta").textContent = `${entry.timestamp} · ${entry.ok ? "success" : "issue"}${entry.status ? ` · HTTP ${entry.status}` : ""}`;
    article.querySelector(".inline-buttons").appendChild(pill(entry.ok ? "sent" : "issue", entry.ok ? "good" : "bad"));
    const body = article.querySelector(".item-body");
    if (entry.error) {
      body.appendChild(subtleBox(entry.error));
    }
    if (entry.transport) {
      const fields = document.createElement("div");
      fields.className = "kv";
      fields.appendChild(kvBox("Latency", entry.transport.latency_ms !== null && entry.transport.latency_ms !== undefined ? `${entry.transport.latency_ms} ms` : "n/a"));
      fields.appendChild(kvBox("Request bytes", entry.transport.request_bytes !== null && entry.transport.request_bytes !== undefined ? entry.transport.request_bytes : "n/a"));
      fields.appendChild(kvBox("Response preview", entry.transport.response_preview || "n/a"));
      body.appendChild(fields);
    }
    if (entry.validation_summary && entry.validation_summary.suggestions && entry.validation_summary.suggestions.length) {
      body.appendChild(subtleBox(entry.validation_summary.suggestions.join(" ")));
    }
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(shared.redactPotentialPii(entry.payload), null, 2);
    body.appendChild(pre);
    return article;
  }

  function profileCard(profile) {
    const article = document.createElement("article");
    article.className = "item";
    article.innerHTML = `<div class="item-head"><div><div class="item-title"></div><div class="item-meta"></div></div><div class="inline-buttons"></div></div><pre></pre>`;
    article.querySelector(".item-title").textContent = profile.name;
    article.querySelector(".item-meta").textContent = profile.created_at || profile.settings.collection_endpoint || "";
    article.querySelector("pre").textContent = JSON.stringify({
      collection_endpoint: profile.settings.collection_endpoint,
      sdk_source_url: profile.settings.sdk_source_url,
      user_id: profile.settings.user_id,
      mode: profile.settings.mode
    }, null, 2);
    const applyButton = document.createElement("button");
    applyButton.type = "button";
    applyButton.textContent = "Apply";
    applyButton.addEventListener("click", async () => {
      const response = await runtimeMessage({ type: "APPLY_PROFILE", profileId: profile.id });
      setMessage(response.ok ? "Profile applied." : response.error, !response.ok);
      await load();
    });
    article.querySelector(".inline-buttons").appendChild(applyButton);
    return article;
  }

  function recipeCard(recipe, selection) {
    const article = document.createElement("article");
    article.className = "item";
    article.innerHTML = `<div class="item-head"><div><div class="item-title"></div><div class="item-meta"></div></div><div class="inline-buttons"></div></div><pre></pre>`;
    article.querySelector(".item-title").textContent = recipe.name;
    article.querySelector(".item-meta").textContent = recipe.description;
    article.querySelector("pre").textContent = JSON.stringify(recipe.rule, null, 2);
    const applyButton = document.createElement("button");
    applyButton.type = "button";
    applyButton.textContent = selection ? "Apply to picked element" : "Apply recipe";
    applyButton.addEventListener("click", async () => {
      const response = await runtimeMessage({
        type: "APPLY_RECIPE",
        recipeId: recipe.id,
        selection: selection || null
      });
      setMessage(response.ok ? `${recipe.name} recipe applied.` : response.error, !response.ok);
      await load();
    });
    article.querySelector(".inline-buttons").appendChild(applyButton);
    return article;
  }

  function compactJsonCard(title, value) {
    return jsonCard(title, value);
  }

  function jsonCard(title, value) {
    const article = document.createElement("article");
    article.className = "card";
    article.innerHTML = `<div class="card-header"><h3></h3></div><pre></pre>`;
    article.querySelector("h3").textContent = title;
    article.querySelector("pre").textContent = JSON.stringify(value, null, 2);
    return article;
  }

  function renderDiff() {
    const logs = state.logs || [];
    if (!logs.length) {
      els.diffLeft.innerHTML = "";
      els.diffRight.innerHTML = "";
      els.diffSummary.textContent = "Capture at least two events to compare payload changes.";
      renderStack(els.diffList, []);
      return;
    }

    if (!selectedDiffLeftId || !logs.some((entry) => entry.id === selectedDiffLeftId)) {
      selectedDiffLeftId = logs[0].id;
    }
    if (!selectedDiffRightId || !logs.some((entry) => entry.id === selectedDiffRightId)) {
      selectedDiffRightId = logs[Math.min(1, logs.length - 1)].id;
    }

    fillDiffSelect(els.diffLeft, logs, selectedDiffLeftId);
    fillDiffSelect(els.diffRight, logs, selectedDiffRightId);

    const left = logs.find((entry) => entry.id === selectedDiffLeftId) || null;
    const right = logs.find((entry) => entry.id === selectedDiffRightId) || null;
    if (!left || !right) {
      els.diffSummary.textContent = "Select two events to compare.";
      renderStack(els.diffList, []);
      return;
    }

    const diff = shared.diffEvents(left.payload, right.payload);
    els.diffSummary.textContent = `${left.event_type} (${left.timestamp}) vs ${right.event_type} (${right.timestamp}) · ${diff.length} differing path(s)`;
    renderStack(els.diffList, diff.map((item) => diffCard(item)));
  }

  function fillDiffSelect(select, logs, selectedId) {
    select.textContent = "";
    logs.forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = `${entry.event_type} · ${entry.timestamp}`;
      option.selected = entry.id === selectedId;
      select.appendChild(option);
    });
  }

  function diffCard(item) {
    const article = document.createElement("article");
    article.className = "item";
    article.innerHTML = `<div class="item-title"></div><div class="kv"></div>`;
    article.querySelector(".item-title").textContent = item.path;
    const kv = article.querySelector(".kv");
    kv.appendChild(kvBox("Left", JSON.stringify(item.left)));
    kv.appendChild(kvBox("Right", JSON.stringify(item.right)));
    return article;
  }

  function kvBox(label, value) {
    const box = document.createElement("div");
    box.innerHTML = `<strong></strong><div class="item-meta"></div>`;
    box.querySelector("strong").textContent = label;
    box.querySelector(".item-meta").textContent = String(value);
    return box;
  }

  function subtleBox(text) {
    const box = document.createElement("div");
    box.className = "subtle-box";
    box.textContent = text;
    return box;
  }

  function emptyState(text) {
    const box = document.createElement("div");
    box.className = "notice";
    box.textContent = text;
    return box;
  }

  function pill(label, tone) {
    const span = document.createElement("span");
    span.className = `pill ${tone || ""}`.trim();
    span.textContent = label;
    return span;
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function setMessage(value, isError) {
    els.message.textContent = value || "";
    els.message.style.color = isError ? "#ffb4ab" : "#a9f0c7";
  }

  function bindFilterInput(element, group, key) {
    element.addEventListener("input", () => updateFilter(group, key, element.value));
    element.addEventListener("change", () => updateFilter(group, key, element.value));
  }

  function updateFilter(group, key, value) {
    uiState.filters[group][key] = value;
    saveUiState();
    if (group === "timeline") {
      renderOverview();
      return;
    }
    if (group === "validation") {
      renderValidation();
      return;
    }
    renderDelivery();
  }

  function syncFilterInputs() {
    if (document.activeElement !== els.timelineSearch) {
      els.timelineSearch.value = uiState.filters.timeline.search;
    }
    if (document.activeElement !== els.timelineKind) {
      els.timelineKind.value = uiState.filters.timeline.kind;
    }
    if (document.activeElement !== els.validationSearch) {
      els.validationSearch.value = uiState.filters.validation.search;
    }
    if (document.activeElement !== els.validationStatus) {
      els.validationStatus.value = uiState.filters.validation.status;
    }
    if (document.activeElement !== els.deliverySearch) {
      els.deliverySearch.value = uiState.filters.delivery.search;
    }
    if (document.activeElement !== els.deliveryStatus) {
      els.deliveryStatus.value = uiState.filters.delivery.status;
    }
  }

  function filterTimeline(items) {
    const filters = uiState.filters.timeline;
    const search = normalize(filters.search);
    return items.filter((item) => {
      const kindMatches = filters.kind === "all" || item.kind === filters.kind;
      if (!kindMatches) {
        return false;
      }
      if (!search) {
        return true;
      }
      return matchesSearch([
        item.kind,
        item.label,
        item.detail,
        item.timestamp,
        JSON.stringify(item.source || {})
      ], search);
    });
  }

  function filterValidationLogs(logs) {
    const filters = uiState.filters.validation;
    const search = normalize(filters.search);
    return logs.filter((entry) => {
      const summary = entry.validation_summary || shared.summarizeValidationEntry(entry);
      const statusMatches = filters.status === "all" || summary.severity === filters.status;
      if (!statusMatches) {
        return false;
      }
      if (!search) {
        return true;
      }
      return matchesSearch([
        entry.event_type,
        entry.timestamp,
        shared.getByPath(entry, "payload.payload.page_url"),
        entry.endpoint,
        summary.label,
        summary.validation_errors.join(" "),
        summary.suggestions.join(" ")
      ], search);
    });
  }

  function filterDeliveryLogs(logs) {
    const filters = uiState.filters.delivery;
    const search = normalize(filters.search);
    return logs.filter((entry) => {
      const statusMatches = filters.status === "all"
        || (filters.status === "sent" && entry.ok)
        || (filters.status === "issue" && !entry.ok);
      if (!statusMatches) {
        return false;
      }
      if (!search) {
        return true;
      }
      return matchesSearch([
        entry.event_type,
        entry.timestamp,
        entry.endpoint,
        entry.status,
        entry.error,
        shared.getByPath(entry, "transport.response_preview"),
        shared.getByPath(entry, "payload.payload.page_url")
      ], search);
    });
  }

  function matchesSearch(values, search) {
    return values.some((value) => normalize(value).includes(search));
  }

  function normalize(value) {
    return String(value || "").toLowerCase();
  }

  function applyUiState() {
    els.appShell.classList.toggle("rail", uiState.sidebarCollapsed);
    els.sidebarToggle.textContent = uiState.sidebarCollapsed ? "Expand" : "Collapse";
    els.sidebarToggle.title = uiState.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar";
    showView(uiState.activeView);
    syncFilterInputs();
  }

  function loadUiState() {
    const defaults = {
      activeView: "overview",
      sidebarCollapsed: false,
      filters: {
        timeline: { search: "", kind: "all" },
        validation: { search: "", status: "all" },
        delivery: { search: "", status: "all" }
      }
    };
    try {
      const raw = localStorage.getItem(UI_STATE_KEY);
      if (!raw) {
        return defaults;
      }
      const parsed = JSON.parse(raw);
      return {
        activeView: parsed.activeView || defaults.activeView,
        sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
        filters: {
          timeline: Object.assign({}, defaults.filters.timeline, parsed.filters && parsed.filters.timeline),
          validation: Object.assign({}, defaults.filters.validation, parsed.filters && parsed.filters.validation),
          delivery: Object.assign({}, defaults.filters.delivery, parsed.filters && parsed.filters.delivery)
        }
      };
    } catch (_error) {
      return defaults;
    }
  }

  function saveUiState() {
    try {
      localStorage.setItem(UI_STATE_KEY, JSON.stringify(uiState));
    } catch (_error) {
      // Ignore quota or DevTools persistence errors.
    }
  }

  async function getActiveTab() {
    if (targetTabId) {
      try {
        return await tabsGet(Number(targetTabId));
      } catch (_error) {
        return null;
      }
    }
    if (isDevToolsWorkbench && chrome.devtools && chrome.devtools.inspectedWindow) {
      try {
        return await tabsGet(chrome.devtools.inspectedWindow.tabId);
      } catch (_error) {
        return {
          id: chrome.devtools.inspectedWindow.tabId,
          title: "Inspected page",
          url: ""
        };
      }
    }
    const tabs = await tabsQuery({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function ensureEndpointPermission(endpoint) {
    const pattern = shared.endpointPermissionPattern(endpoint);
    if (!pattern) {
      return { ok: false, error: "Invalid collection endpoint URL." };
    }
    const granted = await permissionsContains({ origins: [pattern] });
    if (granted) {
      return { ok: true };
    }
    const requested = await permissionsRequest({ origins: [pattern] });
    return { ok: requested, error: requested ? null : `Endpoint permission was not granted for ${pattern}.` };
  }

  async function ensureSitePermission(pageUrl) {
    const pattern = shared.pagePermissionPattern(pageUrl);
    if (!pattern) {
      return { ok: true };
    }
    const granted = await permissionsContains({ origins: [pattern] });
    if (granted) {
      return { ok: true };
    }
    const requested = await permissionsRequest({ origins: [pattern] });
    return { ok: requested, error: requested ? null : `Site permission was not granted for ${pattern}.` };
  }

  async function runtimeMessage(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      if (handlePossibleContextInvalidation(error)) {
        return { ok: false, error: "Extension reloaded. Close and reopen the Meiro Workbench panel." };
      }
      throw error;
    }
  }

  async function tabsGet(tabId) {
    try {
      return await chrome.tabs.get(tabId);
    } catch (error) {
      if (handlePossibleContextInvalidation(error)) {
        return null;
      }
      throw error;
    }
  }

  async function tabsQuery(queryInfo) {
    try {
      return await chrome.tabs.query(queryInfo);
    } catch (error) {
      if (handlePossibleContextInvalidation(error)) {
        return [];
      }
      throw error;
    }
  }

  async function permissionsContains(permissions) {
    try {
      return await chrome.permissions.contains(permissions);
    } catch (error) {
      if (handlePossibleContextInvalidation(error)) {
        return false;
      }
      throw error;
    }
  }

  async function permissionsRequest(permissions) {
    try {
      return await chrome.permissions.request(permissions);
    } catch (error) {
      if (handlePossibleContextInvalidation(error)) {
        return false;
      }
      throw error;
    }
  }

  function handlePossibleContextInvalidation(error) {
    const message = error && error.message ? error.message : String(error || "");
    if (!/Extension context invalidated|context invalidated|Receiving end does not exist|message port closed/i.test(message)) {
      return false;
    }

    contextInvalidated = true;
    stopPolling();
    setMessage("Extension reloaded. Close and reopen the Meiro Workbench panel in DevTools.", true);
    return true;
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }
})();
