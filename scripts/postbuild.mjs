import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, "../dist");

const runtimeExports = [
  "fetch",
  "createClient",
  "getProfiles",
  "BROWSER_PROFILES",
  "Headers",
  "Response",
  "RequestError",
  "HTTPError",
  "TimeoutError",
  "AbortError",
  "WebSocket",
  "CloseEvent",
  "websocket",
  "WebSocketError",
];

const esmLines = [
  "import nodeWreq from './node-wreq.js';",
  "",
  ...runtimeExports.map((name) => `export const ${name} = nodeWreq.${name};`),
  "",
  "export default nodeWreq;",
  "",
];

const typeLines = [
  "export * from './node-wreq';",
  "import nodeWreq from './node-wreq';",
  "export default nodeWreq;",
  "",
];

await mkdir(distDir, { recursive: true });
await writeFile(resolve(distDir, "node-wreq.mjs"), esmLines.join("\n"), "utf8");
await writeFile(
  resolve(distDir, "node-wreq.d.mts"),
  typeLines.join("\n"),
  "utf8",
);
