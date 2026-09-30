"use client";

import { useEffect, useState } from "react";
import styles from "./page.module.css";

type Todo = { id: string; text: string; done: boolean };
type Filter = "all" | "active" | "done";

const STORAGE_KEY = "todos";

export default function Home() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [text, setText] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loaded, setLoaded] = useState(false);
  const [today, setToday] = useState("");

  // Load from localStorage after mount to avoid hydration mismatch
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setTodos(JSON.parse(saved));
    } catch {}
    setToday(
      new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }),
    );
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
    } catch {}
  }, [todos, loaded]);

  function addTodo(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setTodos((prev) => [{ id: crypto.randomUUID(), text: value, done: false }, ...prev]);
    setText("");
  }

  const toggle = (id: string) =>
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));

  const remove = (id: string) => setTodos((prev) => prev.filter((t) => t.id !== id));

  const clearDone = () => setTodos((prev) => prev.filter((t) => !t.done));

  const visible = todos.filter((t) =>
    filter === "active" ? !t.done : filter === "done" ? t.done : true,
  );
  const remaining = todos.filter((t) => !t.done).length;
  const doneCount = todos.length - remaining;

  return (
    <main className={styles.main}>
      <section className={styles.card}>
        <header className={styles.header}>
          <h1 className={styles.title}>My Todos</h1>
          <p className={styles.subtitle}>{today || "\u00a0"}</p>
        </header>

        <form className={styles.form} onSubmit={addTodo}>
          <input
            className={styles.input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What needs to be done?"
            aria-label="New todo"
          />
          <button className={styles.addBtn} type="submit" disabled={!text.trim()}>
            Add
          </button>
        </form>

        <nav className={styles.filters} aria-label="Filter todos">
          {(["all", "active", "done"] as Filter[]).map((f) => (
            <button
              key={f}
              className={`${styles.filter} ${filter === f ? styles.filterActive : ""}`}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
            >
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </nav>

        {visible.length === 0 ? (
          <p className={styles.empty}>
            {todos.length === 0 ? "Nothing to do yet. Add your first task above." : "No tasks here."}
          </p>
        ) : (
          <ul className={styles.list}>
            {visible.map((t) => (
              <li key={t.id} className={styles.item}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={t.done}
                  onChange={() => toggle(t.id)}
                  aria-label={`Mark "${t.text}" as ${t.done ? "not done" : "done"}`}
                />
                <span className={`${styles.text} ${t.done ? styles.done : ""}`}>{t.text}</span>
                <button
                  className={styles.delete}
                  onClick={() => remove(t.id)}
                  aria-label={`Delete "${t.text}"`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <footer className={styles.footer}>
          <span>
            {remaining} {remaining === 1 ? "task" : "tasks"} left
          </span>
          <button className={styles.clear} onClick={clearDone} disabled={doneCount === 0}>
            Clear completed
          </button>
        </footer>
      </section>
    </main>
  );
}
