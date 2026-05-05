const API_URL = "http://20.207.122.201/evaluation-service/notifications";
const PRIORITY_WEIGHT = { Placement: 3, Result: 2, Event: 1 };

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

class MinHeap {
  constructor(compare) {
    this.items = [];
    this.compare = compare;
  }

  size() {
    return this.items.length;
  }

  peek() {
    return this.items[0];
  }

  push(item) {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  replaceTop(item) {
    this.items[0] = item;
    this.bubbleDown(0);
  }

  toSortedArray() {
    return [...this.items].sort((a, b) => this.compare(b, a));
  }

  bubbleUp(index) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.items[index], this.items[parent]) >= 0) break;
      [this.items[index], this.items[parent]] = [this.items[parent], this.items[index]];
      index = parent;
    }
  }

  bubbleDown(index) {
    while (true) {
      const left = index * 2 + 1;
      const right = index * 2 + 2;
      let smallest = index;

      if (left < this.items.length && this.compare(this.items[left], this.items[smallest]) < 0) {
        smallest = left;
      }

      if (right < this.items.length && this.compare(this.items[right], this.items[smallest]) < 0) {
        smallest = right;
      }

      if (smallest === index) break;
      [this.items[index], this.items[smallest]] = [this.items[smallest], this.items[index]];
      index = smallest;
    }
  }
}

function getNotificationType(notification) {
  return notification.notification_type || notification.type || notification.Type || notification.category || "Event";
}

function getCreatedAtMs(notification) {
  const rawDate = notification.created_at || notification.createdAt || notification.Timestamp || notification.timestamp || notification.date;
  const parsed = Date.parse(rawDate);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function comparePriority(a, b) {
  const typeDiff =
    (PRIORITY_WEIGHT[getNotificationType(a)] || 0) -
    (PRIORITY_WEIGHT[getNotificationType(b)] || 0);

  if (typeDiff !== 0) return typeDiff;
  return getCreatedAtMs(a) - getCreatedAtMs(b);
}

function extractNotifications(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.notifications)) return payload.notifications;
  return [];
}

async function fetchNotifications(loggingMiddleware) {
  loggingMiddleware.record("stage6.fetch.started", { apiUrl: API_URL });

  const headers = { Accept: "application/json" };
  if (process.env.NOTIFICATION_API_TOKEN) {
    headers.Authorization = `Bearer ${process.env.NOTIFICATION_API_TOKEN}`;
  }

  const response = await fetch(API_URL, {
    headers
  });

  if (!response.ok) {
    throw new Error(`Notification API failed with status ${response.status}`);
  }

  const payload = await response.json();
  const notifications = extractNotifications(payload);
  loggingMiddleware.record("stage6.fetch.completed", { count: notifications.length });
  return notifications;
}

function topNotifications(notifications, limit = 10) {
  const heap = new MinHeap(comparePriority);

  for (const notification of notifications) {
    if (heap.size() < limit) {
      heap.push(notification);
      continue;
    }

    if (comparePriority(notification, heap.peek()) > 0) {
      heap.replaceTop(notification);
    }
  }

  return heap.toSortedArray();
}

async function main() {
  const loggingMiddleware = new LoggingMiddleware();

  try {
    const notifications = await fetchNotifications(loggingMiddleware);
    const topTen = topNotifications(notifications, 10);
    process.stdout.write(`${JSON.stringify(topTen, null, 2)}\n`);
  } catch (error) {
    loggingMiddleware.record("stage6.failed", { message: error.message });
    process.stderr.write(`${JSON.stringify({ error: error.message }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  LoggingMiddleware,
  MinHeap,
  topNotifications,
  comparePriority,
  extractNotifications
};
