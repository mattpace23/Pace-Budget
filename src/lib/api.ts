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
};
