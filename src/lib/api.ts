// Typed fetch helpers for the API. Throws on non-2xx.

export type Category = {
  id: number;
  name: string;
  amount_cents: number;
  kind: "expense" | "savings" | "income";
  sort_order: number;
  archived: boolean;
  created_at: number;
};

export type Settings = {
  savings_starting_balance_cents?: string;
  savings_starting_as_of_iso?: string;
};

export type Account = {
  id: number;
  name: string;
  kind: "checking" | "credit_card";
  parser: "main_checking" | "chase_reserve" | "chase_amazon";
  created_at: number;
};

export type Upload = {
  id: number;
  account_id: number;
  account_name: string;
  filename: string;
  earliest_date_iso: string;
  latest_date_iso: string;
  row_count: number;
  rows_inserted: number;
  rows_duplicated: number;
  uploaded_at: number;
};

export type UploadRowInput = {
  posted_at_iso: string;
  description: string;
  amount_cents: number;
  raw_classification?: string;
};

export type TransactionSplit = {
  id: number;
  transaction_id: number;
  category_id: number;
  category_name: string;
  amount_cents: number;
};

export type Transaction = {
  id: number;
  account_id: number;
  account_name: string;
  posted_at_iso: string;
  description: string;
  amount_cents: number;
  raw_classification: string | null;
  is_transfer: boolean;
  category_id: number | null;
  category_name: string | null;
  misc_income_id: number | null;
  notes: string | null;
  dedup_ordinal: number;
  created_at: number;
  splits: TransactionSplit[];
  suggested_category_id: number | null;
  suggested_category_name: string | null;
};

export type TransactionsResponse = {
  month: string;
  counts: { total: number; uncategorized: number; transfers: number };
  transactions: Transaction[];
};

export class ApiError extends Error {
  constructor(public status: number, public payload: unknown) {
    super(`API ${status}: ${JSON.stringify(payload)}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    ...init,
  });
  const text = await r.text();
  const payload = text ? JSON.parse(text) : null;
  if (!r.ok) throw new ApiError(r.status, payload);
  return payload as T;
}

export const api = {
  listCategories: (includeArchived = false) =>
    request<{ categories: Category[] }>(
      `/api/categories${includeArchived ? "?includeArchived=1" : ""}`,
    ),
  createCategory: (input: { name: string; amount: number; kind?: Category["kind"] }) =>
    request<{ category: Category }>("/api/categories", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCategory: (id: number, input: Partial<Pick<Category, "name" | "kind" | "sort_order" | "archived">> & { amount?: number }) =>
    request<{ category: Category }>(`/api/categories/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  deleteCategory: (id: number) =>
    request<{ deleted?: boolean; archived?: boolean }>(`/api/categories/${id}`, {
      method: "DELETE",
    }),

  getSettings: () => request<{ settings: Settings }>("/api/settings"),
  updateSettings: (input: {
    savings_starting_balance_cents?: string | number;
    savings_starting_as_of_iso?: string;
  }) =>
    request<{ settings: Settings }>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  listAccounts: () => request<{ accounts: Account[] }>("/api/accounts"),

  listUploads: () => request<{ uploads: Upload[] }>("/api/uploads"),
  createUpload: (input: {
    account_id: number;
    filename: string;
    rows: UploadRowInput[];
  }) =>
    request<{ upload: Upload }>("/api/uploads", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  listTransactions: (opts: {
    month?: string;
    account_id?: number;
    status?: "all" | "uncategorized" | "categorized" | "transfer";
  } = {}) => {
    const q = new URLSearchParams();
    if (opts.month) q.set("month", opts.month);
    if (opts.account_id) q.set("account_id", String(opts.account_id));
    if (opts.status) q.set("status", opts.status);
    const qs = q.toString();
    return request<TransactionsResponse>(`/api/transactions${qs ? `?${qs}` : ""}`);
  },
  updateTransaction: (
    id: number,
    patch: {
      category_id?: number | null;
      is_transfer?: boolean;
      notes?: string | null;
      misc_income_id?: number | null;
    },
  ) =>
    request<{ ok: true }>(`/api/transactions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  rescanTransactions: () =>
    request<{
      ok: true;
      scanned: number;
      categorized: number;
      transferred: number;
    }>(`/api/transactions/rescan`, { method: "POST" }),
  setSplits: (
    id: number,
    splits: { category_id: number; amount_cents: number }[],
  ) =>
    request<{ ok: true; splits: number }>(`/api/transactions/${id}/splits`, {
      method: "PUT",
      body: JSON.stringify({ splits }),
    }),
  clearSplits: (id: number) =>
    request<{ ok: true }>(`/api/transactions/${id}/splits`, {
      method: "DELETE",
    }),
};
