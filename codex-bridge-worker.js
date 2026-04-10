const CODEX_BRIDGE_CONFIG_KEY = "codexBridgeConfig";
const CODEX_BRIDGE_DEFAULTS = {
  enabled: false,
  hostName: "com.zgy1999.codex_bridge",
  defaultCwd: "",
  defaultModel: "",
  sandbox: "workspace-write",
  ephemeral: true
};
const CODEX_BRIDGE_TASK_EVENT = "CODEX_BRIDGE_TASK_EVENT";
const CODEX_BRIDGE_TASK_LOG = "CODEX_BRIDGE_TASK_LOG";
const CODEX_BRIDGE_TASK_DONE = "CODEX_BRIDGE_TASK_DONE";
const CODEX_BRIDGE_STATUS_CHANGED = "CODEX_BRIDGE_STATUS_CHANGED";
const CODEX_BRIDGE_DEBUG_LOGS_KEY = "codexBridgeDebugLogs";
const CODEX_BRIDGE_DEBUG_LIMIT = 300;

let codexPort = null;
let codexHostName = "";
let codexConnectInFlight = null;
let codexStatusWaiters = [];
let codexConnected = false;
let codexLastError = "";

function normalizeBridgeDebugPayload(payload) {
  if (payload == null) {
    return payload;
  }
  if (typeof payload === "string" || typeof payload === "number" || typeof payload === "boolean") {
    return payload;
  }
  if (Array.isArray(payload)) {
    return payload.slice(0, 20).map(normalizeBridgeDebugPayload);
  }
  if (typeof payload !== "object") {
    return String(payload);
  }
  const output = {};
  for (const [key, value] of Object.entries(payload).slice(0, 30)) {
    if (typeof value === "string" && value.length > 600) {
      output[key] = value.slice(0, 600) + "...[truncated]";
    } else {
      output[key] = normalizeBridgeDebugPayload(value);
    }
  }
  return output;
}

async function appendCodexBridgeDebug(type, payload, level) {
  try {
    const stored = await chrome.storage.local.get(CODEX_BRIDGE_DEBUG_LOGS_KEY);
    const current = Array.isArray(stored[CODEX_BRIDGE_DEBUG_LOGS_KEY]) ? stored[CODEX_BRIDGE_DEBUG_LOGS_KEY] : [];
    current.push({
      ts: new Date().toISOString(),
      type,
      level: level || "info",
      payload: normalizeBridgeDebugPayload(payload)
    });
    await chrome.storage.local.set({
      [CODEX_BRIDGE_DEBUG_LOGS_KEY]: current.slice(-CODEX_BRIDGE_DEBUG_LIMIT)
    });
  } catch {}
}

async function readCodexBridgeConfig() {
  const stored = await chrome.storage.local.get(CODEX_BRIDGE_CONFIG_KEY);
  const source = stored[CODEX_BRIDGE_CONFIG_KEY] || {};
  return {
    enabled: !!source.enabled,
    hostName: String(source.hostName || CODEX_BRIDGE_DEFAULTS.hostName).trim() || CODEX_BRIDGE_DEFAULTS.hostName,
    defaultCwd: String(source.defaultCwd || "").trim(),
    defaultModel: String(source.defaultModel || "").trim(),
    sandbox: String(source.sandbox || CODEX_BRIDGE_DEFAULTS.sandbox).trim() || CODEX_BRIDGE_DEFAULTS.sandbox,
    ephemeral: source.ephemeral !== false
  };
}

function broadcastCodexBridgeMessage(message) {
  try {
    chrome.runtime.sendMessage(message, () => {
      chrome.runtime.lastError;
    });
  } catch {}
}

function resolveCodexBridgeStatus(overrides) {
  return {
    connected: codexConnected,
    hostName: codexHostName,
    error: codexLastError,
    ...(overrides || {})
  };
}

function flushCodexStatusWaiters(status) {
  const waiters = codexStatusWaiters.slice();
  codexStatusWaiters = [];
  for (const waiter of waiters) {
    try {
      waiter(status);
    } catch {}
  }
}

function updateCodexBridgeStatus(statusOverrides) {
  const status = resolveCodexBridgeStatus(statusOverrides);
  broadcastCodexBridgeMessage({
    type: CODEX_BRIDGE_STATUS_CHANGED,
    status
  });
  return status;
}

