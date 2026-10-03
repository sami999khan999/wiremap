"use client";
import { api } from "@/lib/api";

export function UserList() {
  const load = () => fetch("/api/users");
  const remove = (id: string) => fetch(`/api/users/${id}`, { method: "DELETE" });
  const health = () => api.get("/health");
  return <button onClick={() => void load().then(() => remove("1")).then(health)}>Load</button>;
}
