import test from "node:test";
import assert from "node:assert/strict";
import helpers from "../local-codex-adapter-helpers.js";

test("formatAnthropicSystemForSingleMessage flattens text blocks", () => {
  const actual = helpers.formatAnthropicSystemForSingleMessage([
    { type: "text", text: " First line " },
    { type: "image", source: { type: "base64", data: "abc" } },
    { type: "text", text: "Second line" }
  ]);
  assert.equal(actual, "First line\n\nSecond line");
});

test("formatAnthropicSystemForSingleMessage accepts raw string", () => {
  assert.equal(helpers.formatAnthropicSystemForSingleMessage("  hello world  "), "hello world");
});

test("parseLocalCodexToolCall extracts JSON payload from wrapped content", () => {
  const actual = helpers.parseLocalCodexToolCall('before <tool_call>{"name":"read_page","arguments":{"tabId":3}}</tool_call> after');
  assert.deepEqual(actual, {
    name: "read_page",
    input: {
      tabId: 3
    }
  });
});

test("parseLocalCodexToolCall extracts structured JSON tool call payload", () => {
  const actual = helpers.parseLocalCodexToolCall('{"kind":"tool_call","name":"browser_tool__read_page","arguments":{"tabId":3}}');
  assert.deepEqual(actual, {
    name: "read_page",
    input: {
      tabId: 3
    }
  });
});

test("parseLocalCodexToolCall extracts structured JSON tool call payload with arguments_json", () => {
  const actual = helpers.parseLocalCodexToolCall('{"kind":"tool_call","name":"browser_tool__read_page","arguments_json":"{\\"tabId\\":3}"}');
  assert.deepEqual(actual, {
    name: "read_page",
    input: {
      tabId: 3
    }
  });
});

test("extractLocalCodexAssistantText unwraps structured assistant payload", () => {
  const actual = helpers.extractLocalCodexAssistantText('{"kind":"assistant","text":"页面第一条动态是生猪专家电话会。"}');
  assert.equal(actual, "页面第一条动态是生猪专家电话会。");
});

test("parseLocalCodexToolCall accepts stringified arguments", () => {
  const actual = helpers.parseLocalCodexToolCall('<tool_call>{"name":"browser_tool__click_selector","arguments":"{\\"selector\\":\\"#submit\\"}"}</tool_call>');
  assert.deepEqual(actual, {
    name: "click_selector",
    input: {
      selector: "#submit"
    }
  });
});

test("parseLocalCodexToolCall returns null for plain assistant text", () => {
  assert.equal(helpers.parseLocalCodexToolCall("No tool call here."), null);
});

test("upsertManagedLocalCodexProfile keeps a single managed profile", () => {
  const actual = helpers.upsertManagedLocalCodexProfile([
    { id: "provider_1", name: "OpenAI", format: "openai_chat" },
    { id: "provider_2", name: "Local Codex", format: "local_codex", baseUrl: "https://local.codex" }
  ], {
    name: "Local Codex",
    format: "local_codex",
    baseUrl: "https://local.codex",
    defaultModel: "gpt-5.4"
  });
  assert.deepEqual(actual, [
    { id: "provider_1", name: "OpenAI", format: "openai_chat" },
    {
      id: helpers.MANAGED_LOCAL_CODEX_PROFILE_ID,
      name: "Local Codex",
      format: "local_codex",
      baseUrl: "https://local.codex",
      defaultModel: "gpt-5.4"
    }
  ]);
});

test("removeManagedLocalCodexProfiles strips all managed local codex entries", () => {
  const actual = helpers.removeManagedLocalCodexProfiles([
    { id: helpers.MANAGED_LOCAL_CODEX_PROFILE_ID, name: "Local Codex", format: "local_codex" },
    { id: "provider_1", name: "OpenAI", format: "openai_chat" },
    { id: "provider_2", name: "Local Codex", format: "local_codex", baseUrl: "https://local.codex" }
  ]);
  assert.deepEqual(actual, [
    { id: "provider_1", name: "OpenAI", format: "openai_chat" }
  ]);
});

test("extractLocalCodexEventText reads completed agent messages", () => {
  const actual = helpers.extractLocalCodexEventText({
    type: "item.completed",
    item: {
      type: "agent_message",
      text: " done "
    }
  });
  assert.equal(actual, "done");
});

test("extractLocalCodexEventError reads explicit error events", () => {
  const actual = helpers.extractLocalCodexEventError({
    type: "turn.failed",
    error: {
      message: "usage limit reached"
    }
  });
  assert.equal(actual, "usage limit reached");
});

test("summarizeLocalCodexTool reports description and argument keys", () => {
  const actual = helpers.summarizeLocalCodexTool({
    name: "read_page",
    description: "Read the current page",
    input_schema: {
      properties: {
        selector: { type: "string" },
        mode: { type: "string" }
      },
      required: ["selector"]
    }
  });
  assert.deepEqual(actual, {
    name: "browser_tool__read_page",
    summary: "Read the current page | args: selector, mode | required: selector"
  });
});

test("sanitizeLocalCodexSystemPrompt removes planning-mode update_plan reminders", () => {
  const actual = helpers.sanitizeLocalCodexSystemPrompt(`Keep answers brief.

<system-reminder>You are in planning mode. Before executing any tools, use update_plan with domains and approach.</system-reminder>

Use the page context carefully.`);
  assert.equal(actual, "Keep answers brief.\nUse the page context carefully.");
});