function handleCodexBridgePortDisconnect() {
  codexPort = null;
  codexConnected = false;
  const message = chrome.runtime.lastError?.message || "Codex bridge disconnected.";
  codexLastError = message;
  appendCodexBridgeDebug("bridge.disconnect", {
    hostName: codexHostName,
    error: message
  }, "warn");
  flushCodexStatusWaiters(resolveCodexBridgeStatus());
  updateCodexBridgeStatus();
}

function handleCodexBridgePortMessage(message) {
  if (!message || typeof message !== "object") {
    return;
  }
  if (message.type === "pong") {
    codexConnected = true;
    codexLastError = "";
    appendCodexBridgeDebug("bridge.pong", {
      hostName: codexHostName
    });
    updateCodexBridgeStatus();
    return;
  }
  if (message.type === "status_response") {
    codexConnected = !!message.connected;
    codexLastError = String(message.error || "");
    const status = updateCodexBridgeStatus({
      loggedIn: !!message.loggedIn,
      codexPath: String(message.codexPath || ""),
      hostVersion: String(message.hostVersion || "")
    });
    appendCodexBridgeDebug("bridge.status_response", status);
    flushCodexStatusWaiters(status);
    return;
  }
  if (message.type === "task_event") {
    appendCodexBridgeDebug("bridge.task_event", {
      taskId: String(message.taskId || ""),
      eventType: String(message.event?.type || ""),
      itemType: String(message.event?.item?.type || "")
    });
    broadcastCodexBridgeMessage({
      type: CODEX_BRIDGE_TASK_EVENT,
      taskId: String(message.taskId || ""),
      event: message.event || {}
    });
    return;
  }
  if (message.type === "task_log") {
    appendCodexBridgeDebug("bridge.task_log", {
      taskId: String(message.taskId || ""),
      stream: String(message.stream || "stdout"),
      text: String(message.text || "")
    }, message.stream === "stderr" ? "warn" : "info");
    broadcastCodexBridgeMessage({
      type: CODEX_BRIDGE_TASK_LOG,
      taskId: String(message.taskId || ""),
      stream: String(message.stream || "stdout"),
      text: String(message.text || "")
    });
    return;
  }
  if (message.type === "task_done" || message.type === "task_error") {
    appendCodexBridgeDebug("bridge.task_done", {
      taskId: String(message.taskId || ""),
      success: message.type === "task_done" && Number(message.exitCode || 0) === 0,
      exitCode: Number(message.exitCode || 0),
      error: String(message.error || ""),
      summaryLength: String(message.summary || "").length
    }, message.type === "task_error" ? "error" : "info");
    broadcastCodexBridgeMessage({
      type: CODEX_BRIDGE_TASK_DONE,
      taskId: String(message.taskId || ""),
      success: message.type === "task_done" && Number(message.exitCode || 0) === 0,
      exitCode: Number(message.exitCode || 0),
      error: String(message.error || ""),
      summary: String(message.summary || "")
    });
  }
}

async function connectCodexBridge(forceReconnect) {
  if (codexPort && !forceReconnect) {
    return true;
  }
  if (codexConnectInFlight) {
    return codexConnectInFlight;
  }
  codexConnectInFlight = (async () => {
    const config = await readCodexBridgeConfig();
    codexHostName = config.hostName;
    appendCodexBridgeDebug("bridge.connect_attempt", {
      forceReconnect: !!forceReconnect,
      hostName: config.hostName,
      enabled: !!config.enabled
    });
    if (!(await chrome.permissions.contains({
      permissions: ["nativeMessaging"]
    }))) {
      codexConnected = false;
      codexLastError = "nativeMessaging permission is not available.";
      appendCodexBridgeDebug("bridge.connect_failed", {
        reason: codexLastError
      }, "error");
      updateCodexBridgeStatus();
      return false;
    }
    try {
      if (codexPort) {
        try {
          codexPort.disconnect();
        } catch {}
      }
      const port = chrome.runtime.connectNative(config.hostName);
      codexPort = port;
      codexConnected = false;
      codexLastError = "";
      port.onDisconnect.addListener(handleCodexBridgePortDisconnect);
      port.onMessage.addListener(handleCodexBridgePortMessage);
      port.postMessage({
        type: "ping"
      });
      appendCodexBridgeDebug("bridge.connect_success", {
        hostName: config.hostName
      });
      return true;
    } catch (error) {
      codexPort = null;
      codexConnected = false;
      codexLastError = error instanceof Error ? error.message : String(error || "Failed to connect to Codex bridge.");
      appendCodexBridgeDebug("bridge.connect_failed", {
        hostName: config.hostName,
        error: codexLastError
      }, "error");
      updateCodexBridgeStatus();
      return false;
    } finally {
      codexConnectInFlight = null;
    }
  })();
  return codexConnectInFlight;
}

