"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

type Priority = "low" | "medium" | "high";
type Todo = {
  id: string;
  text: string;
  done: boolean;
  priority: Priority;
  due?: string; // YYYY-MM-DD
  createdAt: number;
};
type Filter = "all" | "active" | "done";
type Sort = "manual" | "due" | "priority";
type Theme = "system" | "light" | "dark";
type Removed = { todo: Todo; index: number };

const STORAGE_KEY = "todos";
const THEME_KEY = "theme";
const PRIORITIES: Priority[] = ["low", "medium", "high"];
const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
const UNDO_MS = 5000;

// Local date as YYYY-MM-DD (toISOString would give the UTC date)
function isoDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dueLabel(due: string, todayIso: string) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (due === todayIso) return "Today";
  if (due === isoDate(tomorrow)) return "Tomorrow";
  const [y, m, d] = due.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Older saved todos only had id/text/done
function normalize(raw: unknown): Todo[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t) => t && typeof t.id === "string" && typeof t.text === "string")
    .map((t) => ({
      id: t.id,
      text: t.text,
      done: !!t.done,
      priority: PRIORITIES.includes(t.priority) ? t.priority : "medium",
      due: typeof t.due === "string" && t.due ? t.due : undefined,
      createdAt: typeof t.createdAt === "number" ? t.createdAt : Date.now(),
    }));
}

