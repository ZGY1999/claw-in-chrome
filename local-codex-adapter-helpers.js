(function (root) {
  const TOOL_CALL_OPEN_TAG = "<tool_call>";
  const TOOL_CALL_CLOSE_TAG = "</tool_call>";
  const MANAGED_LOCAL_CODEX_PROFILE_ID = "__managed_local_codex__";
  const OPENAI_CHAT_FORMAT = "openai_chat";
  const OPENAI_RESPONSES_FORMAT = "openai_responses";

  function normalizeText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function tryExtractJsonErrorMessage(value) {
    let current = normalizeText(value);
    for (let depth = 0; depth < 3 && current; depth += 1) {
      const parsed = safeJsonParse(current, null);
      if (!parsed || typeof parsed !== "object") {
        return "";
      }
      const nestedCandidates = [
        parsed?.error?.message,
        parsed?.message,
        parsed?.detail,
        parsed?.reason
      ];
      for (const candidate of nestedCandidates) {
        const text = normalizeText(candidate);
        if (text && text !== current) {
          return text;
        }
      }
      current = typeof parsed.error === "string" ? normalizeText(parsed.error) : "";
    }
    return "";
  }

  function isUnreadableErrorText(value) {
    const text = normalizeText(value);
    if (!text) {
      return false;
    }
    const replacementCount = (text.match(/\uFFFD/g) || []).length;
    if (replacementCount >= 2) {
      return true;
    }
    return /^[\uFFFD\ufffd\?]+$/.test(text);
  }

  function normalizeErrorText(value) {
    const text = normalizeText(value);
    if (!text) {
      return "";
    }
    const nestedMessage = tryExtractJsonErrorMessage(text);
    if (nestedMessage) {
      return nestedMessage;
    }
    return text;
  }

  function normalizeProviderFormat(value) {
    const format = normalizeText(value).toLowerCase();
    if (format === "openai" || format === OPENAI_CHAT_FORMAT) {
      return OPENAI_CHAT_FORMAT;
    }
    if (format === "responses" || format === OPENAI_RESPONSES_FORMAT) {
      return OPENAI_RESPONSES_FORMAT;
    }
    return format;
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

  function isLikelyChatLikeProvider(options) {
    const source = options && typeof options === "object" ? options : {};
    const name = normalizeText(source.name).toLowerCase();
    const model = normalizeText(source.model).toLowerCase();
    return name.includes("openai") || name.includes("gpt") || model.startsWith("gpt-") || model.startsWith("chatgpt") || model.length > 1 && model.startsWith("o") && /\d/.test(model[1]);
  }

  function buildProviderFormatCandidates(options) {
    const source = options && typeof options === "object" ? options : {};
    const requestedFormat = normalizeProviderFormat(source.requestedFormat);
    const baseUrl = normalizeText(source.baseUrl).toLowerCase();
    const candidates = [];
    function pushCandidate(format, reason) {
      const normalizedFormat = normalizeProviderFormat(format);
      if (!normalizedFormat || candidates.some(function (candidate) {
        return candidate.format === normalizedFormat;
      })) {
        return;
      }
      candidates.push({
        format: normalizedFormat,
        reason
      });
    }
    if (requestedFormat === OPENAI_RESPONSES_FORMAT && isLikelyChatLikeProvider(source) && !/\/responses$/i.test(baseUrl)) {
      pushCandidate(OPENAI_CHAT_FORMAT, "prefer_chat_for_generic_v1");
      pushCandidate(OPENAI_RESPONSES_FORMAT, "responses_fallback_to_chat");
      return candidates;
    }
    pushCandidate(requestedFormat, "configured_format");
    return candidates;
  }

  function selectLocalCodexTaskError(options) {
    const source = options && typeof options === "object" ? options : {};
    const directCandidates = [source.taskError, source.eventError, source.hostError];
    for (const candidate of directCandidates) {
      const text = normalizeErrorText(candidate);
      if (text) {
        return text;
      }
    }
    const stderrTail = Array.isArray(source.stderrLines) ? source.stderrLines.map(normalizeErrorText).filter(Boolean) : [];
    const stdoutTail = Array.isArray(source.stdoutLines) ? source.stdoutLines.map(normalizeErrorText).filter(Boolean) : [];
    const keywordPattern = /(error|failed|limit|quota|denied|forbidden|unauthorized|timed out|timeout|unavailable|invalid_request_error|not supported)/i;
    for (const line of stderrTail.slice().reverse()) {
      if (!isUnreadableErrorText(line) && keywordPattern.test(line)) {
        return line;
      }
    }
    for (const line of stdoutTail.slice().reverse()) {
      if (!isUnreadableErrorText(line) && keywordPattern.test(line)) {
        return line;
      }
    }
    const fallbackLine = stderrTail[stderrTail.length - 1] || stdoutTail[stdoutTail.length - 1] || "";
    if (fallbackLine && !isUnreadableErrorText(fallbackLine)) {
      return fallbackLine;
    }
    const exitCode = Number(source.exitCode || 0);
    return exitCode !== 0 ? `Codex task failed with exit code ${exitCode}.` : "";
  }

  const helpers = {
    TOOL_CALL_OPEN_TAG,
    TOOL_CALL_CLOSE_TAG,
    MANAGED_LOCAL_CODEX_PROFILE_ID,
    OPENAI_CHAT_FORMAT,
    OPENAI_RESPONSES_FORMAT,
    formatAnthropicSystemForSingleMessage,
    parseLocalCodexToolCall,
    isManagedLocalCodexProfile,
    removeManagedLocalCodexProfiles,
    upsertManagedLocalCodexProfile,
    extractLocalCodexEventText,
    extractLocalCodexEventError,
    buildProviderFormatCandidates,
    selectLocalCodexTaskError
  };

  root.LocalCodexAdapterHelpers = helpers;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = helpers;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
