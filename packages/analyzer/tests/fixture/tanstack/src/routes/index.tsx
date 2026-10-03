import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => <p>Home</p>,
  loader: () => fetch("/api/users").then((response) => response.json()),
});