async function requestCodexBridgeStatus() {
  appendCodexBridgeDebug("bridge.status_request", {});
  if (!(await connectCodexBridge(false)) || !codexPort) {
    return resolveCodexBridgeStatus();
  }
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      resolve(resolveCodexBridgeStatus());
    }, 5000);
    codexStatusWaiters.push(status => {
      clearTimeout(timer);
      resolve(status);
    });
    try {
      codexPort.postMessage({
        type: "get_status"
      });
    } catch (error) {
      clearTimeout(timer);
      resolve(resolveCodexBridgeStatus({
        error: error instanceof Error ? error.message : String(error || "Failed to query Codex bridge status.")
      }));
    }
  });
}

function normalizeCodexBridgeTaskRequest(message, config) {
  return {
    taskId: String(message.taskId || globalThis.crypto?.randomUUID?.() || Date.now()),
    prompt: String(message.prompt || "").trim(),
    cwd: String(message.cwd || config.defaultCwd || "").trim(),
    model: String(message.model || config.defaultModel || "").trim(),
    sandbox: String(message.sandbox || config.sandbox || CODEX_BRIDGE_DEFAULTS.sandbox).trim() || CODEX_BRIDGE_DEFAULTS.sandbox,
    ephemeral: message.ephemeral == null ? config.ephemeral !== false : !!message.ephemeral
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object" || typeof message.type !== "string") {
    return false;
  }
  const handledTypes = new Set(["CODEX_BRIDGE_GET_STATUS", "CODEX_BRIDGE_START_TASK", "CODEX_BRIDGE_CANCEL_TASK"]);
  if (!handledTypes.has(message.type)) {
    return false;
  }
  (async () => {
    if (message.type === "CODEX_BRIDGE_GET_STATUS") {
      sendResponse({
        success: true,
        status: await requestCodexBridgeStatus()
      });
      return;
    }
    if (message.type === "CODEX_BRIDGE_START_TASK") {
      const config = await readCodexBridgeConfig();
      if (!config.enabled) {
        sendResponse({
          success: false,
          error: "Local Codex is disabled in settings."
        });
        return;
      }
      const payload = normalizeCodexBridgeTaskRequest(message, config);
      appendCodexBridgeDebug("bridge.start_task_request", {
        taskId: payload.taskId,
        promptLength: payload.prompt.length,
        cwd: payload.cwd,
        model: payload.model,
        sandbox: payload.sandbox,
        senderUrl: String(sender?.url || "")
      });
      if (!payload.prompt) {
        sendResponse({
          success: false,
          error: "Prompt is required."
        });
        return;
      }
      if (!(await connectCodexBridge(false)) || !codexPort) {
        sendResponse({
          success: false,
          error: codexLastError || "Failed to connect to the local Codex bridge."
        });
        return;
      }
      try {
        codexPort.postMessage({
          type: "start_task",
          ...payload
        });
        appendCodexBridgeDebug("bridge.start_task_dispatched", {
          taskId: payload.taskId
        });
        sendResponse({
          success: true,
          taskId: payload.taskId
        });
      } catch (error) {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error || "Failed to start the Codex task.")
        });
      }
      return;
    }
    if (message.type === "CODEX_BRIDGE_CANCEL_TASK") {
      appendCodexBridgeDebug("bridge.cancel_task_request", {
        taskId: String(message.taskId || "")
      }, "warn");
      if (!codexPort) {
        sendResponse({
          success: false,
          error: "Codex bridge is not connected."
        });
        return;
      }
      try {
        codexPort.postMessage({
          type: "cancel_task",
          taskId: String(message.taskId || "")
        });
        sendResponse({
          success: true
        });
      } catch (error) {
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : String(error || "Failed to cancel the Codex task.")
        });
      }
      return;
    }
    sendResponse({
      success: false,
      error: `Unknown Codex bridge message: ${message.type}`
    });
  })().catch(error => {
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : String(error || "Unexpected Codex bridge error.")
    });
  });
  return true;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[CODEX_BRIDGE_CONFIG_KEY]) {
    return;
  }
  connectCodexBridge(true).catch(() => {});
});
