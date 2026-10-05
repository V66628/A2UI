import { createApp } from "./app";

const port = Number(process.env.PORT ?? 8787);

const server = createApp().listen(port, () => {
  console.log(`a2ui-server listening on http://localhost:${port}`);
  console.log(`  GET  /health`);
  console.log(`  POST /  (input → AG-UI over SSE → A2UI protocol stream)`);
});

// 优雅退出
const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
