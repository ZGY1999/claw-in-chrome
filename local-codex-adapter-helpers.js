(function (root) {
  const TOOL_CALL_OPEN_TAG = "<tool_call>";
  const TOOL_CALL_CLOSE_TAG = "</tool_call>";
  const MANAGED_LOCAL_CODEX_PROFILE_ID = "__managed_local_codex__";
  const OPENAI_CHAT_FORMAT = "openai_chat";
  const OPENAI_RESPONSES_FORMAT = "openai_responses";
  const LOCAL_CODEX_OUTPUT_SCHEMA_VERSION = "2026-04-11";
  const LOCAL_CODEX_TOOL_PREFIX = "browser_tool__";

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

  function normalizeProviderBaseUrl(value) {
    let baseUrl = normalizeText(value).replace(/\/+$/, "");
    if (!baseUrl) {
      return "";
    }
    baseUrl = baseUrl.replace(/\/chat\/completions$/i, "");
    baseUrl = baseUrl.replace(/\/responses$/i, "");
    baseUrl = baseUrl.replace(/\/messages$/i, "");
    return baseUrl.replace(/\/+$/, "");
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

  function encodeLocalCodexToolName(name) {
    const normalized = normalizeText(name);
    if (!normalized) {
      return "";
    }
    if (normalized.startsWith(LOCAL_CODEX_TOOL_PREFIX)) {
      return normalized;
    }
    return LOCAL_CODEX_TOOL_PREFIX + normalized;
  }

  function decodeLocalCodexToolName(name) {
    const normalized = normalizeText(name);
    if (!normalized) {
      return "";
    }
    if (!normalized.startsWith(LOCAL_CODEX_TOOL_PREFIX)) {
      return normalized;
    }
    return normalized.slice(LOCAL_CODEX_TOOL_PREFIX.length);
  }

  function sanitizeLocalCodexSystemPrompt(text) {
    const source = normalizeText(text);
    if (!source) {
      return "";
    }
    const withoutReminderBlocks = source.replace(/<system-reminder>[\s\S]*?(update_plan|planning mode|domains|approach|PL\s*\{)[\s\S]*?<\/system-reminder>/gi, "").trim();
    const filteredLines = withoutReminderBlocks.split(/\r?\n/).filter(function (line) {
      const normalizedLine = normalizeText(line).toLowerCase();
      if (!normalizedLine) {
        return false;
      }
      return !(/update_plan|planning mode|domains|approach|^pl\s*\{|permission prompts are skipped|follow-a-plan/.test(normalizedLine));
    });
    return filteredLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function parseLocalCodexToolCall(text) {
    const rawText = typeof text === "string" ? text.trim() : "";
    if (!rawText) {
      return null;
    }
    const structured = safeJsonParse(rawText, null);
    if (structured && typeof structured === "object" && structured.kind === "tool_call") {
      const name = normalizeText(structured.name);
      let input = structured.arguments && typeof structured.arguments === "object" ? structured.arguments : null;
      if (!input && typeof structured.arguments_json === "string") {
        const parsedArguments = safeJsonParse(structured.arguments_json, null);
        input = parsedArguments && typeof parsedArguments === "object" ? parsedArguments : {};
      }
      if (!input) {
        input = {};
      }
      if (!name) {
        return null;
      }
      return {
        name: decodeLocalCodexToolName(name),
        input
      };
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
      name: decodeLocalCodexToolName(name),
      input: input && typeof input === "object" ? input : {}
    };
  }

  function extractLocalCodexAssistantText(text) {
    const rawText = typeof text === "string" ? text.trim() : "";
    if (!rawText) {
      return "";
    }
    const structured = safeJsonParse(rawText, null);
    if (structured && typeof structured === "object" && structured.kind === "assistant") {
      return normalizeText(structured.text);
    }
    return rawText;
  }

  function summarizeLocalCodexTool(tool) {
    const name = normalizeText(tool?.name) || "tool";
    const description = normalizeText(tool?.description);
    const schema = tool?.input_schema && typeof tool.input_schema === "object" ? tool.input_schema : {};
    const properties = schema.properties && typeof schema.properties === "object" ? Object.keys(schema.properties) : [];
    const required = Array.isArray(schema.required) ? schema.required.filter(item => typeof item === "string" && item.trim()) : [];
    const parts = [];
    if (description) {
      parts.push(description);
    }
    if (properties.length) {
      parts.push("args: " + properties.join(", "));
    }
    if (required.length) {
      parts.push("required: " + required.join(", "));
    }
    return {
      name: encodeLocalCodexToolName(name),
      summary: parts.join(" | ")
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
    pushCandidate(requestedFormat, "configured_format");
    if (requestedFormat === OPENAI_RESPONSES_FORMAT && isLikelyChatLikeProvider(source) && !/\/responses$/i.test(baseUrl)) {
      pushCandidate(OPENAI_CHAT_FORMAT, "responses_fallback_to_chat");
    }
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
    LOCAL_CODEX_OUTPUT_SCHEMA_VERSION,
    LOCAL_CODEX_TOOL_PREFIX,
    OPENAI_CHAT_FORMAT,
    OPENAI_RESPONSES_FORMAT,
    encodeLocalCodexToolName,
    decodeLocalCodexToolName,
    sanitizeLocalCodexSystemPrompt,
    formatAnthropicSystemForSingleMessage,
    parseLocalCodexToolCall,
    extractLocalCodexAssistantText,
    summarizeLocalCodexTool,
    isManagedLocalCodexProfile,
    removeManagedLocalCodexProfiles,
    upsertManagedLocalCodexProfile,
    extractLocalCodexEventText,
    extractLocalCodexEventError,
    normalizeProviderBaseUrl,
    buildProviderFormatCandidates,
    selectLocalCodexTaskError
  };

  root.LocalCodexAdapterHelpers = helpers;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = helpers;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
