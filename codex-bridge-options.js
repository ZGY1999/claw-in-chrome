(function () {
  const STORAGE_KEY = "codexBridgeConfig";
  const DEFAULTS = {
    enabled: false,
    hostName: "com.zgy1999.codex_bridge",
    defaultCwd: "",
    defaultModel: "",
    sandbox: "workspace-write",
    ephemeral: true
  };
  const ROOT_ID = "cb-options-root";
  let overlay = null;
  let refs = null;

  function createNode(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text != null) {
      node.textContent = text;
    }
    return node;
  }

  async function readConfig() {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const source = stored[STORAGE_KEY] || {};
    return {
      enabled: !!source.enabled,
      hostName: String(source.hostName || DEFAULTS.hostName).trim() || DEFAULTS.hostName,
      defaultCwd: String(source.defaultCwd || "").trim(),
      defaultModel: String(source.defaultModel || "").trim(),
      sandbox: String(source.sandbox || DEFAULTS.sandbox).trim() || DEFAULTS.sandbox,
      ephemeral: source.ephemeral !== false
    };
  }

  async function writeConfig(next) {
    await chrome.storage.local.set({
      [STORAGE_KEY]: next
    });
  }

  function setStatus(message, tone) {
    if (!refs) {
      return;
    }
    refs.status.textContent = message || "";
    refs.status.dataset.tone = tone || "";
  }

  function writeForm(config) {
    refs.toggle.dataset.enabled = config.enabled ? "true" : "false";
    refs.enabledValue.textContent = config.enabled ? "Enabled" : "Disabled";
    refs.hostName.value = config.hostName || "";
    refs.defaultCwd.value = config.defaultCwd || "";
    refs.defaultModel.value = config.defaultModel || "";
    refs.sandbox.value = config.sandbox || DEFAULTS.sandbox;
    refs.ephemeral.dataset.enabled = config.ephemeral ? "true" : "false";
    refs.ephemeralValue.textContent = config.ephemeral ? "Ephemeral session" : "Persistent session";
  }

  function readForm() {
    return {
      enabled: refs.toggle.dataset.enabled === "true",
      hostName: String(refs.hostName.value || "").trim() || DEFAULTS.hostName,
      defaultCwd: String(refs.defaultCwd.value || "").trim(),
      defaultModel: String(refs.defaultModel.value || "").trim(),
      sandbox: String(refs.sandbox.value || DEFAULTS.sandbox).trim() || DEFAULTS.sandbox,
      ephemeral: refs.ephemeral.dataset.enabled === "true"
    };
  }

  async function refreshStatus() {
    setStatus("Checking local bridge...", "");
    const response = await chrome.runtime.sendMessage({
      type: "CODEX_BRIDGE_GET_STATUS"
    });
    if (!response?.success) {
      setStatus(response?.error || "Failed to read local bridge status.", "error");
      return;
    }
    const status = response.status || {};
    const parts = [];
    parts.push(status.connected ? "Bridge connected" : "Bridge offline");
    if (status.hostName) {
      parts.push(`Host: ${status.hostName}`);
    }
    if (status.codexPath) {
      parts.push(`Codex: ${status.codexPath}`);
    }
    if (typeof status.loggedIn === "boolean") {
      parts.push(status.loggedIn ? "Login OK" : "Login missing");
    }
    if (status.error) {
      parts.push(status.error);
    }
    setStatus(parts.join(" | "), status.connected ? "success" : status.error ? "error" : "");
  }

  async function saveForm() {
    const next = readForm();
    await writeConfig(next);
    setStatus("Saved. Reloading local bridge status...", "success");
    await refreshStatus();
  }

  function toggleButton(button, value, labelNode, trueText, falseText) {
    button.dataset.enabled = value ? "true" : "false";
    labelNode.textContent = value ? trueText : falseText;
  }

  function buildOverlay() {
    if (overlay) {
      return overlay;
    }
    const launcher = createNode("button", "cb-launcher", null);
    launcher.id = ROOT_ID;
    launcher.dataset.variant = "options";
    launcher.dataset.status = "offline";
    launcher.innerHTML = '<span class="cb-dot"></span><span>Local Codex</span>';
    launcher.addEventListener("click", async function () {
      modal.dataset.open = "true";
      writeForm(await readConfig());
      await refreshStatus().catch(function (error) {
        setStatus(error && typeof error.message === "string" ? error.message : "Failed to refresh bridge status.", "error");
      });
    });

    const modal = createNode("div", "cb-overlay");
    modal.dataset.open = "false";
    modal.addEventListener("click", function (event) {
      if (event.target === modal) {
        modal.dataset.open = "false";
      }
    });

    const card = createNode("section", "cb-card");
    const header = createNode("div", "cb-header");
    header.appendChild(createNode("div", "cb-eyebrow", "Local Codex"));
    const titleRow = createNode("div", "cb-title-row");
    titleRow.appendChild(createNode("h2", "cb-title", "Bind Claw to your local Codex"));
    header.appendChild(titleRow);
    header.appendChild(createNode("p", "cb-subtitle", "This mode uses your already logged-in Codex CLI instead of an API key. Save the bridge settings here, then install the native host from the repo's native-host folder."));

    const body = createNode("div", "cb-body");
    const grid = createNode("div", "cb-grid");

    const toggleRow = createNode("div", "cb-toggle-row");
    const toggleCopy = createNode("div", "cb-toggle-copy");
    toggleCopy.appendChild(createNode("div", "cb-label", "Enable Local Codex"));
    toggleCopy.appendChild(createNode("div", "cb-help", "When enabled, the sidepanel can dispatch tasks to your local Codex bridge."));
    const toggle = createNode("button", "cb-toggle");
    const enabledValue = createNode("div", "cb-help", "Disabled");
    toggle.addEventListener("click", function () {
      toggleButton(toggle, toggle.dataset.enabled !== "true", enabledValue, "Enabled", "Disabled");
    });
    toggleRow.appendChild(toggleCopy);
    toggleRow.appendChild(toggle);

    const hostField = createNode("label", "cb-field");
    hostField.appendChild(createNode("span", "cb-label", "Native host name"));
    const hostName = createNode("input", "cb-input cb-mono");
    hostField.appendChild(hostName);

    const defaultCwdField = createNode("label", "cb-field");
    defaultCwdField.appendChild(createNode("span", "cb-label", "Default workspace"));
    const defaultCwd = createNode("input", "cb-input cb-mono");
    defaultCwd.placeholder = "D:\\Code\\your-repo";
    defaultCwdField.appendChild(defaultCwd);

    const gridTwo = createNode("div", "cb-grid-two");
    const modelField = createNode("label", "cb-field");
    modelField.appendChild(createNode("span", "cb-label", "Default model"));
    const defaultModel = createNode("input", "cb-input cb-mono");
    defaultModel.placeholder = "gpt-5.3-codex";
    modelField.appendChild(defaultModel);

    const sandboxField = createNode("label", "cb-field");
    sandboxField.appendChild(createNode("span", "cb-label", "Sandbox"));
    const sandbox = createNode("select", "cb-select");
    [["read-only", "read-only"], ["workspace-write", "workspace-write"], ["danger-full-access", "danger-full-access"]].forEach(function (entry) {
      const option = document.createElement("option");
      option.value = entry[0];
      option.textContent = entry[1];
      sandbox.appendChild(option);
    });
    sandboxField.appendChild(sandbox);
    gridTwo.appendChild(modelField);
    gridTwo.appendChild(sandboxField);

    const ephemeralRow = createNode("div", "cb-toggle-row");
    const ephemeralCopy = createNode("div", "cb-toggle-copy");
    ephemeralCopy.appendChild(createNode("div", "cb-label", "Ephemeral sessions"));
    ephemeralCopy.appendChild(createNode("div", "cb-help", "Use temporary Codex sessions by default. Turn this off only if you want tasks to persist in the local Codex history."));
    const ephemeral = createNode("button", "cb-toggle");
    const ephemeralValue = createNode("div", "cb-help", "Ephemeral session");
    ephemeral.addEventListener("click", function () {
      toggleButton(ephemeral, ephemeral.dataset.enabled !== "true", ephemeralValue, "Ephemeral session", "Persistent session");
    });
    ephemeralRow.appendChild(ephemeralCopy);
    ephemeralRow.appendChild(ephemeral);

    const statusRow = createNode("div", "cb-status-row");
    statusRow.appendChild(createNode("div", "cb-label", "Bridge status"));
    const status = createNode("div", "cb-status-text", "Not checked yet.");
    statusRow.appendChild(status);

    const actions = createNode("div", "cb-actions");
    const closeButton = createNode("button", "cb-btn", "Close");
    closeButton.addEventListener("click", function () {
      modal.dataset.open = "false";
    });
    const checkButton = createNode("button", "cb-btn", "Check bridge");
    checkButton.addEventListener("click", function () {
      refreshStatus().catch(function (error) {
        setStatus(error && typeof error.message === "string" ? error.message : "Failed to refresh bridge status.", "error");
      });
    });
    const saveButton = createNode("button", "cb-btn cb-btn-primary", "Save");
    saveButton.addEventListener("click", function () {
      saveForm().catch(function (error) {
        setStatus(error && typeof error.message === "string" ? error.message : "Failed to save Local Codex settings.", "error");
      });
    });
    actions.appendChild(closeButton);
    actions.appendChild(checkButton);
    actions.appendChild(saveButton);

    grid.appendChild(toggleRow);
    grid.appendChild(enabledValue);
    grid.appendChild(hostField);
    grid.appendChild(defaultCwdField);
    grid.appendChild(gridTwo);
    grid.appendChild(ephemeralRow);
    grid.appendChild(ephemeralValue);
    grid.appendChild(statusRow);
    grid.appendChild(actions);

    body.appendChild(grid);
    card.appendChild(header);
    card.appendChild(body);
    modal.appendChild(card);

    refs = {
      toggle,
      enabledValue,
      hostName,
      defaultCwd,
      defaultModel,
      sandbox,
      ephemeral,
      ephemeralValue,
      status,
      launcher
    };
    overlay = modal;

    document.body.appendChild(launcher);
    document.body.appendChild(modal);
    return modal;
  }

  function syncLauncherStatus(status) {
    if (!refs) {
      return;
    }
    refs.launcher.dataset.status = status?.connected ? "ready" : "offline";
  }

  chrome.runtime.onMessage.addListener(function (message) {
    if (message?.type !== "CODEX_BRIDGE_STATUS_CHANGED") {
      return;
    }
    syncLauncherStatus(message.status || {});
  });

  async function boot() {
    if (document.getElementById(ROOT_ID)) {
      return;
    }
    buildOverlay();
    writeForm(await readConfig());
    const response = await chrome.runtime.sendMessage({
      type: "CODEX_BRIDGE_GET_STATUS"
    }).catch(function () {
      return null;
    });
    syncLauncherStatus(response?.status || {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      boot().catch(function () {});
    }, {
      once: true
    });
  } else {
    boot().catch(function () {});
  }
})();
