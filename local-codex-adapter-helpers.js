(function (root) {
  const TOOL_CALL_OPEN_TAG = "<tool_call>";
  const TOOL_CALL_CLOSE_TAG = "</tool_call>";

  function formatAnthropicSystemForSingleMessage(system) {
    if (typeof system === "string") {
      return system.trim();
    }
    if (!Array.isArray(system)) {
      return "";
    }
    const parts = [];
    for (const block of system) {
      if (!block || typeof block !== "object") {
        continue;
      }
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        parts.push(block.text.trim());
      }
    }
    return parts.join("\n\n").trim();
  }

  function escapeForRegex(text) {
    return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function safeJsonParse(text, fallback) {
    try {
      return JSON.parse(text);
    } catch {
      return fallback;
    }
  }

  function parseLocalCodexToolCall(text) {
    const rawText = typeof text === "string" ? text.trim() : "";
    if (!rawText) {
      return null;
    }
    const match = rawText.match(new RegExp(escapeForRegex(TOOL_CALL_OPEN_TAG) + "\\s*([\\s\\S]+?)\\s*" + escapeForRegex(TOOL_CALL_CLOSE_TAG), "i"));
    if (!match) {
      return null;
    }
    const parsed = safeJsonParse(match[1], null);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const name = typeof parsed.name === "string" && parsed.name ? parsed.name : typeof parsed?.function?.name === "string" ? parsed.function.name : "";
    let input = parsed.arguments != null ? parsed.arguments : parsed.input;
    if (typeof input === "string") {
      input = safeJsonParse(input, input);
    }
    if (!name) {
      return null;
    }
    return {
      name,
      input: input && typeof input === "object" ? input : {}
    };
  }

  const helpers = {
    TOOL_CALL_OPEN_TAG,
    TOOL_CALL_CLOSE_TAG,
    formatAnthropicSystemForSingleMessage,
    parseLocalCodexToolCall
  };

  root.LocalCodexAdapterHelpers = helpers;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = helpers;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
