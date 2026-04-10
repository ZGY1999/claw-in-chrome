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
