import path from "node:path";
import http from "node:http";
import https from "node:https";
import { fileURLToPath } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig, loadEnv, type Plugin } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";

const websiteRoot = path.dirname(fileURLToPath(import.meta.url));
const packagesRoot = path.resolve(websiteRoot, "..");
const gameClientSrc = path.join(packagesRoot, "game-client", "src");
const gameSharedSrc = path.join(packagesRoot, "game-shared", "src");

/** Run before Nitro reads request bodies; Vite's later proxy otherwise receives an exhausted stream. */
function turnedApiProxy(): Plugin {
  return {
    name: "turned-api-proxy",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith("/turned-api/")) return next();
        const target = new URL(request.url, process.env.TURNED_SERVER_URL || "http://127.0.0.1:3003");
        const transport = target.protocol === "https:" ? https : http;
        const unavailable = () => {
          if (response.destroyed || response.writableEnded) return;
          if (response.headersSent) { response.destroy(); return; }
          response.writeHead(502, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "The island server is unavailable. Start the game server and try again." }));
        };
        const upstream = transport.request(target, {
          method: request.method,
          headers: { ...request.headers, host: target.host },
          timeout: 10_000,
        }, incoming => {
          incoming.on("error", unavailable);
          response.writeHead(incoming.statusCode || 502, incoming.headers);
          incoming.pipe(response);
        });
        upstream.on("timeout", () => upstream.destroy(new Error("Game server timed out")));
        upstream.on("error", unavailable);
        request.on("aborted", () => upstream.destroy());
        response.on("close", () => { if (!response.writableEnded) upstream.destroy(); });
        request.pipe(upstream);
      });
    },
  };
}

/** Workspace sources live outside the website root; register them so edits trigger HMR. */
function watchWorkspacePackages(): Plugin {
  return {
    name: "watch-workspace-packages",
    configureServer(server) {
      server.watcher.add(gameClientSrc);
      server.watcher.add(gameSharedSrc);
    },
  };
}

// Ensure `.env` values (e.g. GAME_SERVER_API_KEY) are on process.env for server functions / Nitro.
// Without this, getGameAuthToken can see an unset key even when packages/website/.env defines it.
function mergeEnvIntoProcessEnv(mode: string): void {
  const loaded = loadEnv(mode, websiteRoot, "");
  for (const [key, value] of Object.entries(loaded)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

// @ts-ignore - nitro plugin has type issues with the monorepo vite versions
export default defineConfig(({ mode }) => {
  mergeEnvIntoProcessEnv(mode);

  return {
    server: {
      port: 3000,
      proxy: {
        "/turned-socket": { target: process.env.TURNED_SERVER_URL || "http://127.0.0.1:3003", ws: true, changeOrigin: true },
      },
      fs: {
        allow: [websiteRoot, packagesRoot],
      },
    },
    optimizeDeps: {
      exclude: [
        "@survive-the-night/game-client",
        "@survive-the-night/game-shared",
      ],
    },
    plugins: [
      turnedApiProxy(),
      watchWorkspacePackages(),
      tsConfigPaths({ projects: [".", "../game-shared", "../game-client"] }),
      tailwindcss(),
      tanstackStart(),
      nitro(),
      viteReact(),
    ],
    nitro: {},
    envDir: websiteRoot,
  };
});
