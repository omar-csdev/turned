import { createFileRoute } from "@tanstack/react-router";
import TurnedApp from "~/turned/TurnedApp";

export const Route = createFileRoute("/play")({
  component: TurnedApp,
  head: () => ({ meta: [{ title: "Turned — Survive together" }, { name: "description", content: "An original cooperative browser survival game. Explore Pinefall Island, gather, craft, drive, and fight the infected with friends." }] }),
});
