(async function initDebugLog() {
  "use strict";

  const list = document.getElementById("logList");
  const refreshButton = document.getElementById("refreshButton");
  const workbenchButton = document.getElementById("workbenchButton");
  const exportButton = document.getElementById("exportButton");
  const clearButton = document.getElementById("clearButton");
  let logs = [];

  refreshButton.addEventListener("click", load);
  workbenchButton.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("workbench/workbench.html") });
  });
  exportButton.addEventListener("click", exportLogs);
  clearButton.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "CLEAR_LOGS" });
    await load();
  });

  await load();
  setInterval(load, 3000);

  async function load() {
    const response = await chrome.runtime.sendMessage({ type: "GET_LOGS" });
    logs = response.logs || [];
    render();
  }

  function render() {
    list.textContent = "";
    if (!logs.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No events captured yet.";
      list.appendChild(empty);
      return;
    }

    logs.forEach((entry) => {
      const article = document.createElement("article");
      article.className = "entry";

      const header = document.createElement("div");
      header.className = "entry-header";

      const title = document.createElement("div");
      title.innerHTML = `<span class="event-type"></span> <span class="meta"></span>`;
      title.querySelector(".event-type").textContent = entry.event_type;
      title.querySelector(".meta").textContent = `${entry.timestamp} · tab ${entry.tabId || "-"}`;

      const status = document.createElement("span");
      status.className = `status${entry.ok ? " ok" : ""}`;
      status.textContent = entry.ok ? `OK ${entry.status || ""}` : entry.error || `HTTP ${entry.status || "error"}`;

      const endpoint = document.createElement("div");
      endpoint.className = "meta";
      endpoint.textContent = entry.endpoint || "";

      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify(entry.payload, null, 2);

      header.append(title, status);
      article.append(header, endpoint, pre);
      list.appendChild(article);
    });
  }

  function exportLogs() {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `meiro-event-simulator-logs-${new Date().toISOString()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
})();
