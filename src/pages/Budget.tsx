import { useEffect, useMemo, useState } from "react";
import { api, type Category } from "../lib/api";
import { formatMoney, parseDollarsToCents } from "../lib/format";

export default function Budget() {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Settings state (savings starting balance / as-of date)
  const [startingBalanceInput, setStartingBalanceInput] = useState("");
  const [asOfInput, setAsOfInput] = useState("");
  const [settingsBusy, setSettingsBusy] = useState(false);

  // Add-new state
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newKind, setNewKind] = useState<Category["kind"]>("expense");
  const [addBusy, setAddBusy] = useState(false);

  async function refresh() {
    try {
      const [cats, s] = await Promise.all([api.listCategories(), api.getSettings()]);
      setCategories(cats.categories);
      const cents = Number(s.settings.savings_starting_balance_cents ?? "0");
      setStartingBalanceInput((cents / 100).toFixed(2));
      setAsOfInput(s.settings.savings_starting_as_of_iso ?? "");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const totals = useMemo(() => {
    if (!categories) return null;
    let expense = 0;
    let savings = 0;
    let income = 0;
    for (const c of categories) {
      if (c.archived) continue;
      if (c.kind === "expense") expense += c.amount_cents;
      else if (c.kind === "savings") savings += c.amount_cents;
      else if (c.kind === "income") income += c.amount_cents;
    }
    return { expense, savings, income, allocated: expense + savings };
  }, [categories]);

  async function handleUpdate(id: number, patch: Parameters<typeof api.updateCategory>[1]) {
    try {
      const r = await api.updateCategory(id, patch);
      setCategories((cs) =>
        (cs || []).map((c) => (c.id === id ? r.category : c)),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this category? If it has transactions, it'll be archived instead.")) {
      return;
    }
    try {
      await api.deleteCategory(id);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const cents = parseDollarsToCents(newAmount);
    if (cents === null || cents < 0) {
      setError("Amount must be a non-negative number");
      return;
    }
    setAddBusy(true);
    setError(null);
    try {
      await api.createCategory({ name: newName.trim(), amount: cents / 100, kind: newKind });
      setNewName("");
      setNewAmount("");
      setNewKind("expense");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAddBusy(false);
    }
  }

  async function handleSettingsSave() {
    const cents = parseDollarsToCents(startingBalanceInput);
    if (cents === null || cents < 0) {
      setError("Starting balance must be a non-negative number");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfInput)) {
      setError("As-of date must be YYYY-MM-DD");
      return;
    }
    setSettingsBusy(true);
    setError(null);
    try {
      await api.updateSettings({
        savings_starting_balance_cents: cents,
        savings_starting_as_of_iso: asOfInput,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSettingsBusy(false);
    }
  }

  if (!categories) {
    return <div className="text-muted">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg bg-warn/10 px-4 py-3 text-sm text-warn">
          {error}{" "}
          <button onClick={() => setError(null)} className="underline">
            dismiss
          </button>
        </div>
      )}

      <section className="card">
        <h2 className="text-lg font-semibold">Savings tracker</h2>
        <p className="mt-1 text-sm text-muted">
          The scoreboard tracks a cumulative savings balance. Set the starting
          point and the date it's accurate as of.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="block text-sm">
            <span className="text-muted">Starting balance ($)</span>
            <input
              className="input mt-1"
              inputMode="decimal"
              value={startingBalanceInput}
              onChange={(e) => setStartingBalanceInput(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">As of date</span>
            <input
              className="input mt-1"
              type="date"
              value={asOfInput}
              onChange={(e) => setAsOfInput(e.target.value)}
            />
          </label>
          <button
            onClick={handleSettingsSave}
            disabled={settingsBusy}
            className="btn-primary"
          >
            {settingsBusy ? "Saving…" : "Save"}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Categories</h2>
          {totals && (
            <div className="text-sm text-muted">
              Expense {formatMoney(totals.expense)} · Savings{" "}
              {formatMoney(totals.savings)} ·{" "}
              <span className="font-medium text-ink">
                Total {formatMoney(totals.allocated)}
              </span>
            </div>
          )}
        </div>

        <ul className="mt-4 divide-y divide-ink/10">
          {categories.map((c) => (
            <CategoryRow
              key={c.id}
              category={c}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          ))}
        </ul>

        <form
          onSubmit={handleAdd}
          className="mt-6 grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
        >
          <label className="block text-sm">
            <span className="text-muted">New category name</span>
            <input
              className="input mt-1"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Burn Boot Camp"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Amount ($)</span>
            <input
              className="input mt-1"
              inputMode="decimal"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              placeholder="0"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Kind</span>
            <select
              className="input mt-1"
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as Category["kind"])}
            >
              <option value="expense">Expense</option>
              <option value="savings">Savings</option>
              <option value="income">Income</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={addBusy || !newName.trim()}
            className="btn-primary"
          >
            {addBusy ? "Adding…" : "Add"}
          </button>
        </form>
      </section>
    </div>
  );
}

function CategoryRow({
  category,
  onUpdate,
  onDelete,
}: {
  category: Category;
  onUpdate: (id: number, patch: Parameters<typeof api.updateCategory>[1]) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [name, setName] = useState(category.name);
  const [amount, setAmount] = useState((category.amount_cents / 100).toFixed(2));
  const [kind, setKind] = useState<Category["kind"]>(category.kind);

  // Sync state if parent reloads.
  useEffect(() => {
    setName(category.name);
    setAmount((category.amount_cents / 100).toFixed(2));
    setKind(category.kind);
  }, [category.id, category.name, category.amount_cents, category.kind]);

  const dirty =
    name.trim() !== category.name ||
    Math.round(Number(amount) * 100) !== category.amount_cents ||
    kind !== category.kind;

  return (
    <li className="grid items-center gap-3 py-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
      <input
        className="input"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="input"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <select
        className="input"
        value={kind}
        onChange={(e) => setKind(e.target.value as Category["kind"])}
      >
        <option value="expense">Expense</option>
        <option value="savings">Savings</option>
        <option value="income">Income</option>
      </select>
      <div className="flex gap-2">
        <button
          className="btn-primary"
          disabled={!dirty || !name.trim()}
          onClick={() => {
            const cents = parseDollarsToCents(amount);
            if (cents === null || cents < 0) return;
            onUpdate(category.id, {
              name: name.trim(),
              amount: cents / 100,
              kind,
            });
          }}
        >
          Save
        </button>
        <button
          className="btn-secondary"
          onClick={() => onDelete(category.id)}
          title="Delete or archive"
        >
          ✕
        </button>
      </div>
    </li>
  );
}
