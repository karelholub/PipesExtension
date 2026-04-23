(function installDevToolsPanels() {
  "use strict";

  const workbenchPage = "workbench/workbench.html?devtools=1";
  const icon = "assets/icon32.png";

  chrome.devtools.panels.create(
    "Meiro Workbench",
    icon,
    workbenchPage,
    function noop() {}
  );

  chrome.devtools.panels.elements.createSidebarPane("Meiro", (sidebar) => {
    sidebar.setPage(workbenchPage);
    sidebar.setHeight("640px");
  });
})();
