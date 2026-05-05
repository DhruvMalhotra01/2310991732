(function initializeCampusNotificationApp() {
  const { useEffect, useMemo, useState } = React;
  const API_URL = "/api/notifications";
  const PAGE_SIZE = 10;
  const PRIORITY_WEIGHT = { Placement: 3, Result: 2, Event: 1 };
  const TYPE_DETAILS = {
    Placement: { icon: "P", label: "Placement", className: "placement" },
    Result: { icon: "R", label: "Result", className: "result" },
    Event: { icon: "E", label: "Event", className: "event" }
  };

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

  class ApiClient {
    constructor(loggingMiddleware) {
      this.loggingMiddleware = loggingMiddleware;
    }

    async fetchNotifications({ page, limit, notificationType }) {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit)
      });

      if (notificationType !== "All") {
        params.set("notification_type", notificationType);
      }

      const url = `${API_URL}?${params.toString()}`;
      const headers = {
        Accept: "application/json",
        "X-Request-Id": crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        "X-User-Id": "1042",
        "X-User-Role": "student"
      };
      const token = window.localStorage.getItem("notification_api_token");

      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      this.loggingMiddleware.record("notifications.fetch.started", { page, limit, notificationType });

      const response = await fetch(url, {
        headers
      });

      if (!response.ok) {
        throw new Error(`Notification API returned ${response.status}`);
      }

      const payload = await response.json();
      const notifications = normalizeNotifications(payload);
      this.loggingMiddleware.record("notifications.fetch.completed", { count: notifications.length });

      return {
        notifications,
        total: getTotalCount(payload, notifications.length),
        source: payload.source || "upstream"
      };
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

  const loggingMiddleware = new LoggingMiddleware();
  const apiClient = new ApiClient(loggingMiddleware);

  function normalizeNotifications(payload) {
    const rawItems = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.data)
        ? payload.data
        : Array.isArray(payload.notifications)
          ? payload.notifications
          : [];

    return rawItems.map((item, index) => {
      const type = item.notification_type || item.type || item.Type || item.category || "Event";
      const createdAt = item.created_at || item.createdAt || item.Timestamp || item.timestamp || item.date || new Date().toISOString();
      const message = item.body || item.message || item.Message || item.description || "Notification details are available.";

      return {
        id: String(item.id || item.ID || item.notification_id || `${type}-${index}-${createdAt}`),
        notification_type: type,
        title: item.title || item.subject || message,
        body: message,
        created_at: createdAt,
        is_read: Boolean(item.is_read || item.isRead || false)
      };
    });
  }

  function getTotalCount(payload, fallbackCount) {
    if (typeof payload.total === "number") return payload.total;
    if (payload.pagination && typeof payload.pagination.total === "number") return payload.pagination.total;
    if (payload.meta && typeof payload.meta.total === "number") return payload.meta.total;
    return fallbackCount;
  }

  function comparePriority(a, b) {
    const typeDiff =
      (PRIORITY_WEIGHT[a.notification_type] || 0) -
      (PRIORITY_WEIGHT[b.notification_type] || 0);

    if (typeDiff !== 0) return typeDiff;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  }

  function getTopPriorityNotifications(notifications, limit) {
    const heap = new MinHeap(comparePriority);

    notifications.forEach((notification) => {
      if (heap.size() < limit) {
        heap.push(notification);
        return;
      }

      if (comparePriority(notification, heap.peek()) > 0) {
        heap.replaceTop(notification);
      }
    });

    return heap.toSortedArray();
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  }

  function formatFullDate(value) {
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  }

  function StatCard({ label, value, tone }) {
    return React.createElement(
      "div",
      { className: `stat-card stat-card--${tone}` },
      React.createElement("span", null, label),
      React.createElement("strong", null, value)
    );
  }

  function TypeMark({ type }) {
    const details = TYPE_DETAILS[type] || TYPE_DETAILS.Event;

    return React.createElement(
      "span",
      { className: `type-mark type-mark--${details.className}`, "aria-hidden": "true" },
      details.icon
    );
  }

  function NotificationCard({ notification, onToggleRead }) {
    const details = TYPE_DETAILS[notification.notification_type] || TYPE_DETAILS.Event;

    return React.createElement(
      "article",
      { className: `notification-card ${notification.is_read ? "is-read" : "is-unread"}` },
      React.createElement(TypeMark, { type: notification.notification_type }),
      React.createElement(
        "div",
        { className: "notification-card__main" },
        React.createElement(
          "div",
          { className: "notification-card__meta" },
          React.createElement("span", { className: `type-badge type-${details.className}` }, details.label),
          React.createElement("span", { className: notification.is_read ? "read-dot" : "read-dot is-active" }),
          React.createElement("time", null, formatFullDate(notification.created_at))
        ),
        React.createElement("h3", null, notification.title),
        React.createElement("p", null, notification.body),
        React.createElement("span", { className: "notification-id" }, `ID ${notification.id.slice(0, 8)}`)
      ),
      React.createElement(
        "button",
        {
          className: "icon-button",
          title: notification.is_read ? "Mark unread" : "Mark read",
          "aria-label": notification.is_read ? "Mark unread" : "Mark read",
          onClick: () => onToggleRead(notification.id)
        },
        notification.is_read ? "Unread" : "Read"
      )
    );
  }

  function App() {
    const [notifications, setNotifications] = useState([]);
    const [page, setPage] = useState(1);
    const [filter, setFilter] = useState("All");
    const [searchTerm, setSearchTerm] = useState("");
    const [total, setTotal] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const [source, setSource] = useState("upstream");
    const [refreshKey, setRefreshKey] = useState(0);
    const [readIds, setReadIds] = useState(() => {
      try {
        return new Set(JSON.parse(window.localStorage.getItem("read_notification_ids") || "[]"));
      } catch (error) {
        loggingMiddleware.record("read_state.restore.failed", { message: error.message });
        return new Set();
      }
    });

    useEffect(() => {
      let isCurrent = true;
      setIsLoading(true);
      setError("");

      apiClient
        .fetchNotifications({ page, limit: PAGE_SIZE, notificationType: filter })
        .then((result) => {
          if (!isCurrent) return;
          setNotifications(
            result.notifications.map((notification) => ({
              ...notification,
              is_read: readIds.has(notification.id) || notification.is_read
            }))
          );
          setTotal(result.total);
          setSource(result.source);
        })
        .catch((fetchError) => {
          if (!isCurrent) return;
          loggingMiddleware.record("notifications.fetch.failed", { message: fetchError.message });
          setError("Notifications could not be loaded. Please try again.");
          setNotifications([]);
          setTotal(0);
        })
        .finally(() => {
          if (isCurrent) setIsLoading(false);
        });

      return () => {
        isCurrent = false;
      };
    }, [page, filter, refreshKey]);

    const priorityNotifications = useMemo(() => getTopPriorityNotifications(notifications, 10), [notifications]);
    const visibleNotifications = useMemo(() => {
      const normalizedSearch = searchTerm.trim().toLowerCase();
      if (!normalizedSearch) return notifications;

      return notifications.filter((notification) =>
        `${notification.title} ${notification.body} ${notification.notification_type}`
          .toLowerCase()
          .includes(normalizedSearch)
      );
    }, [notifications, searchTerm]);
    const typeCounts = useMemo(
      () =>
        notifications.reduce(
          (counts, notification) => ({
            ...counts,
            [notification.notification_type]: (counts[notification.notification_type] || 0) + 1
          }),
          { Placement: 0, Result: 0, Event: 0 }
        ),
      [notifications]
    );
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const unreadCount = notifications.filter((item) => !item.is_read).length;

    function handleFilterChange(nextFilter) {
      setFilter(nextFilter);
      setPage(1);
    }

    function handleToggleRead(id) {
      const nextReadIds = new Set(readIds);
      if (nextReadIds.has(id)) {
        nextReadIds.delete(id);
      } else {
        nextReadIds.add(id);
      }

      setReadIds(nextReadIds);
      window.localStorage.setItem("read_notification_ids", JSON.stringify([...nextReadIds]));
      setNotifications((current) =>
        current.map((notification) =>
          notification.id === id ? { ...notification, is_read: !notification.is_read } : notification
        )
      );
      loggingMiddleware.record("notification.read_state.toggled", { id });
    }

    return React.createElement(
      "main",
      { className: "app-shell" },
      React.createElement(
        "nav",
        { className: "app-nav" },
        React.createElement(
          "div",
          { className: "brand-lockup" },
          React.createElement("span", { className: "brand-mark" }, "CN"),
          React.createElement(
            "div",
            null,
            React.createElement("strong", null, "CampusNotify"),
            React.createElement("span", null, "Student portal")
          )
        ),
        React.createElement(
          "div",
          { className: "nav-status" },
          React.createElement("span", { className: source === "fallback" ? "status-pill status-pill--demo" : "status-pill status-pill--live" }, source === "fallback" ? "Demo data" : "Live data"),
          React.createElement("span", null, "localhost:3000")
        )
      ),
      React.createElement(
        "header",
        { className: "hero-panel" },
        React.createElement(
          "div",
          null,
          React.createElement("p", { className: "eyebrow" }, "Campus Notification Platform"),
          React.createElement("h1", null, "Student Notifications"),
          React.createElement("p", { className: "subhead" }, "Placement, result, and event updates in one reliable dashboard.")
        ),
        React.createElement(
          "div",
          { className: "hero-card" },
          React.createElement("span", null, "Unread"),
          React.createElement("strong", null, unreadCount),
          React.createElement("small", null, `${notifications.length} visible on this page`)
        )
      ),
      React.createElement(
        "section",
        { className: "stats-grid", "aria-label": "Notification summary" },
        React.createElement(StatCard, { label: "All shown", value: notifications.length, tone: "all" }),
        React.createElement(StatCard, { label: "Unread", value: unreadCount, tone: "unread" }),
        React.createElement(StatCard, { label: "Placements", value: typeCounts.Placement || 0, tone: "placement" }),
        React.createElement(StatCard, { label: "Results", value: typeCounts.Result || 0, tone: "result" })
      ),
      React.createElement(
        "section",
        { className: "control-panel" },
        React.createElement(
          "div",
          { className: "toolbar", "aria-label": "Notification filters" },
          ["All", "Placement", "Result", "Event"].map((type) =>
            React.createElement(
              "button",
              {
                key: type,
                className: filter === type ? "segmented-button active" : "segmented-button",
                onClick: () => handleFilterChange(type)
              },
              type
            )
          )
        ),
        React.createElement(
          "div",
          { className: "control-actions" },
          React.createElement("input", {
            className: "search-input",
            type: "search",
            value: searchTerm,
            placeholder: "Search current page",
            onChange: (event) => setSearchTerm(event.target.value)
          }),
          React.createElement(
            "button",
            {
              className: "refresh-button",
              disabled: isLoading,
              onClick: () => setRefreshKey((current) => current + 1)
            },
            isLoading ? "Refreshing" : "Refresh"
          )
        )
      ),
      error ? React.createElement("div", { className: "error-banner", role: "alert" }, error) : null,
      React.createElement(
        "section",
        { className: "content-grid" },
        React.createElement(
          "div",
          { className: "panel" },
          React.createElement(
            "div",
            { className: "panel-heading" },
            React.createElement("h2", null, "All Notifications"),
            React.createElement("span", null, `${visibleNotifications.length} items`)
          ),
          isLoading
            ? React.createElement("div", { className: "empty-state" }, "Loading notifications...")
            : visibleNotifications.length === 0
              ? React.createElement("div", { className: "empty-state" }, "No notifications found.")
              : React.createElement(
                  "div",
                  { className: "notification-list" },
                  visibleNotifications.map((notification) =>
                    React.createElement(NotificationCard, {
                      key: notification.id,
                      notification,
                      onToggleRead: handleToggleRead
                    })
                  )
                ),
          React.createElement(
            "div",
            { className: "pagination" },
            React.createElement(
              "button",
              { disabled: page <= 1 || isLoading, onClick: () => setPage((current) => Math.max(1, current - 1)) },
              "Previous"
            ),
            React.createElement("span", null, `${page} / ${totalPages}`),
            React.createElement(
              "button",
              { disabled: isLoading || page >= totalPages, onClick: () => setPage((current) => current + 1) },
              "Next"
            )
          )
        ),
        React.createElement(
          "aside",
          { className: "panel priority-panel" },
          React.createElement(
            "div",
            { className: "panel-heading" },
            React.createElement("h2", null, "Priority Notifications"),
            React.createElement("span", null, "Top 10")
          ),
          React.createElement(
            "div",
            { className: "priority-note" },
            React.createElement("strong", null, "Ranking"),
            React.createElement("span", null, "Placement first, then Result, then Event. Newer items win ties.")
          ),
          priorityNotifications.length === 0
            ? React.createElement("div", { className: "empty-state" }, "Priority notifications will appear here.")
            : React.createElement(
                "div",
                { className: "priority-list" },
                priorityNotifications.map((notification, index) =>
                  React.createElement(
                    "div",
                    { className: "priority-item", key: notification.id },
                    React.createElement("span", { className: "rank" }, String(index + 1).padStart(2, "0")),
                    React.createElement(TypeMark, { type: notification.notification_type }),
                    React.createElement(
                      "div",
                      null,
                      React.createElement("strong", null, notification.title),
                      React.createElement("p", null, `${notification.notification_type} | ${formatDate(notification.created_at)}`)
                    )
                  )
                )
              )
        )
      )
    );
  }

  ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));
})();