export default function Home() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [text, setText] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [due, setDue] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("manual");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Removed[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [today, setToday] = useState("");
  const [todayIso, setTodayIso] = useState("");
  const [theme, setTheme] = useState<Theme>("system");

  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Blur also fires after Enter/Escape unmount the input; this makes sure an edit ends once
  const editingRef = useRef<string | null>(null);

  // Load from localStorage after mount to avoid hydration mismatch
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setTodos(normalize(JSON.parse(saved)));
      const savedTheme = localStorage.getItem(THEME_KEY);
      if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);
    } catch {}
    const now = new Date();
    setToday(now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }));
    setTodayIso(isoDate(now));
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
    } catch {}
  }, [todos, loaded]);

  // "/" or "n" focuses the new-task input, "f" focuses search, Esc clears search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (e.key === "Escape" && target === searchRef.current) {
        setSearch("");
        searchRef.current?.blur();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/" || e.key === "n") {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  function changeTheme(next: Theme) {
    setTheme(next);
    const root = document.documentElement;
    if (next === "system") delete root.dataset.theme;
    else root.dataset.theme = next;
    try {
      if (next === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {}
  }

  function addTodo(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    const todo: Todo = {
      id: crypto.randomUUID(),
      text: value,
      done: false,
      priority,
      due: due || undefined,
      createdAt: Date.now(),
    };
    setTodos((prev) => [todo, ...prev]);
    setText("");
    setDue("");
  }

  const update = (id: string, patch: Partial<Todo>) =>
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const cyclePriority = (t: Todo) =>
    update(t.id, { priority: PRIORITIES[(PRIORITIES.indexOf(t.priority) + 1) % PRIORITIES.length] });

  // Removes todos but keeps them (with their positions) so the toast can undo it
  function removeWhere(match: (t: Todo) => boolean) {
    const gone: Removed[] = [];
    todos.forEach((todo, index) => match(todo) && gone.push({ todo, index }));
    if (gone.length === 0) return;
    setTodos((prev) => prev.filter((t) => !match(t)));
    setRemoved(gone);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setRemoved(null), UNDO_MS);
  }

  function undo() {
    if (!removed) return;
    setTodos((prev) => {
      const next = [...prev];
      for (const { todo, index } of removed) next.splice(index, 0, todo);
      return next;
    });
    setRemoved(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }

  function startEdit(t: Todo) {
    editingRef.current = t.id;
    setEditingId(t.id);
    setEditText(t.text);
  }

  function cancelEdit() {
    editingRef.current = null;
    setEditingId(null);
  }

  function saveEdit() {
    const id = editingRef.current;
    if (!id) return;
    const value = editText.trim();
    cancelEdit();
    if (value) update(id, { text: value });
    else removeWhere((t) => t.id === id);
  }

  const allDone = todos.length > 0 && todos.every((t) => t.done);
  const toggleAll = () => setTodos((prev) => prev.map((t) => ({ ...t, done: !allDone })));

  // Drag & drop: move the dragged todo to the target's position in the full list
  function drop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    setTodos((prev) => {
      const from = prev.findIndex((t) => t.id === dragId);
      const to = prev.findIndex((t) => t.id === targetId);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  const query = search.trim().toLowerCase();
  let visible = todos.filter(
    (t) =>
      (filter === "active" ? !t.done : filter === "done" ? t.done : true) &&
      (!query || t.text.toLowerCase().includes(query)),
  );
  if (sort === "priority") {
    visible = [...visible].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  } else if (sort === "due") {
    visible = [...visible].sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  }
  const canDrag = sort === "manual";

  const remaining = todos.filter((t) => !t.done).length;
  const doneCount = todos.length - remaining;
  const percent = todos.length ? Math.round((doneCount / todos.length) * 100) : 0;
  const overdue = todos.filter((t) => !t.done && t.due && todayIso && t.due < todayIso).length;
  const counts: Record<Filter, number> = { all: todos.length, active: remaining, done: doneCount };

  return (
    <main className={styles.main}>
      <section className={styles.card}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>My Todos</h1>
            <p className={styles.subtitle}>{today || " "}</p>
          </div>
          <div className={styles.themeSwitch} role="group" aria-label="Theme">
            {(["light", "dark", "system"] as Theme[]).map((t) => (
              <button
                key={t}
                className={`${styles.themeBtn} ${theme === t ? styles.themeBtnActive : ""}`}
                onClick={() => changeTheme(t)}
                aria-pressed={theme === t}
                title={t[0].toUpperCase() + t.slice(1)}
              >
                {t === "light" ? "☀" : t === "dark" ? "☾" : "Auto"}
              </button>
            ))}
          </div>
        </header>

        <div className={styles.progress}>
          <div className={styles.progressText}>
            <span>
              {allDone ? "All done — nice work! 🎉" : `${doneCount} of ${todos.length} completed`}
            </span>
            <span>{percent}%</span>
          </div>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={`${styles.progressBar} ${allDone ? styles.progressDone : ""}`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        <form className={styles.form} onSubmit={addTodo}>
          <input
            ref={inputRef}
            className={styles.input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What needs to be done?  (press / )"
            aria-label="New todo"
          />
          <div className={styles.formRow}>
            <div className={styles.prioritySelect} role="group" aria-label="Priority">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`${styles.priorityOpt} ${styles[p]} ${priority === p ? styles.priorityOptActive : ""}`}
                  onClick={() => setPriority(p)}
                  aria-pressed={priority === p}
                >
                  {p}
                </button>
              ))}
            </div>
            <input
              type="date"
              className={styles.dateInput}
              value={due}
              min={todayIso || undefined}
              onChange={(e) => setDue(e.target.value)}
              aria-label="Due date"
            />
            <button className={styles.addBtn} type="submit" disabled={!text.trim()}>
              Add
            </button>
          </div>
        </form>

        <div className={styles.toolbar}>
          <nav className={styles.filters} aria-label="Filter todos">
            {(["all", "active", "done"] as Filter[]).map((f) => (
              <button
                key={f}
                className={`${styles.filter} ${filter === f ? styles.filterActive : ""}`}
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
              >
                {f[0].toUpperCase() + f.slice(1)}
                <span className={styles.count}>{counts[f]}</span>
              </button>
            ))}
          </nav>
          <div className={styles.tools}>
            <input
              ref={searchRef}
              type="search"
              className={styles.search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search (f)"
              aria-label="Search todos"
            />
            <select
              className={styles.sort}
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              aria-label="Sort todos"
            >
              <option value="manual">My order</option>
              <option value="priority">Priority</option>
              <option value="due">Due date</option>
            </select>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon} aria-hidden>
              {todos.length === 0 ? "📝" : query ? "🔍" : "✨"}
            </div>
            {todos.length === 0
              ? "Nothing to do yet. Add your first task above."
              : query
                ? `No tasks match "${search.trim()}".`
                : "No tasks here."}
          </div>
        ) : (
          <ul className={styles.list}>
            {visible.map((t) => {
              const isOverdue = !t.done && !!t.due && !!todayIso && t.due < todayIso;
              return (
                <li
                  key={t.id}
                  className={[
                    styles.item,
                    dragId === t.id ? styles.dragging : "",
                    overId === t.id && dragId !== t.id ? styles.dragOver : "",
                  ].join(" ")}
                  draggable={canDrag && editingId !== t.id}
                  onDragStart={(e) => {
                    setDragId(t.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    setOverId(t.id);
                  }}
                  onDragLeave={() => setOverId((id) => (id === t.id ? null : id))}
                  onDrop={(e) => {
                    e.preventDefault();
                    drop(t.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverId(null);
                  }}
                >
                  {canDrag && (
                    <span className={styles.handle} aria-hidden title="Drag to reorder">
                      ⋮⋮
                    </span>
                  )}
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={t.done}
                      onChange={() => update(t.id, { done: !t.done })}
                      aria-label={`Mark "${t.text}" as ${t.done ? "not done" : "done"}`}
                    />
                    <span className={styles.checkMark} aria-hidden />
                  </label>

                  <div className={styles.body}>
                    {editingId === t.id ? (
                      <input
                        className={styles.editInput}
                        value={editText}
                        autoFocus
                        onChange={(e) => setEditText(e.target.value)}
                        onBlur={saveEdit}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit();
                          if (e.key === "Escape") cancelEdit();
                        }}
                        aria-label="Edit todo"
                      />
                    ) : (
                      <span
                        className={`${styles.text} ${t.done ? styles.done : ""}`}
                        onDoubleClick={() => startEdit(t)}
                        title="Double-click to edit"
                      >
                        {t.text}
                      </span>
                    )}
                    <div className={styles.meta}>
                      <button
                        className={`${styles.tag} ${styles[t.priority]}`}
                        onClick={() => cyclePriority(t)}
                        title="Click to change priority"
                      >
                        {t.priority}
                      </button>
                      {t.due && (
                        <span className={`${styles.due} ${isOverdue ? styles.overdue : ""}`}>
                          {isOverdue ? "Overdue · " : ""}
                          {dueLabel(t.due, todayIso)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className={styles.actions}>
                    <button
                      className={styles.iconBtn}
                      onClick={() => startEdit(t)}
                      aria-label={`Edit "${t.text}"`}
                      title="Edit"
                    >
                      ✎
                    </button>
                    <button
                      className={`${styles.iconBtn} ${styles.deleteBtn}`}
                      onClick={() => removeWhere((x) => x.id === t.id)}
                      aria-label={`Delete "${t.text}"`}
                      title="Delete"
                    >
                      ×
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <footer className={styles.footer}>
          <div className={styles.footerLeft}>
            <button className={styles.linkBtn} onClick={toggleAll} disabled={todos.length === 0}>
              {allDone ? "Mark all active" : "Mark all done"}
            </button>
            {overdue > 0 && <span className={styles.overdueNote}>{overdue} overdue</span>}
          </div>
          <button
            className={`${styles.linkBtn} ${styles.danger}`}
            onClick={() => removeWhere((t) => t.done)}
            disabled={doneCount === 0}
          >
            Clear completed
          </button>
        </footer>
      </section>

      <p className={styles.hint}>
        Double-click a task to edit · drag ⋮⋮ to reorder · click a priority tag to change it
      </p>

      {removed && (
        <div className={styles.toast} role="status">
          <span>
            {removed.length === 1 ? "Task deleted" : `${removed.length} tasks deleted`}
          </span>
          <button className={styles.undoBtn} onClick={undo}>
            Undo
          </button>
        </div>
      )}
    </main>
  );
}
