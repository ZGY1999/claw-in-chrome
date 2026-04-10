(function () {
  const STORAGE_KEY = "codexBridgeConfig";
  const ROOT_ID = "cb-sidepanel-launcher";
  let currentTaskId = "";
  let overlay = null;
  let refs = null;

  async function readConfig() {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const source = stored[STORAGE_KEY] || {};
    return {
      enabled: !!source.enabled,
      defaultCwd: String(source.defaultCwd || "").trim(),
      defaultModel: String(source.defaultModel || "").trim(),
      sandbox: String(source.sandbox || "workspace-write").trim() || "workspace-write"
    };
  }

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

  function appendOutput(text) {
    if (!refs || !text) {
      return;
    }
    refs.output.textContent += (refs.output.textContent ? "\n" : "") + text;
    refs.output.scrollTop = refs.output.scrollHeight;
  }

  function setStatus(message, tone) {
    refs.status.textContent = message || "";
    refs.status.dataset.tone = tone || "";
  }

  function setRunningState(running) {
    refs.launcher.dataset.status = running ? "running" : refs.launcher.dataset.status === "offline" ? "offline" : "ready";
    refs.run.disabled = running;
    refs.stop.disabled = !running || !currentTaskId;
    refs.prompt.disabled = running;
    refs.cwd.disabled = running;
    refs.model.disabled = running;
    refs.sandbox.disabled = running;
  }

  function formatCodexEvent(event) {
    if (!event || typeof event !== "object") {
      return "";
    }
    if (event.type === "thread.started") {
      return `[thread] ${event.thread_id || ""}`.trim();
    }
    if (event.type === "turn.started") {
      return "[turn] started";
    }
    if (event.type === "turn.completed") {
      const usage = event.usage || {};
      return `[turn] completed | input=${usage.input_tokens || 0} output=${usage.output_tokens || 0}`;
    }
    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      return event.item.text || "";
    }
    if (event.type === "item.completed") {
      return `[item] ${event.item?.type || "completed"}`;
    }
    return JSON.stringify(event);
  }

  async function openPanel() {
    const config = await readConfig();
    refs.cwd.value = config.defaultCwd || refs.cwd.value;
    refs.model.value = config.defaultModel || refs.model.value;
    refs.sandbox.value = config.sandbox || "workspace-write";
    overlay.dataset.open = "true";
    const response = await chrome.runtime.sendMessage({
      type: "CODEX_BRIDGE_GET_STATUS"
    }).catch(function () {
      return null;
    });
    const status = response?.status || {};
    refs.launcher.dataset.status = status.connected ? "ready" : "offline";
    if (!config.enabled) {
      setStatus("Local Codex is disabled. Open the options page and enable it first.", "error");
    } else if (status.connected) {
      setStatus("Bridge connected. Submit a task when ready.", "success");
    } else if (status.error) {
      setStatus(status.error, "error");
    } else {
      setStatus("Bridge is offline. Install and register the native host from native-host/ first.", "error");
    }
  }

  async function runTask() {
    const prompt = String(refs.prompt.value || "").trim();
    if (!prompt) {
      setStatus("Prompt is required.", "error");
      refs.prompt.focus();
      return;
    }
    refs.output.textContent = "";
    setStatus("Starting local Codex task...", "");
    const response = await chrome.runtime.sendMessage({
      type: "CODEX_BRIDGE_START_TASK",
      prompt,
      cwd: String(refs.cwd.value || "").trim(),
      model: String(refs.model.value || "").trim(),
      sandbox: String(refs.sandbox.value || "workspace-write").trim()
    });
    if (!response?.success) {
      setStatus(response?.error || "Failed to start the local Codex task.", "error");
      return;
    }
    currentTaskId = response.taskId || "";
    setRunningState(true);
    setStatus(`Running task ${currentTaskId}`, "success");
  }

  async function stopTask() {
    if (!currentTaskId) {
      return;
    }
    const taskId = currentTaskId;
    const response = await chrome.runtime.sendMessage({
      type: "CODEX_BRIDGE_CANCEL_TASK",
      taskId
    });
    if (!response?.success) {
      setStatus(response?.error || "Failed to cancel the local Codex task.", "error");
      return;
    }
    appendOutput(`[bridge] cancel requested for ${taskId}`);
  }

  function buildUi() {
    if (overlay) {
      return;
    }
    const launcher = createNode("button", "cb-launcher", null);
    launcher.id = ROOT_ID;
    launcher.dataset.status = "offline";
    launcher.innerHTML = '<span class="cb-dot"></span><span>Local Codex</span>';
    launcher.addEventListener("click", function () {
      openPanel().catch(function (error) {
        setStatus(error && typeof error.message === "string" ? error.message : "Failed to open the Local Codex panel.", "error");
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
    titleRow.appendChild(createNode("h2", "cb-title", "Run tasks through your local Codex CLI"));
    header.appendChild(titleRow);
    header.appendChild(createNode("p", "cb-subtitle", "This panel bypasses API keys and sends your request to the local native host, which then invokes the already authenticated Codex CLI on this machine."));

    const body = createNode("div", "cb-body");
    const grid = createNode("div", "cb-grid");

    const promptField = createNode("label", "cb-field");
    promptField.appendChild(createNode("span", "cb-label", "Prompt"));
    const prompt = createNode("textarea", "cb-textarea");
    prompt.placeholder = "Describe the task you want local Codex to do in the selected workspace.";
    promptField.appendChild(prompt);

    const gridTwo = createNode("div", "cb-grid-two");
    const cwdField = createNode("label", "cb-field");
    cwdField.appendChild(createNode("span", "cb-label", "Workspace"));
    const cwd = createNode("input", "cb-input cb-mono");
    cwd.placeholder = "D:\\Code\\your-repo";
    cwdField.appendChild(cwd);

    const modelField = createNode("label", "cb-field");
    modelField.appendChild(createNode("span", "cb-label", "Model override"));
    const model = createNode("input", "cb-input cb-mono");
    model.placeholder = "gpt-5.3-codex";
    modelField.appendChild(model);
    gridTwo.appendChild(cwdField);
    gridTwo.appendChild(modelField);

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

    const statusRow = createNode("div", "cb-status-row");
    statusRow.appendChild(createNode("div", "cb-label", "Task status"));
    const status = createNode("div", "cb-status-text", "Open the panel to check the local bridge.");
    statusRow.appendChild(status);

    const outputShell = createNode("div", "cb-output-shell");
    outputShell.appendChild(createNode("p", "cb-output-title", "Output"));
    const output = createNode("pre", "cb-output", "");
    outputShell.appendChild(output);

    const actions = createNode("div", "cb-actions");
    const close = createNode("button", "cb-btn", "Close");
    close.addEventListener("click", function () {
      modal.dataset.open = "false";
    });
    const stop = createNode("button", "cb-btn cb-btn-danger", "Stop");
    stop.disabled = true;
    stop.addEventListener("click", function () {
      stopTask().catch(function (error) {
        setStatus(error && typeof error.message === "string" ? error.message : "Failed to stop the task.", "error");
      });
    });
    const run = createNode("button", "cb-btn cb-btn-primary", "Run");
    run.addEventListener("click", function () {
      runTask().catch(function (error) {
        setStatus(error && typeof error.message === "string" ? error.message : "Failed to start the task.", "error");
      });
    });
    actions.appendChild(close);
    actions.appendChild(stop);
    actions.appendChild(run);

    grid.appendChild(promptField);
    grid.appendChild(gridTwo);
    grid.appendChild(sandboxField);
    grid.appendChild(statusRow);
    grid.appendChild(outputShell);
    grid.appendChild(actions);
    body.appendChild(grid);
    card.appendChild(header);
    card.appendChild(body);
    modal.appendChild(card);

    refs = {
      launcher,
      prompt,
      cwd,
      model,
      sandbox,
      status,
      output,
      run,
      stop
    };
    overlay = modal;

    document.body.appendChild(launcher);
    document.body.appendChild(modal);
  }

  chrome.runtime.onMessage.addListener(function (message) {
    if (!message || typeof message.type !== "string") {
      return;
    }
    if (message.type === "CODEX_BRIDGE_STATUS_CHANGED") {
      refs.launcher.dataset.status = message.status?.connected ? "ready" : "offline";
      return;
    }
    if (message.taskId !== currentTaskId) {
      return;
    }
    if (message.type === "CODEX_BRIDGE_TASK_EVENT") {
      appendOutput(formatCodexEvent(message.event));
      return;
    }
    if (message.type === "CODEX_BRIDGE_TASK_LOG") {
      appendOutput(`[${message.stream}] ${message.text}`);
      return;
    }
    if (message.type === "CODEX_BRIDGE_TASK_DONE") {
      if (message.error) {
        appendOutput(`[error] ${message.error}`);
      }
      if (message.summary) {
        appendOutput(`[summary] ${message.summary}`);
      }
      setStatus(message.success ? "Task completed." : `Task failed${message.exitCode ? ` (exit ${message.exitCode})` : ""}.`, message.success ? "success" : "error");
      currentTaskId = "";
      setRunningState(false);
    }
  });

  function boot() {
    if (document.getElementById(ROOT_ID)) {
      return;
    }
    buildUi();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, {
      once: true
    });
  } else {
    boot();
  }
})();
