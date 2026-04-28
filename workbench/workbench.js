(function initWorkbench() {
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
    pipesSetupQueue: document.getElementById("pipesSetupQueue"),
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
    pipesControl: document.getElementById("pipesControl"),
    trackingRulesEditor: document.getElementById("trackingRulesEditor"),
    generateTrackingRulesButton: document.getElementById("generateTrackingRulesButton"),
    saveTrackingRulesButton: document.getElementById("saveTrackingRulesButton"),
    sourceFunctionEditor: document.getElementById("sourceFunctionEditor"),
    saveSourceFunctionButton: document.getElementById("saveSourceFunctionButton"),
    sourceTestSummary: document.getElementById("sourceTestSummary"),
    sourceTestPayload: document.getElementById("sourceTestPayload"),
    sourceTestHeaders: document.getElementById("sourceTestHeaders"),
    sourceTestResult: document.getElementById("sourceTestResult"),
    runSourceTestButton: document.getElementById("runSourceTestButton"),
    pipesEventTypes: document.getElementById("pipesEventTypes"),
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
  const sourceTestState = {
    payload: "",
    headers: "{\n  \n}",
    result: null
  };
  const sourceDraftState = {
    sourceId: null,
    trackingRulesCode: "",
    sourceFunctionCode: ""
  };

  window.addEventListener("unhandledrejection", (event) => {
    if (handlePossibleContextInvalidation(event.reason)) {
      event.preventDefault();
    }
  });
  window.addEventListener("error", (event) => {
    if (handlePossibleContextInvalidation(event.error || event.message)) {
      event.preventDefault();
    }
  });

  document.querySelectorAll(".nav button").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });
  els.sidebarToggle.addEventListener("click", toggleSidebar);

  document.getElementById("refreshButton").addEventListener("click", safeAction(load));
  document.getElementById("enableButton").addEventListener("click", safeAction(enableTab));
  document.getElementById("disableButton").addEventListener("click", safeAction(disableTab));
  document.getElementById("exportSetupButton").addEventListener("click", exportSetup);
  document.getElementById("saveDataLayersButton").addEventListener("click", safeAction(saveDataLayerNames));
  document.getElementById("pickerButton").addEventListener("click", safeAction(startPicker));
  document.getElementById("clearLogsButton").addEventListener("click", safeAction(clearLogs));
  document.getElementById("saveContractsButton").addEventListener("click", safeAction(saveContracts));
  document.getElementById("createProfileButton").addEventListener("click", safeAction(createProfile));
  els.generateTrackingRulesButton.addEventListener("click", generateTrackingRulesFromSelectorRules);
  els.saveTrackingRulesButton.addEventListener("click", safeAction(saveTrackingRules));
  els.saveSourceFunctionButton.addEventListener("click", safeAction(saveSourceFunction));
  els.runSourceTestButton.addEventListener("click", safeAction(runSourceTest));
  els.trackingRulesEditor.addEventListener("input", () => {
    sourceDraftState.trackingRulesCode = els.trackingRulesEditor.value;
  });
  els.sourceFunctionEditor.addEventListener("input", () => {
    sourceDraftState.sourceFunctionCode = els.sourceFunctionEditor.value;
  });
  els.sourceTestPayload.addEventListener("input", () => {
    sourceTestState.payload = els.sourceTestPayload.value;
  });
  els.sourceTestHeaders.addEventListener("input", () => {
    sourceTestState.headers = els.sourceTestHeaders.value;
  });
  els.ruleForm.addEventListener("submit", safeAction(saveRule));
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

  safeStartup();

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

  function safeStartup() {
    safeAction(async () => {
      applyUiState();
      await load();
      pollTimer = setInterval(() => {
        if (!document.hidden) {
          safeAction(load)();
        }
      }, 1500);
      window.addEventListener("beforeunload", stopPolling, { once: true });
    })();
  }

  function safeAction(fn) {
    return (...args) => {
      Promise.resolve()
        .then(() => fn(...args))
        .catch((error) => {
          if (!handlePossibleContextInvalidation(error)) {
            setMessage(error && error.message ? error.message : String(error), true);
          }
        });
    };
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

    renderStack(els.pipesSetupQueue, buildPipesSetupQueue().map((item) => pipesSetupCard(item)), "Capture events and connect Prism to see Pipes setup tasks.");
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
    if (uiState.activeView === "profiles" && isProfilesEditorFocused()) {
      return;
    }
    renderPipesControl();
    renderSourceEditors();
    renderSourceTest();
    renderPipesEventTypes();
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

  async function saveTrackingRules() {
    sourceDraftState.trackingRulesCode = els.trackingRulesEditor.value;
    const response = await runtimeMessage({
      type: "SAVE_PRISM_TRACKING_RULES",
      code: sourceDraftState.trackingRulesCode
    });
    setMessage(response.ok ? "Tracking rules saved to Pipes." : response.error, !response.ok);
    await load();
  }

  async function saveSourceFunction() {
    sourceDraftState.sourceFunctionCode = els.sourceFunctionEditor.value;
    const response = await runtimeMessage({
      type: "SAVE_PRISM_SOURCE_FUNCTION",
      code: sourceDraftState.sourceFunctionCode
    });
    setMessage(response.ok ? "Source transform saved to Pipes." : response.error, !response.ok);
    await load();
  }

  function generateTrackingRulesFromSelectorRules() {
    const rules = state.settings && Array.isArray(state.settings.selector_rules)
      ? state.settings.selector_rules.filter((rule) => rule.enabled !== false && rule.selector)
      : [];
    if (!rules.length) {
      setMessage("No enabled selector rules are available to generate tracking rules.", true);
      return;
    }

    sourceDraftState.trackingRulesCode = buildTrackingRulesCode(rules);
    els.trackingRulesEditor.value = sourceDraftState.trackingRulesCode;
    setMessage("Generated tracking rules from local selector rules. Review before saving to Pipes.");
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
    removeButton.addEventListener("click", safeAction(async () => {
      const rules = (state.settings.selector_rules || []).filter((_item, ruleIndex) => ruleIndex !== index);
      await runtimeMessage({ type: "SAVE_SELECTOR_RULES", rules });
      await load();
    }));
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
    replayButton.addEventListener("click", safeAction(async () => {
      const response = await runtimeMessage({ type: "REPLAY_EVENT", payload: entry.payload });
      setMessage(response.ok ? "Payload replayed." : response.error, !response.ok);
      await load();
    }));
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.textContent = "Copy JSON";
    copyButton.addEventListener("click", safeAction(async () => {
      await navigator.clipboard.writeText(JSON.stringify(entry.payload, null, 2));
      setMessage("Payload copied.");
    }));
    const verifyButton = document.createElement("button");
    verifyButton.type = "button";
    verifyButton.textContent = "Verify in Pipes";
    verifyButton.disabled = !canSyncPipesEventType(entry);
    verifyButton.addEventListener("click", safeAction(async () => {
      const response = await runtimeMessage({
        type: "VERIFY_PRISM_EVENT_PAYLOAD",
        payload: entry.payload
      });
      if (response.ok) {
        setMessage(pipesVerificationMessage(response.verification));
        body.appendChild(compactJsonCard("Router validation", response.verification));
      } else {
        setMessage(response.error, true);
      }
    }));
    actions.append(replayButton, copyButton, verifyButton);
    if (canSyncPipesEventType(entry)) {
      const syncButton = document.createElement("button");
      syncButton.type = "button";
      syncButton.textContent = pipesEventTypeExists(entry.event_type) ? "Sync Pipes definition" : "Define in Pipes";
      syncButton.addEventListener("click", safeAction(async () => {
        const response = await runtimeMessage({
          type: "SYNC_PRISM_EVENT_TYPE_FROM_EVENT",
          eventType: entry.event_type,
          payload: entry.payload,
          verify: true
        });
        if (response.ok) {
          setMessage(`${pipesSyncMessage(entry.event_type, response)} ${pipesVerificationMessage(response.verification)}`);
        } else {
          setMessage(response.error, true);
        }
        await load();
      }));
      actions.appendChild(syncButton);
    }
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

  function pipesSetupCard(item) {
    const article = document.createElement("article");
    article.className = "item";
    article.innerHTML = `<div class="item-head"><div><div class="item-title"></div><div class="item-meta"></div></div><div class="inline-buttons"></div></div><div class="item-body"></div>`;
    article.querySelector(".item-title").textContent = item.event_type;
    article.querySelector(".item-meta").textContent = `${item.count} captured · ${item.fail_count} issue(s) · last seen ${item.last_seen_at || "n/a"}`;
    article.querySelector(".inline-buttons").appendChild(pill(item.exists ? "defined" : "missing", item.exists ? "good" : "bad"));
    if (item.has_unknown_type_error) {
      article.querySelector(".inline-buttons").appendChild(pill("router rejected", "bad"));
    }

    const body = article.querySelector(".item-body");
    const fields = document.createElement("div");
    fields.className = "kv";
    fields.appendChild(kvBox("Pipes Event Type", item.exists ? "exists" : "missing"));
    fields.appendChild(kvBox("Last outcome", item.last_ok ? "accepted" : "needs attention"));
    fields.appendChild(kvBox("Sample", item.sample ? "available" : "missing"));
    body.appendChild(fields);

    const actions = document.createElement("div");
    actions.className = "inline-buttons";
    const syncButton = document.createElement("button");
    syncButton.type = "button";
    syncButton.textContent = item.exists ? "Sync definition" : "Create definition";
    syncButton.disabled = !item.sample || !canSyncPipesEventType(item.sample);
    syncButton.addEventListener("click", safeAction(async () => {
      const response = await runtimeMessage({
        type: "SYNC_PRISM_EVENT_TYPE_FROM_EVENT",
        eventType: item.event_type,
        payload: item.sample.payload,
        verify: true
      });
      if (response.ok) {
        setMessage(`${pipesSyncMessage(item.event_type, response)} ${pipesVerificationMessage(response.verification)}`);
        if (response.verification) {
          body.appendChild(compactJsonCard("Router validation", response.verification));
        }
      } else {
        setMessage(response.error, true);
      }
      await load();
    }));
    actions.appendChild(syncButton);
    body.appendChild(actions);
    return article;
  }

  function buildPipesSetupQueue() {
    const pipes = state && state.pipes ? state.pipes : null;
    if (!pipes || !pipes.ok || !pipes.source) {
      return [];
    }

    const eventTypes = new Set((pipes.event_types || []).map((item) => item.name));
    const byType = new Map();
    (state.logs || []).forEach((entry) => {
      const eventType = entry.event_type || "unknown";
      const current = byType.get(eventType) || {
        event_type: eventType,
        count: 0,
        fail_count: 0,
        last_seen_at: null,
        last_ok: false,
        sample: null,
        exists: eventTypes.has(eventType),
        has_unknown_type_error: false
      };
      current.count += 1;
      if (!entry.ok) {
        current.fail_count += 1;
      }
      if (!current.last_seen_at || Date.parse(entry.timestamp || "") >= Date.parse(current.last_seen_at || "")) {
        current.last_seen_at = entry.timestamp || null;
        current.last_ok = Boolean(entry.ok);
        current.sample = entry.payload ? entry : current.sample;
      }
      const semanticErrors = entry.transport && Array.isArray(entry.transport.semantic_errors)
        ? entry.transport.semantic_errors
        : [];
      current.has_unknown_type_error = current.has_unknown_type_error
        || semanticErrors.some((item) => /unknown event[_ ]type/i.test(item))
        || Boolean(entry.error && /unknown event[_ ]type/i.test(entry.error));
      byType.set(eventType, current);
    });

    return Array.from(byType.values())
      .filter((item) => !item.exists || item.fail_count || item.has_unknown_type_error)
      .sort((left, right) => {
        if (left.exists !== right.exists) {
          return left.exists ? 1 : -1;
        }
        return (right.fail_count - left.fail_count) || (right.count - left.count);
      });
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
    applyButton.addEventListener("click", safeAction(async () => {
      const response = await runtimeMessage({ type: "APPLY_PROFILE", profileId: profile.id });
      setMessage(response.ok ? "Profile applied." : response.error, !response.ok);
      await load();
    }));
    article.querySelector(".inline-buttons").appendChild(applyButton);
    return article;
  }

  function prismEventTypeCard(eventType) {
    const article = document.createElement("article");
    article.className = "item";
    article.innerHTML = `<div class="item-head"><div><div class="item-title"></div><div class="item-meta"></div></div><div class="inline-buttons"></div></div><div class="item-body"></div>`;
    article.querySelector(".item-title").textContent = eventType.name;
    article.querySelector(".item-meta").textContent = `version ${eventType.version || "n/a"} · ${(eventType.identifierRules || []).length} identifier rule(s)`;
    const body = article.querySelector(".item-body");
    const actions = article.querySelector(".inline-buttons");

    const nameField = fieldWithInput("Name", "text", eventType.name);
    const schemaField = fieldWithTextarea("JSON Schema", eventType.jsonSchema === null ? "null" : JSON.stringify(eventType.jsonSchema, null, 2), true);
    const rulesField = fieldWithTextarea("Identifier rules", JSON.stringify((eventType.identifierRules || []).map((rule) => ({
      identifierTypeId: rule.identifierTypeId,
      identifierTypeName: rule.identifierTypeName,
      rule: rule.rule
    })), null, 2), true);
    const previewOutput = document.createElement("div");
    previewOutput.className = "stack event-type-preview";
    previewOutput.appendChild(emptyState("Preview schema and identifier extraction before saving changes to Pipes."));
    body.append(
      nameField.field,
      schemaField.field,
      identifierRuleBuilder(eventType, rulesField.input, schemaField.input, previewOutput),
      rulesField.field,
      previewOutput
    );

    const previewButton = document.createElement("button");
    previewButton.type = "button";
    previewButton.textContent = "Preview";
    previewButton.addEventListener("click", () => {
      previewEventTypeConfig(eventType, schemaField.input.value, rulesField.input.value, previewOutput);
    });

    const inferSchemaButton = document.createElement("button");
    inferSchemaButton.type = "button";
    inferSchemaButton.textContent = "Infer schema";
    inferSchemaButton.addEventListener("click", () => {
      const sample = samplePayloadForEventType(eventType.name);
      if (!sample) {
        setMessage("No sample payload is available to infer a schema.", true);
        return;
      }
      schemaField.input.value = JSON.stringify(inferJsonSchemaFromSample(sample.payload), null, 2);
      previewEventTypeConfig(eventType, schemaField.input.value, rulesField.input.value, previewOutput);
      setMessage(`Inferred schema from ${sample.source}. Review before saving.`);
    });

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.textContent = "Save";
    saveButton.addEventListener("click", safeAction(async () => {
      try {
        const response = await runtimeMessage({
          type: "UPDATE_PRISM_EVENT_TYPE",
          eventTypeId: eventType.id,
          updates: {
            name: nameField.input.value.trim(),
            jsonSchema: parseNullableJson(schemaField.input.value),
            identifierRules: parseIdentifierRules(rulesField.input.value)
          }
        });
        setMessage(response.ok ? `Saved Event Type '${nameField.input.value.trim()}'.` : response.error, !response.ok);
        await load();
      } catch (error) {
        setMessage(error.message || String(error), true);
      }
    }));
    actions.append(previewButton, inferSchemaButton, saveButton);
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
    applyButton.addEventListener("click", safeAction(async () => {
      const response = await runtimeMessage({
        type: "APPLY_RECIPE",
        recipeId: recipe.id,
        selection: selection || null
      });
      setMessage(response.ok ? `${recipe.name} recipe applied.` : response.error, !response.ok);
      await load();
    }));
    article.querySelector(".inline-buttons").appendChild(applyButton);
    return article;
  }

  function renderPipesControl() {
    const pipes = state.pipes || {};
    const nodes = [];
    nodes.push(compactJsonCard("Connection", {
      ok: pipes.ok,
      base_url: pipes.base_url || null,
      source_slug: pipes.source_slug || null,
      source: pipes.source ? { id: pipes.source.id, name: pipes.source.name, slug: pipes.source.slug, enabled: pipes.source.isEnabled !== false } : null,
      event_types: Array.isArray(pipes.event_types) ? pipes.event_types.length : 0,
      identifier_types: Array.isArray(pipes.identifier_types) ? pipes.identifier_types.length : 0,
      error: pipes.error || null
    }));

    if (pipes.source && Array.isArray(pipes.event_types) && pipes.event_types.length) {
      nodes.push(compactJsonCard("Resolved source Event Types", pipes.event_types.map((item) => item.name).sort()));
    }

    renderStack(els.pipesControl, nodes, "Add a Prism token in Options to manage Pipes sources and Event Types.");
  }

  function renderSourceEditors() {
    const pipes = state.pipes || {};
    const source = pipes.source || null;
    const sourceId = source && source.id ? source.id : null;
    if (sourceDraftState.sourceId !== sourceId) {
      sourceDraftState.sourceId = sourceId;
      sourceDraftState.trackingRulesCode = source && source.trackingRulesCode ? source.trackingRulesCode : "";
      sourceDraftState.sourceFunctionCode = source && source.functionCode ? source.functionCode : "";
    }

    if (document.activeElement !== els.trackingRulesEditor) {
      els.trackingRulesEditor.value = sourceDraftState.trackingRulesCode || "";
    }
    if (document.activeElement !== els.sourceFunctionEditor) {
      els.sourceFunctionEditor.value = sourceDraftState.sourceFunctionCode || "";
    }
  }

  function renderSourceTest() {
    const pipes = state.pipes || {};
    const source = pipes.source || null;
    const examples = pipes.recent_examples || [];
    if (!sourceTestState.payload && examples.length && examples[0].payload !== undefined) {
      sourceTestState.payload = JSON.stringify(examples[0].payload, null, 2);
    }

    els.sourceTestSummary.textContent = source
      ? `${source.name} · ${source.slug} · ${source.isEnabled ? "enabled" : "disabled"}`
      : (pipes.error || "Resolve a Pipes source from the configured collection endpoint to run transform tests.");

    if (document.activeElement !== els.sourceTestPayload) {
      els.sourceTestPayload.value = sourceTestState.payload || "";
    }
    if (document.activeElement !== els.sourceTestHeaders) {
      els.sourceTestHeaders.value = sourceTestState.headers || "{\n  \n}";
    }
    els.sourceTestResult.textContent = sourceTestState.result
      ? JSON.stringify(sourceTestState.result, null, 2)
      : "Run the current source transform against a recent payload example.";
  }

  function renderPipesEventTypes() {
    const pipes = state.pipes || {};
    renderStack(els.pipesEventTypes, (pipes.event_types || []).map((eventType) => prismEventTypeCard(eventType)), "No Event Types are available for the resolved source.");
  }

  function identifierRuleBuilder(eventType, rulesInput, schemaInput, previewOutput) {
    const identifierTypes = state && state.pipes && Array.isArray(state.pipes.identifier_types)
      ? state.pipes.identifier_types
      : [];
    const sample = samplePayloadForEventType(eventType.name);
    const pathSuggestions = sample ? collectScalarJsonPaths(sample.payload).slice(0, 50) : [];
    const builder = document.createElement("div");
    builder.className = "identifier-builder";
    const datalistId = `identifier-paths-${String(eventType.id || eventType.name).replace(/[^a-z0-9_-]/gi, "-")}`;
    builder.innerHTML = `
      <label class="field">
        <span>Identifier type</span>
        <select></select>
      </label>
      <label class="field">
        <span>Payload path</span>
        <input type="text" spellcheck="false" list="${datalistId}" placeholder="$.user_id">
        <datalist id="${datalistId}"></datalist>
      </label>
      <div class="inline-buttons builder-actions"></div>
    `;
    const select = builder.querySelector("select");
    const pathInput = builder.querySelector("input");
    const datalist = builder.querySelector("datalist");
    const actions = builder.querySelector(".builder-actions");

    identifierTypes.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name || item.id;
      select.appendChild(option);
    });
    pathSuggestions.forEach((path) => {
      const option = document.createElement("option");
      option.value = path;
      datalist.appendChild(option);
    });
    pathInput.value = inferLikelyIdentifierPath(pathSuggestions) || "";

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.textContent = "Add identifier";
    addButton.disabled = !identifierTypes.length;
    addButton.addEventListener("click", () => {
      try {
        const selectedType = identifierTypes.find((item) => item.id === select.value);
        const path = normalizeIdentifierPath(pathInput.value);
        if (!selectedType) {
          throw new Error("Choose an identifier type first.");
        }
        if (!path) {
          throw new Error("Payload path is required.");
        }

        const rules = parseIdentifierRulesPreview(rulesInput.value);
        const exists = rules.some((rule) => rule.identifierTypeId === selectedType.id && rule.rule === path);
        if (!exists) {
          rules.push({
            identifierTypeId: selectedType.id,
            identifierTypeName: selectedType.name,
            rule: path
          });
        }
        rulesInput.value = JSON.stringify(rules, null, 2);
        previewEventTypeConfig(eventType, schemaInput.value, rulesInput.value, previewOutput);
        setMessage(exists ? "Identifier rule already exists." : "Identifier rule added. Preview updated.");
      } catch (error) {
        setMessage(error.message || String(error), true);
      }
    });

    const inferButton = document.createElement("button");
    inferButton.type = "button";
    inferButton.textContent = "Suggest path";
    inferButton.disabled = !pathSuggestions.length;
    inferButton.addEventListener("click", () => {
      pathInput.value = inferLikelyIdentifierPath(pathSuggestions) || pathSuggestions[0] || "";
    });

    actions.append(inferButton, addButton);
    if (!identifierTypes.length) {
      builder.appendChild(subtleBox("No identifier types are available from Pipes. Check the Prism token and source permissions."));
    }
    return builder;
  }

  function previewEventTypeConfig(eventType, schemaText, rulesText, target) {
    target.textContent = "";
    try {
      const schema = parseNullableJson(schemaText);
      const rules = parseIdentifierRulesPreview(rulesText);
      const sample = samplePayloadForEventType(eventType.name);
      if (!sample) {
        target.appendChild(emptyState("No sample payload is available. Run the source transform test or capture a matching event first."));
        return;
      }

      const schemaErrors = validateSimpleJsonSchema(schema, sample.payload);
      const identifierResults = rules.map((rule) => {
        const value = evaluateJsonPath(sample.payload, rule.rule);
        return {
          identifier_type: rule.identifierTypeName || rule.identifierTypeId || "unknown",
          rule: rule.rule,
          found: value !== undefined,
          value: summarizeValue(value)
        };
      });

      target.appendChild(summaryPreviewCard("Preview source", [
        kvBox("Source", sample.source),
        kvBox("Event Type", eventType.name),
        kvBox("Schema", schemaErrors.length ? `${schemaErrors.length} issue(s)` : "pass"),
        kvBox("Identifiers", `${identifierResults.filter((item) => item.found).length}/${identifierResults.length} found`)
      ]));
      target.appendChild(compactJsonCard("Schema validation", schemaErrors.length ? schemaErrors : ["Sample payload matches the configured schema checks."]));
      target.appendChild(compactJsonCard("Identifier extraction", identifierResults.length ? identifierResults : ["No identifier rules configured."]));
    } catch (error) {
      target.appendChild(subtleBox(error.message || String(error)));
    }
  }

  function samplePayloadForEventType(eventTypeName) {
    const testedEvents = sourceTestState.result && Array.isArray(sourceTestState.result.events)
      ? sourceTestState.result.events
      : [];
    const testedMatch = testedEvents.find((event) => event && event.event_type === eventTypeName) || testedEvents[0];
    if (testedMatch) {
      return {
        source: testedMatch.event_type === eventTypeName ? "source transform test output" : "source transform test output fallback",
        payload: testedMatch.event_payload !== undefined ? testedMatch.event_payload : testedMatch
      };
    }

    const logs = state && Array.isArray(state.logs) ? state.logs : [];
    const logMatch = logs.find((entry) => entry.event_type === eventTypeName && entry.payload);
    if (logMatch) {
      const eventPayload = shared.getByPath(logMatch, "payload.payload");
      return {
        source: "captured extension event payload",
        payload: eventPayload || logMatch.payload
      };
    }

    const examples = state && state.pipes && Array.isArray(state.pipes.recent_examples)
      ? state.pipes.recent_examples
      : [];
    for (const example of examples) {
      const payload = example && example.payload !== undefined ? example.payload : example;
      const normalizedPayloads = Array.isArray(payload) ? payload : [payload];
      const match = normalizedPayloads.find((item) => item && (item.type === eventTypeName || item.event_type === eventTypeName || item.original_type === eventTypeName));
      if (match) {
        return { source: "recent Pipes example", payload: match.payload || match.event_payload || match };
      }
    }
    if (examples.length && examples[0].payload !== undefined) {
      return { source: "recent Pipes raw example fallback", payload: examples[0].payload };
    }
    return null;
  }

  function validateSimpleJsonSchema(schema, payload, path) {
    const errors = [];
    const currentPath = path || "$";
    if (!schema) {
      return errors;
    }
    if (typeof schema !== "object" || Array.isArray(schema)) {
      return [`${currentPath}: schema must be an object or null.`];
    }

    const expectedType = normalizeSchemaType(schema.type);
    if (expectedType && !schemaTypeMatches(expectedType, payload)) {
      errors.push(`${currentPath}: expected ${expectedType}, received ${valueType(payload)}.`);
      return errors;
    }

    if (Array.isArray(schema.enum) && !schema.enum.includes(payload)) {
      errors.push(`${currentPath}: value is not in enum.`);
    }

    if (expectedType === "object" || schema.properties || schema.required) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        errors.push(`${currentPath}: expected object for properties check.`);
        return errors;
      }
      (schema.required || []).forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(payload, key)) {
          errors.push(`${currentPath}.${key}: required property is missing.`);
        }
      });
      Object.entries(schema.properties || {}).forEach(([key, childSchema]) => {
        if (Object.prototype.hasOwnProperty.call(payload, key)) {
          errors.push(...validateSimpleJsonSchema(childSchema, payload[key], `${currentPath}.${key}`));
        }
      });
    }

    if ((expectedType === "array" || schema.items) && Array.isArray(payload) && schema.items) {
      payload.slice(0, 20).forEach((item, index) => {
        errors.push(...validateSimpleJsonSchema(schema.items, item, `${currentPath}[${index}]`));
      });
    }

    return errors;
  }

  function normalizeSchemaType(type) {
    if (!type) {
      return "";
    }
    const value = Array.isArray(type) ? type[0] : type;
    return String(value).toLowerCase();
  }

  function schemaTypeMatches(expectedType, value) {
    if (expectedType === "object") {
      return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    }
    if (expectedType === "array") {
      return Array.isArray(value);
    }
    if (expectedType === "integer") {
      return Number.isInteger(value);
    }
    if (expectedType === "number") {
      return typeof value === "number" && Number.isFinite(value);
    }
    if (expectedType === "string") {
      return typeof value === "string";
    }
    if (expectedType === "boolean") {
      return typeof value === "boolean";
    }
    if (expectedType === "null") {
      return value === null;
    }
    return true;
  }

  function valueType(value) {
    if (value === null) {
      return "null";
    }
    if (Array.isArray(value)) {
      return "array";
    }
    return typeof value;
  }

  function evaluateJsonPath(payload, path) {
    const raw = String(path || "").trim();
    if (!raw || raw === "$") {
      return payload;
    }
    if (!raw.startsWith("$.")) {
      return shared.getByPath(payload, raw);
    }

    const tokens = [];
    raw.slice(2).replace(/\[(\d+)\]/g, ".$1").split(".").forEach((part) => {
      if (part) {
        tokens.push(part);
      }
    });
    return tokens.reduce((value, key) => {
      if (value === undefined || value === null) {
        return undefined;
      }
      return value[key];
    }, payload);
  }

  function collectScalarJsonPaths(value, prefix, results) {
    const output = results || [];
    const path = prefix || "$";
    if (output.length >= 100) {
      return output;
    }
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      output.push(path);
      return output;
    }
    if (Array.isArray(value)) {
      value.slice(0, 5).forEach((item, index) => collectScalarJsonPaths(item, `${path}[${index}]`, output));
      return output;
    }
    if (value && typeof value === "object") {
      Object.entries(value).forEach(([key, childValue]) => {
        collectScalarJsonPaths(childValue, `${path}.${key}`, output);
      });
    }
    return output;
  }

  function inferLikelyIdentifierPath(paths) {
    const candidates = [
      "$.user_id",
      "$.meiro_user_id",
      "$.client_ids.meiro_user_id",
      "$.client_ids.user_id",
      "$.payload.user_id",
      "$.payload.client_ids.meiro_user_id"
    ];
    const normalized = new Set(paths);
    const direct = candidates.find((candidate) => normalized.has(candidate));
    if (direct) {
      return direct;
    }
    return paths.find((path) => /(^|[._])user[_-]?id$/i.test(path))
      || paths.find((path) => /(^|[._])meiro/i.test(path))
      || paths.find((path) => /(^|[._])email(_hash|hash|_sha256)?$/i.test(path))
      || "";
  }

  function normalizeIdentifierPath(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) {
      return "";
    }
    return trimmed.startsWith("$") ? trimmed : `$.${trimmed.replace(/^\.+/, "")}`;
  }

  function summarizeValue(value) {
    if (value === undefined) {
      return null;
    }
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    return JSON.stringify(value).slice(0, 240);
  }

  function inferJsonSchemaFromSample(value) {
    if (Array.isArray(value)) {
      const firstDefined = value.find((item) => item !== undefined);
      return {
        type: "ARRAY",
        items: firstDefined === undefined ? {} : inferJsonSchemaFromSample(firstDefined)
      };
    }
    if (value && typeof value === "object") {
      const properties = {};
      Object.entries(value).forEach(([key, childValue]) => {
        properties[key] = inferJsonSchemaFromSample(childValue);
      });
      return {
        type: "OBJECT",
        properties
      };
    }
    if (typeof value === "number") {
      return { type: Number.isInteger(value) ? "INTEGER" : "NUMBER" };
    }
    if (typeof value === "boolean") {
      return { type: "BOOLEAN" };
    }
    if (value === null) {
      return { type: "NULL" };
    }
    return { type: "STRING" };
  }

  function summaryPreviewCard(title, nodes) {
    const article = document.createElement("article");
    article.className = "card";
    article.innerHTML = `<div class="card-header"><h3></h3></div><div class="kv"></div>`;
    article.querySelector("h3").textContent = title;
    const grid = article.querySelector(".kv");
    nodes.forEach((node) => grid.appendChild(node));
    return article;
  }

  function buildTrackingRulesCode(rules) {
    const lines = [
      "function configure(sdk, on) {"
    ];
    rules.forEach((rule) => {
      const selector = JSON.stringify(rule.selector);
      const eventType = JSON.stringify(rule.event_type || "click");
      lines.push(`  on.click(${selector}, (el) => {`);
      lines.push(`    sdk.track(${eventType}, {`);
      lines.push("      selector: el?.selector,");
      lines.push("      text: el?.text,");
      lines.push("      href: el?.href");
      lines.push("    });");
      lines.push("  });");
    });
    lines.push("}");
    return lines.join("\n");
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

  async function runSourceTest() {
    try {
      sourceTestState.payload = els.sourceTestPayload.value;
      sourceTestState.headers = els.sourceTestHeaders.value;
      const payload = parseNullableJson(sourceTestState.payload);
      const headers = parseObjectJson(sourceTestState.headers, "Headers JSON must parse to an object.");
      const response = await runtimeMessage({
        type: "TEST_PRISM_SOURCE",
        payload,
        headers
      });
      if (!response.ok) {
        setMessage(response.error, true);
        return;
      }
      sourceTestState.result = response.result;
      renderSourceTest();
      setMessage("Source transform test completed.");
    } catch (error) {
      setMessage(error.message || String(error), true);
    }
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

  function canSyncPipesEventType(entry) {
    const pipes = state && state.pipes ? state.pipes : null;
    if (!pipes || !pipes.ok || !pipes.source) {
      return false;
    }
    const eventType = String(entry && entry.event_type || "").trim();
    if (!eventType) {
      return false;
    }
    return Boolean(entry && entry.payload);
  }

  function pipesEventTypeExists(eventType) {
    const pipes = state && state.pipes ? state.pipes : {};
    return (pipes.event_types || []).some((item) => item.name === eventType);
  }

  function pipesSyncMessage(eventType, response) {
    const sourceName = response.source && response.source.name ? response.source.name : "the resolved source";
    const inferred = response.inferred || {};
    if (response.action === "created") {
      return `Created '${eventType}' on ${sourceName} with inferred schema and ${inferred.identifier_rules || 0} identifier rule(s).`;
    }
    if (response.action === "updated") {
      return `Updated '${eventType}' on ${sourceName}. Added inferred schema/rules where they were missing.`;
    }
    return `'${eventType}' already matches the captured event setup on ${sourceName}.`;
  }

  function pipesVerificationMessage(verification) {
    if (!verification) {
      return "";
    }
    if (verification.ok) {
      return `Source test passed with ${verification.valid_event_count}/${verification.event_count} valid event(s) and ${verification.identifiers || 0} identifier(s).`;
    }
    const errorText = verification.errors && verification.errors.length
      ? verification.errors.slice(0, 2).join(" ")
      : "Source test did not pass.";
    return `Source test needs attention: ${errorText}`;
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

  function getInspectedTabId() {
    try {
      const devtoolsApi = chrome && chrome.devtools ? chrome.devtools : null;
      return devtoolsApi && devtoolsApi.inspectedWindow
        ? devtoolsApi.inspectedWindow.tabId
        : null;
    } catch (error) {
      handlePossibleContextInvalidation(error);
      return null;
    }
  }

  function fieldWithInput(label, type, value) {
    const field = document.createElement("label");
    field.className = "field";
    field.innerHTML = `<span></span><input>`;
    field.querySelector("span").textContent = label;
    const input = field.querySelector("input");
    input.type = type;
    input.value = value || "";
    return { field, input };
  }

  function fieldWithTextarea(label, value, compact) {
    const field = document.createElement("label");
    field.className = "field";
    field.innerHTML = `<span></span><textarea spellcheck="false"></textarea>`;
    field.querySelector("span").textContent = label;
    const input = field.querySelector("textarea");
    if (compact) {
      input.classList.add("compact-editor");
    }
    input.value = value || "";
    return { field, input };
  }

  function parseNullableJson(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed || trimmed === "null") {
      return null;
    }
    return JSON.parse(trimmed);
  }

  function parseObjectJson(value, message) {
    const parsed = parseNullableJson(value);
    if (parsed === null) {
      return {};
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(message);
    }
    return parsed;
  }

  function parseIdentifierRules(value) {
    const parsed = parseNullableJson(value);
    if (!Array.isArray(parsed)) {
      throw new Error("Identifier rules JSON must parse to an array.");
    }
    return parsed.map((rule) => ({
      identifierTypeId: rule.identifierTypeId,
      rule: rule.rule
    }));
  }

  function parseIdentifierRulesPreview(value) {
    const parsed = parseNullableJson(value);
    if (!Array.isArray(parsed)) {
      throw new Error("Identifier rules JSON must parse to an array.");
    }
    return parsed.map((rule, index) => {
      if (!rule || typeof rule !== "object") {
        throw new Error(`Identifier rule ${index + 1} must be an object.`);
      }
      if (!rule.rule) {
        throw new Error(`Identifier rule ${index + 1} is missing a rule path.`);
      }
      return rule;
    });
  }

  function isProfilesEditorFocused() {
    const active = document.activeElement;
    return Boolean(active)
      && /INPUT|TEXTAREA|SELECT/.test(active.tagName)
      && Boolean(active.closest && active.closest("#profiles"));
  }

  async function getActiveTab() {
    if (targetTabId) {
      try {
        return await tabsGet(Number(targetTabId));
      } catch (_error) {
        return null;
      }
    }
    if (isDevToolsWorkbench && hasDevToolsInspectedWindow()) {
      const inspectedTabId = getInspectedTabId();
      if (!inspectedTabId) {
        return null;
      }
      try {
        return await tabsGet(inspectedTabId);
      } catch (_error) {
        return {
          id: inspectedTabId,
          title: "Inspected page",
          url: ""
        };
      }
    }
    const tabs = await tabsQuery({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  function hasDevToolsInspectedWindow() {
    try {
      return Boolean(chrome && chrome.devtools && chrome.devtools.inspectedWindow);
    } catch (error) {
      handlePossibleContextInvalidation(error);
      return false;
    }
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
