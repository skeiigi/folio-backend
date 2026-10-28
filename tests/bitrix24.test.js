import test from "node:test";
import assert from "node:assert/strict";
import { syncBriefToBitrix } from "../src/bitrix24.js";
import { loadConfig } from "../src/config.js";

const webhookUrl = "https://example.bitrix24.ru/rest/1/test-secret/";
const brief = {
  id: "50000000-0000-4000-8000-000000000001",
  title: "Модель фонаря",
  description: "Стилизованный игровой пропс",
  clientUserId: "client-1",
  authorProfileId: "author-1",
  budgetRange: { min: 5000, max: 10000 },
  desiredDeadline: "2026-12-01",
  status: "submitted",
};

function mockBitrix(existingDeals = []) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    const method = new URL(url).pathname.split("/").at(-1);
    const body = JSON.parse(options.body);
    requests.push({ method, body });
    const result =
      method === "crm.deal.userfield.list.json"
        ? [
            {
              FIELD_NAME: "UF_CRM_1793182488237",
              LIST: [
                { ID: "11", VALUE: "Отправлена" },
                { ID: "12", VALUE: "Обсуждается" },
              ],
            },
          ]
        : method === "crm.deal.list.json"
          ? existingDeals
          : method === "crm.deal.add.json"
            ? 42
            : true;
    return { ok: true, json: async () => ({ result }) };
  };
  return { requests, fetchImpl };
}

test("creates a Bitrix24 deal with mapped Folio fields", async () => {
  const { requests, fetchImpl } = mockBitrix();
  assert.deepEqual(await syncBriefToBitrix(webhookUrl, brief, fetchImpl), {
    action: "created",
    dealId: 42,
  });
  const fields = requests.at(-1).body.fields;
  assert.equal(fields.UF_CRM_1793181972065, brief.id);
  assert.equal(fields.UF_CRM_1793182488237, "11");
  assert.equal(fields.UF_CRM_1793182197423, 5000);
  assert.equal(fields.UF_CRM_1793182318142, "2026-12-01");
  assert.match(fields.COMMENTS, /Стилизованный игровой пропс/);
  assert.deepEqual(
    requests.map((x) => x.method),
    ["crm.deal.userfield.list.json", "crm.deal.list.json", "crm.deal.add.json"],
  );
});

test("updates an existing deal and maps a changed status", async () => {
  const { requests, fetchImpl } = mockBitrix([{ ID: "8" }]);
  const result = await syncBriefToBitrix(
    webhookUrl,
    { ...brief, status: "in_discussion" },
    fetchImpl,
  );
  assert.deepEqual(result, { action: "updated", dealId: "8" });
  assert.equal(requests.at(-1).method, "crm.deal.update.json");
  assert.equal(requests.at(-1).body.fields.UF_CRM_1793182488237, "12");
});

test("Bitrix24 API errors are treated as delivery failures", async () => {
  await assert.rejects(
    syncBriefToBitrix(webhookUrl, brief, async () => ({
      ok: true,
      json: async () => ({ error: "ACCESS_DENIED" }),
    })),
    /ACCESS_DENIED/,
  );
});

test("validates the incoming webhook URL", () => {
  assert.throws(
    () => loadConfig({ BITRIX24_WEBHOOK_URL: "https://example.com/other" }),
    /incoming REST webhook/,
  );
  assert.equal(
    loadConfig({ BITRIX24_WEBHOOK_URL: webhookUrl }).integrations.bitrixUrl,
    webhookUrl,
  );
});