test("encodeLocalCodexToolName and decodeLocalCodexToolName map browser tool aliases", () => {
  const encoded = helpers.encodeLocalCodexToolName("navigate");
  assert.equal(encoded, "browser_tool__navigate");
  assert.equal(helpers.decodeLocalCodexToolName(encoded), "navigate");
});

test("buildProviderFormatCandidates keeps configured responses first for generic v1 responses providers", () => {
  const actual = helpers.buildProviderFormatCandidates({
    requestedFormat: "openai_responses",
    baseUrl: "https://example.com/v1",
    name: "Codex",
    model: "gpt-5.4",
    stream: true
  });
  assert.deepEqual(actual, [{
    format: "openai_responses",
    reason: "configured_format"
  }, {
    format: "openai_chat",
    reason: "responses_fallback_to_chat"
  }]);
});

test("buildProviderFormatCandidates keeps configured responses first for non-stream generic v1 responses providers", () => {
  const actual = helpers.buildProviderFormatCandidates({
    requestedFormat: "openai_responses",
    baseUrl: "https://example.com/v1",
    name: "OpenAI-compatible",
    model: "gpt-5.4",
    stream: false
  });
  assert.deepEqual(actual, [{
    format: "openai_responses",
    reason: "configured_format"
  }, {
    format: "openai_chat",
    reason: "responses_fallback_to_chat"
  }]);
});

test("buildProviderFormatCandidates keeps only configured responses for explicit responses endpoints", () => {
  const actual = helpers.buildProviderFormatCandidates({
    requestedFormat: "openai_responses",
    baseUrl: "https://example.com/v1/responses",
    name: "Codex",
    model: "gpt-5.4",
    stream: true
  });
  assert.deepEqual(actual, [{
    format: "openai_responses",
    reason: "configured_format"
  }]);
});

test("normalizeProviderBaseUrl strips endpoint suffixes", () => {
  assert.equal(helpers.normalizeProviderBaseUrl("https://example.com/v1/responses"), "https://example.com/v1");
  assert.equal(helpers.normalizeProviderBaseUrl("https://example.com/v1/chat/completions"), "https://example.com/v1");
  assert.equal(helpers.normalizeProviderBaseUrl("https://local.codex/messages"), "https://local.codex");
});

test("buildProviderFormatCandidates keeps responses first for non-chat providers", () => {
  const actual = helpers.buildProviderFormatCandidates({
    requestedFormat: "openai_responses",
    baseUrl: "https://example.com/v1/responses",
    name: "Responses-only gateway",
    model: "text-model",
    stream: true
  });
  assert.deepEqual(actual, [{
    format: "openai_responses",
    reason: "configured_format"
  }]);
});

test("selectLocalCodexTaskError prefers explicit event error", () => {
  const actual = helpers.selectLocalCodexTaskError({
    taskError: "",
    eventError: "usage limit reached",
    exitCode: 1,
    stdoutLines: ["some line"],
    stderrLines: ["stderr line"]
  });
  assert.equal(actual, "usage limit reached");
});

test("selectLocalCodexTaskError falls back to stderr tail when task exits non-zero", () => {
  const actual = helpers.selectLocalCodexTaskError({
    exitCode: 1,
    stderrLines: ["warning", "process failed because quota exceeded"]
  });
  assert.equal(actual, "process failed because quota exceeded");
});

test("selectLocalCodexTaskError unwraps nested JSON error messages", () => {
  const actual = helpers.selectLocalCodexTaskError({
    taskError: "{\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"message\":\"The 'codex-mini-latest' model is not supported when using Codex with a ChatGPT account.\"}}",
    exitCode: 1
  });
  assert.equal(actual, "The 'codex-mini-latest' model is not supported when using Codex with a ChatGPT account.");
});

test("selectLocalCodexTaskError ignores benign MCP auth warnings when structured output exists", () => {
  const actual = helpers.selectLocalCodexTaskError({
    taskError: "2026-04-11T08:57:13.973318Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: \"Bearer resource_metadata=\\\"https://huggingface.co/.well-known/oauth-protected-resource/mcp?login\\\"\" })",
    exitCode: 0,
    hasStructuredOutput: true,
    stderrLines: [
      "2026-04-11T08:57:13.973318Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: \"Bearer resource_metadata=\\\"https://huggingface.co/.well-known/oauth-protected-resource/mcp?login\\\"\" })"
    ]
  });
  assert.equal(actual, "");
});

test("selectLocalCodexTaskError keeps real tool routing errors even with structured output", () => {
  const actual = helpers.selectLocalCodexTaskError({
    eventError: "2026-04-11T08:07:10.287886Z ERROR codex_core::tools::router: error=failed to parse function arguments: unknown field `domains`, expected `explanation` or `plan` at line 1 column 10",
    exitCode: 0,
    hasStructuredOutput: true
  });
  assert.match(actual, /unknown field `domains`/);
});

test("selectLocalCodexTaskError ignores mojibake fallback lines", () => {
  const actual = helpers.selectLocalCodexTaskError({
    exitCode: 1,
    stderrLines: ["������������"]
  });
  assert.equal(actual, "Codex task failed with exit code 1.");
});
