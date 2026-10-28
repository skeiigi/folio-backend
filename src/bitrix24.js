const FIELD = {
  briefId: "UF_CRM_1793181972065",
  authorId: "UF_CRM_1793182056384",
  clientId: "UF_CRM_1793182127600",
  budgetMin: "UF_CRM_1793182197423",
  budgetMax: "UF_CRM_1793182251952",
  deadline: "UF_CRM_1793182318142",
  status: "UF_CRM_1793182488237",
};

const STATUS = {
  submitted: "Отправлена",
  in_discussion: "Обсуждается",
  accepted: "Принята",
  in_progress: "В работе",
  completed: "Завершена",
  rejected: "Отклонена",
  cancelled: "Отменена",
};

async function call(webhookUrl, method, params, fetchImpl) {
  const response = await fetchImpl(
    new URL(`${method}.json`, `${webhookUrl.replace(/\/$/, "")}/`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok) throw new Error(`Bitrix24 HTTP ${response.status}`);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("Bitrix24 returned invalid JSON");
  }
  if (body.error)
    throw new Error(`Bitrix24 ${String(body.error).slice(0, 60)}`);
  return body.result;
}

export async function syncBriefToBitrix(webhookUrl, brief, fetchImpl = fetch) {
  const statusName = STATUS[brief.status];
  if (!statusName)
    throw new Error(`Unknown Folio brief status: ${brief.status}`);

  const userFields = await call(
    webhookUrl,
    "crm.deal.userfield.list",
    { filter: { FIELD_NAME: FIELD.status } },
    fetchImpl,
  );
  const statusField = userFields?.find(
    (field) => field.FIELD_NAME === FIELD.status,
  );
  const statusOption = statusField?.LIST?.find(
    (item) => item.VALUE === statusName,
  );
  if (!statusOption)
    throw new Error(`Bitrix24 status option missing: ${statusName}`);

  const fields = {
    TITLE: brief.title,
    COMMENTS: `Заявка Folio: ${brief.id}\n\n${brief.description || ""}`,
    [FIELD.briefId]: brief.id,
    [FIELD.authorId]: brief.authorProfileId,
    [FIELD.clientId]: brief.clientUserId,
    [FIELD.budgetMin]: brief.budgetRange?.min ?? null,
    [FIELD.budgetMax]: brief.budgetRange?.max ?? null,
    [FIELD.deadline]: brief.desiredDeadline
      ? String(brief.desiredDeadline).slice(0, 10)
      : null,
    [FIELD.status]: statusOption.ID,
  };
  const deals = await call(
    webhookUrl,
    "crm.deal.list",
    { filter: { [FIELD.briefId]: brief.id }, select: ["ID"] },
    fetchImpl,
  );
  const existingId = deals?.[0]?.ID;
  if (existingId) {
    await call(
      webhookUrl,
      "crm.deal.update",
      { id: existingId, fields },
      fetchImpl,
    );
    return { action: "updated", dealId: existingId };
  }
  const dealId = await call(
    webhookUrl,
    "crm.deal.add",
    { fields: { ...fields, CATEGORY_ID: 0 } },
    fetchImpl,
  );
  return { action: "created", dealId };
}
