(function (root) {
  const TOOL_CALL_OPEN_TAG = "<tool_call>";
  const TOOL_CALL_CLOSE_TAG = "</tool_call>";
  const MANAGED_LOCAL_CODEX_PROFILE_ID = "__managed_local_codex__";

  function normalizeText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

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

  function isManagedLocalCodexProfile(profile) {
    if (!profile || typeof profile !== "object") {
      return false;
    }
    if (String(profile.id || "").trim() === MANAGED_LOCAL_CODEX_PROFILE_ID) {
      return true;
    }
    const format = normalizeText(profile.format).toLowerCase();
    const name = normalizeText(profile.name).toLowerCase();
    const baseUrl = normalizeText(profile.baseUrl).replace(/\/+$/, "").toLowerCase();
    return format === "local_codex" && name === "local codex" && baseUrl === "https://local.codex";
  }

  function removeManagedLocalCodexProfiles(profiles) {
    return Array.isArray(profiles) ? profiles.filter(function (profile) {
      return !isManagedLocalCodexProfile(profile);
    }) : [];
  }

  function upsertManagedLocalCodexProfile(profiles, profile) {
    const nextProfile = profile && typeof profile === "object" ? {
      ...profile,
      id: MANAGED_LOCAL_CODEX_PROFILE_ID
    } : {
      id: MANAGED_LOCAL_CODEX_PROFILE_ID
    };
    return removeManagedLocalCodexProfiles(profiles).concat(nextProfile);
  }

  function extractTextFromContentParts(parts) {
    if (!Array.isArray(parts)) {
      return "";
    }
    const texts = [];
    for (const part of parts) {
      if (!part || typeof part !== "object") {
        continue;
      }
      const text = normalizeText(part.text ?? part.content ?? "");
      if (text) {
        texts.push(text);
      }
    }
    return texts.join("\n\n").trim();
  }

  function extractLocalCodexEventText(event) {
    if (!event || typeof event !== "object") {
      return "";
    }
    const directText = normalizeText(event.text);
    if (directText) {
      return directText;
    }
    const item = event.item && typeof event.item === "object" ? event.item : null;
    const itemText = normalizeText(item?.text);
    if (itemText) {
      return itemText;
    }
    const contentText = extractTextFromContentParts(item?.content);
    if (contentText) {
      return contentText;
    }
    return "";
  }

  function extractLocalCodexEventError(event) {
    if (!event || typeof event !== "object") {
      return "";
    }
    if (event.type === "error") {
      return normalizeText(event.message || event.error?.message || event.error);
    }
    if (event.type === "turn.failed" || event.type === "item.failed") {
      return normalizeText(event.error?.message || event.message || event.error);
    }
    return "";
  }

  const helpers = {
    TOOL_CALL_OPEN_TAG,
    TOOL_CALL_CLOSE_TAG,
    MANAGED_LOCAL_CODEX_PROFILE_ID,
    formatAnthropicSystemForSingleMessage,
    parseLocalCodexToolCall,
    isManagedLocalCodexProfile,
    removeManagedLocalCodexProfiles,
    upsertManagedLocalCodexProfile,
    extractLocalCodexEventText,
    extractLocalCodexEventError
  };

  root.LocalCodexAdapterHelpers = helpers;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = helpers;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
