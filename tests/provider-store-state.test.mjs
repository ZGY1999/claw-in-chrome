import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const scriptSource = await fs.readFile("D:\\CHAT\\claw-in-chrome\\custom-provider-models.js", "utf8");

function createStorageArea(seed = {}) {
  const data = { ...seed };
  return {
    async get(keys) {
      if (Array.isArray(keys)) {
        const result = {};
        for (const key of keys) {
          result[key] = data[key];
        }
        return result;
      }
      if (typeof keys === "string") {
        return { [keys]: data[keys] };
      }
      return { ...data };
    },
    async set(values) {
      Object.assign(data, values || {});
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete data[key];
      }
    },
    snapshot() {
      return { ...data };
    }
  };
}

async function loadHelpers(seed) {
  const storageArea = createStorageArea(seed);
  const context = {
    globalThis: null,
    chrome: {
      storage: {
        local: storageArea
      },
      runtime: {
        sendMessage: async function () {
          return { success: true, status: { connected: true, loggedIn: true } };
        }
      }
    },
    AbortController,
    AbortSignal,
    URL,
    fetch: async function () {
      throw new Error("fetch should not be called in this test");
    },
    setTimeout,
    clearTimeout,
    console,
    module: undefined,
    exports: undefined
  };
  context.globalThis = context;
  vm.runInNewContext(scriptSource, context, {
    filename: "custom-provider-models.js"
  });
  return {
    helpers: context.CustomProviderModels,
    storageArea
  };
}

test("readProviderStoreState restores a usable legacy API profile when only stale local codex profiles remain", async () => {
  const legacyConfig = {
    enabled: true,
    name: "OpenAI",
    format: "openai_chat",
    baseUrl: "https://example.com/v1",
    apiKey: "sk-test",
    defaultModel: "gpt-5.4",
    reasoningEffort: "high",
    contextWindow: 200000,
    notes: ""
  };
  const { helpers, storageArea } = await loadHelpers({
    customProviderConfig: legacyConfig,
    customProviderProfiles: [
      {
        id: "provider_bad_local",
        name: "Local Codex",
        format: "local_codex",
        baseUrl: "https://local.codex",
        apiKey: "local-codex",
        defaultModel: "gpt-5.4"
      },
      {
        id: "provider_bad_api",
        name: "OpenAI",
        format: "anthropic",
        baseUrl: "",
        apiKey: "",
        defaultModel: ""
      }
    ],
    customProviderActiveProfileId: "provider_bad_local"
  });

  const state = await helpers.readProviderStoreState();
  assert.equal(state.activeProfile?.format, "openai_chat");
  assert.equal(state.activeProfile?.baseUrl, "https://example.com/v1");
  assert.equal(state.activeProfile?.apiKey, "sk-test");
  assert.equal(state.activeProfile?.defaultModel, "gpt-5.4");

  const stored = storageArea.snapshot();
  assert.equal(Array.isArray(stored.customProviderProfiles), true);
  assert.equal(stored.customProviderProfiles.some(profile => profile.format === "local_codex"), false);
  assert.equal(stored.customProviderActiveProfileId, state.activeProfileId);
});

test("resolveActiveProfileId prefers the first usable API profile over unusable entries", async () => {
  const { helpers } = await loadHelpers({});
  const profiles = [
    {
      id: "provider_invalid",
      name: "Broken",
      format: "anthropic",
      baseUrl: "",
      apiKey: "",
      defaultModel: ""
    },
    {
      id: "provider_valid",
      name: "Gateway",
      format: "openai_chat",
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      defaultModel: "gpt-5.4"
    }
  ];
  const state = await helpers.persistProviderStoreState({
    storageArea: createStorageArea({}),
    profiles,
    activeProfileId: "provider_invalid",
    currentApiKey: ""
  });
  assert.equal(state.activeProfileId, "provider_valid");
  assert.equal(state.activeProfile?.format, "openai_chat");
});
