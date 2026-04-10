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

test("parseLocalCodexToolCall accepts stringified arguments", () => {
  const actual = helpers.parseLocalCodexToolCall('<tool_call>{"name":"click_selector","arguments":"{\\"selector\\":\\"#submit\\"}"}</tool_call>');
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
