# Campus Notification Frontend

React frontend for Stage 7.

## Run

```bash
npm start
```

The app serves on:

```text
http://localhost:3000
```

## API Authorization

The app calls the same-origin backend route:

```text
/api/notifications
```

That route proxies the evaluation API and supports `limit`, `page`, and `notification_type`. If the evaluation API returns `401` or is unavailable, the backend serves local campus notification data so the website remains fully usable.

If a token is provided for evaluation, set it in the browser before loading data:

```javascript
localStorage.setItem("notification_api_token", "<token>");
```

The app keeps read/unread state locally because the evaluation API only exposes notification fetching.
