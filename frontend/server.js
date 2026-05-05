const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3000;
const PUBLIC_DIR = __dirname;
const UPSTREAM_URL = "http://20.207.122.201/evaluation-service/notifications";

const fallbackNotifications = [
  { ID: "d146095a-0d86-4a34-9e69-3900a14576bc", Type: "Result", Message: "mid-sem", Timestamp: "2026-04-22 17:51:30" },
  { ID: "b283218f-ea5a-4b7c-93a9-1f2f240d64b0", Type: "Placement", Message: "CSX Corporation hiring", Timestamp: "2026-04-22 17:51:18" },
  { ID: "81589ada-0ad3-4f77-9554-f52fb558e004", Type: "Event", Message: "farewell", Timestamp: "2026-04-22 17:51:06" },
  { ID: "0005513a-142b-4bbc-8678-eefcc65e1ede", Type: "Result", Message: "mid-sem", Timestamp: "2026-04-22 17:50:54" },
  { ID: "ea836726-c25e-4f21-a72f-544a6af8a37f", Type: "Result", Message: "project-review", Timestamp: "2026-04-22 17:50:42" },
  { ID: "003cb427-8fc6-47f7-bb00-be228f6b0d2c", Type: "Result", Message: "external", Timestamp: "2026-04-22 17:50:30" },
  { ID: "e5c4ff20-31bf-4d40-8f02-72fda59e8918", Type: "Result", Message: "project-review", Timestamp: "2026-04-22 17:50:18" },
  { ID: "1cfcfe5e-ad37-4894-8946-d707627176a5", Type: "Event", Message: "tech-fest", Timestamp: "2026-04-22 17:50:06" },
  { ID: "cf2885a6-45ac-4ba0-b548-6e9e9d4c52c8", Type: "Result", Message: "project-review", Timestamp: "2026-04-22 17:49:54" },
  { ID: "8a7412bd-6065-4d09-8501-a37f11cc848b", Type: "Placement", Message: "Advanced Micro Devices Inc. hiring", Timestamp: "2026-04-22 17:49:42" },
  { ID: "7f10990e-ec41-49df-a037-5c4f33bb418d", Type: "Placement", Message: "Campus drive: Infosys eligibility list", Timestamp: "2026-04-22 17:49:30" },
  { ID: "c8381f07-7c5a-4916-8fa6-2fcf455e2d25", Type: "Event", Message: "coding contest registrations open", Timestamp: "2026-04-22 17:49:18" },
  { ID: "3ab292d8-62b0-4272-a8d0-93a477bd02fb", Type: "Result", Message: "internal assessment marks published", Timestamp: "2026-04-22 17:49:06" },
  { ID: "d8c1c112-f569-4bc8-bf5f-f0638f286674", Type: "Placement", Message: "TCS National Qualifier Test update", Timestamp: "2026-04-22 17:48:54" },
  { ID: "a76a4870-86ef-4d88-8776-7fcbf05b1738", Type: "Event", Message: "alumni meet auditorium schedule", Timestamp: "2026-04-22 17:48:42" },
  { ID: "b3a8834d-df49-4c40-9737-953a0b7a0d1c", Type: "Result", Message: "lab evaluation result available", Timestamp: "2026-04-22 17:48:30" },
  { ID: "a8bb1f9b-d71a-4df1-b553-a4a9af3a71cc", Type: "Placement", Message: "Deloitte pre-placement talk", Timestamp: "2026-04-22 17:48:18" },
  { ID: "c22744a6-2e1a-4430-aadf-d5e1a7a9a519", Type: "Event", Message: "sports day team announcements", Timestamp: "2026-04-22 17:48:06" }
];

class LoggingMiddleware {
  constructor() {
    this.events = [];
  }

  record(eventName, details = {}) {
    this.events.push({
      eventName,
      details,
      timestamp: new Date().toISOString()
    });
  }
}

const loggingMiddleware = new LoggingMiddleware();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function extractNotifications(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.notifications)) return payload.notifications;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

function filterAndPaginate(items, searchParams) {
  const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get("limit") || "10", 10)));
  const notificationType = searchParams.get("notification_type");
  const filtered = notificationType
    ? items.filter((item) => (item.Type || item.type || item.notification_type) === notificationType)
    : items;
  const start = (page - 1) * limit;

  return {
    notifications: filtered.slice(start, start + limit),
    pagination: {
      page,
      limit,
      total: filtered.length,
      total_pages: Math.max(1, Math.ceil(filtered.length / limit))
    }
  };
}

async function fetchUpstreamNotifications(request) {
  const headers = { Accept: "application/json" };
  const authorization = request.headers.authorization;

  if (authorization) {
    headers.Authorization = authorization;
  }

  const upstreamResponse = await fetch(UPSTREAM_URL, { headers });
  if (!upstreamResponse.ok) {
    throw new Error(`Upstream returned ${upstreamResponse.status}`);
  }

  const payload = await upstreamResponse.json();
  return extractNotifications(payload);
}

async function handleNotificationsApi(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  let source = "upstream";
  let notifications;

  try {
    notifications = await fetchUpstreamNotifications(request);
  } catch (error) {
    source = "fallback";
    notifications = fallbackNotifications;
    loggingMiddleware.record("notifications.upstream.unavailable", { message: error.message });
  }

  const payload = filterAndPaginate(notifications, requestUrl.searchParams);
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify({ ...payload, source }));
  loggingMiddleware.record("notifications.api.completed", {
    source,
    count: payload.notifications.length
  });
}

function resolveAssetPath(url) {
  const cleanUrl = url.split("?")[0];
  if (cleanUrl === "/" || cleanUrl === "/index.html") {
    return path.join(PUBLIC_DIR, "index.html");
  }

  return path.resolve(PUBLIC_DIR, `.${cleanUrl}`);
}

function handleRequest(request, response) {
  loggingMiddleware.record("http.request.received", {
    method: request.method,
    url: request.url
  });

  if (request.url.startsWith("/api/notifications")) {
    handleNotificationsApi(request, response);
    return;
  }

  const assetPath = resolveAssetPath(request.url);

  if (!assetPath.startsWith(path.resolve(PUBLIC_DIR))) {
    response.writeHead(403, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Forbidden" }));
    return;
  }

  fs.readFile(assetPath, (error, content) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>Not found</title><h1>Not found</h1>");
      loggingMiddleware.record("http.request.not_found", { url: request.url });
      return;
    }

    const extension = path.extname(assetPath);
    response.writeHead(200, {
      "Content-Type": contentTypes[extension] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(content);
    loggingMiddleware.record("http.request.completed", { url: request.url });
  });
}

function startServer(port = PORT) {
  return http.createServer(handleRequest).listen(port, "127.0.0.1", () => {
    loggingMiddleware.record("server.started", { port });
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  startServer,
  handleRequest,
  filterAndPaginate,
  extractNotifications
};
