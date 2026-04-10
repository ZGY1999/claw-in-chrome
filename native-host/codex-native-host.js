#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const localCodexHelpers = require("../local-codex-adapter-helpers.js");

const HOST_VERSION = "0.1.0";
const tasks = new Map();
let inputBuffer = Buffer.alloc(0);

function sendMessage(message) {
  const json = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(header);
  process.stdout.write(json);
}

function resolveCodexCommand() {
  const explicit = String(process.env.CODEX_CMD || "").trim();
  if (explicit) {
    return explicit;
  }
  if (process.platform === "win32") {
    const nvmSymlink = String(process.env.NVM_SYMLINK || "").trim();
    if (nvmSymlink) {
      return path.join(nvmSymlink, "codex.cmd");
    }
    return "codex.cmd";
  }
  return "codex";
}

function createSpawnOptions(cwd) {
  return {
    cwd: cwd || process.cwd(),
    windowsHide: true,
    shell: process.platform === "win32",
    env: process.env
  };
}

function runShortCommand(command, args) {
  return new Promise(resolve => {
    const child = spawn(command, args, createSpawnOptions(process.cwd()));
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", error => {
      resolve({
        ok: false,
        stdout,
        stderr,
        error: error instanceof Error ? error.message : String(error || "Failed to run command.")
      });
    });
    child.on("close", code => {
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr
      });
    });
  });
}

async function readStatus() {
  const command = resolveCodexCommand();
  const result = await runShortCommand(command, ["login", "status"]);
  const loginText = [result.stdout, result.stderr].filter(Boolean).join("\n");
  return {
    type: "status_response",
    connected: true,
    loggedIn: /logged in/i.test(loginText),
    codexPath: command,
    hostVersion: HOST_VERSION,
    error: result.ok ? "" : result.error || result.stderr || ""
  };
}

function summarizeTaskLine(event) {
  return typeof localCodexHelpers.extractLocalCodexEventText === "function" ? localCodexHelpers.extractLocalCodexEventText(event) : "";
}

function extractTaskError(event) {
  return typeof localCodexHelpers.extractLocalCodexEventError === "function" ? localCodexHelpers.extractLocalCodexEventError(event) : "";
}

function streamLines(stream, onLine) {
  let buffer = "";
  stream.on("data", chunk => {
    buffer += chunk.toString("utf8");
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);
      onLine(line);
      newlineIndex = buffer.indexOf("\n");
    }
  });
  stream.on("end", () => {
    if (buffer) {
      onLine(buffer.replace(/\r$/, ""));
      buffer = "";
    }
  });
}

function startTask(message) {
  const taskId = String(message.taskId || "").trim();
  const prompt = String(message.prompt || "").trim();
  if (!taskId || !prompt) {
    sendMessage({
      type: "task_error",
      taskId,
      error: "taskId and prompt are required."
    });
    return;
  }
  if (tasks.has(taskId)) {
    sendMessage({
      type: "task_error",
      taskId,
      error: "taskId is already running."
    });
    return;
  }

  const command = resolveCodexCommand();
  const args = ["exec", "--skip-git-repo-check", "--json", "--color", "never"];
  const cwd = String(message.cwd || "").trim();
  const model = String(message.model || "").trim();
  const sandbox = String(message.sandbox || "").trim();
  const ephemeral = message.ephemeral !== false;
  if (cwd) {
    args.push("-C", cwd);
  }
  if (model) {
    args.push("--model", model);
  }
  if (sandbox) {
    args.push("--sandbox", sandbox);
  }
  if (ephemeral) {
    args.push("--ephemeral");
  }
  args.push(prompt);

  const child = spawn(command, args, createSpawnOptions(cwd));
  const summaryParts = [];
  let taskError = "";
  tasks.set(taskId, child);

  child.on("error", error => {
    sendMessage({
      type: "task_error",
      taskId,
      error: error instanceof Error ? error.message : String(error || "Failed to start Codex task.")
    });
    tasks.delete(taskId);
  });

  streamLines(child.stdout, line => {
    if (!line.trim()) {
      return;
    }
    try {
      const event = JSON.parse(line);
      const summaryText = summarizeTaskLine(event);
      const errorText = extractTaskError(event);
      if (summaryText) {
        summaryParts.push(summaryText);
      }
      if (errorText) {
        taskError = errorText;
      }
      sendMessage({
        type: "task_event",
        taskId,
        event
      });
    } catch {
      sendMessage({
        type: "task_log",
        taskId,
        stream: "stdout",
        text: line
      });
    }
  });

  streamLines(child.stderr, line => {
    if (!line.trim()) {
      return;
    }
    sendMessage({
      type: "task_log",
      taskId,
      stream: "stderr",
      text: line
    });
  });

  child.on("close", code => {
    const exitCode = Number(code || 0);
    sendMessage({
      type: "task_done",
      taskId,
      exitCode,
      error: taskError || (exitCode !== 0 ? `Codex task failed with exit code ${exitCode}.` : ""),
      summary: summaryParts.filter(Boolean).join("\n\n")
    });
    tasks.delete(taskId);
  });
}

function cancelTask(message) {
  const taskId = String(message.taskId || "").trim();
  const child = tasks.get(taskId);
  if (!child) {
    sendMessage({
      type: "task_error",
      taskId,
      error: "task not found"
    });
    return;
  }
  try {
    child.kill();
    sendMessage({
      type: "task_log",
      taskId,
      stream: "host",
      text: "Task termination requested."
    });
  } catch (error) {
    sendMessage({
      type: "task_error",
      taskId,
      error: error instanceof Error ? error.message : String(error || "Failed to terminate task.")
    });
  }
}

async function handleMessage(message) {
  if (!message || typeof message !== "object") {
    sendMessage({
      type: "error",
      error: "Invalid message payload."
    });
    return;
  }
  if (message.type === "ping") {
    sendMessage({
      type: "pong",
      hostVersion: HOST_VERSION,
      platform: os.platform()
    });
    return;
  }
  if (message.type === "get_status") {
    sendMessage(await readStatus());
    return;
  }
  if (message.type === "start_task") {
    startTask(message);
    return;
  }
  if (message.type === "cancel_task") {
    cancelTask(message);
    return;
  }
  sendMessage({
    type: "error",
    error: `Unknown message type: ${String(message.type || "")}`
  });
}

process.stdin.on("data", chunk => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  while (inputBuffer.length >= 4) {
    const bodyLength = inputBuffer.readUInt32LE(0);
    if (inputBuffer.length < bodyLength + 4) {
      return;
    }
    const payload = inputBuffer.slice(4, bodyLength + 4).toString("utf8");
    inputBuffer = inputBuffer.slice(bodyLength + 4);
    try {
      handleMessage(JSON.parse(payload)).catch(error => {
        sendMessage({
          type: "error",
          error: error instanceof Error ? error.message : String(error || "Unexpected host error.")
        });
      });
    } catch (error) {
      sendMessage({
        type: "error",
        error: error instanceof Error ? error.message : "Failed to parse native host message."
      });
    }
  }
});
