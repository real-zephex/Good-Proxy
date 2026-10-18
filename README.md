
# GoodProxy

GoodProxy is a lightweight proxy server built with Hono that facilitates fetching and transforming resources from remote servers. It handles various types of content including VTT files, HLS streams, and more, while providing enhanced CORS support and URL transformation capabilities.

## Features

- **CORS Support**: Allows cross-origin requests with customizable headers.
- **Content Handling**: Rewrites HTML, CSS, WebVTT, HLS playlists (and HLS tag `URI="..."` attributes) so links, assets and streams keep flowing through the proxy.
- **Dynamic URL Replacement**: Automatically updates URLs in fetched content to proxy paths.
- **Streaming & Range Requests**: Bodies are streamed rather than buffered, and `Range`/`Content-Range`/`Accept-Ranges` are passed through, so media seeking works.
- **Per-site isolation**: `/p/<host>/fetch` scopes the origin's cookies to that prefix, so sites proxied side by side do not share a session.
- **Working logins**: Cookies (`Set-Cookie`, re-pathed and `Domain`-stripped), redirects (`Location` rewritten), request bodies and `Origin`/`Referer` are forwarded, so POST logins and cookie-authenticated requests work.
- **WebSocket passthrough**: `Upgrade: websocket` requests are tunnelled to the origin.
- **Runtime shim**: Proxied HTML documents get a small script that re-routes runtime URLs (`fetch`, `XMLHttpRequest`, `Worker`, `EventSource`, `WebSocket`, element `src`/`setAttribute`, `history`).
- **Edge caching**: Static, cookie-less assets (CSS, JS, images, fonts) are cached with the Cache API, honouring upstream `Cache-Control`.

## Installation

To get started with GoodProxy, follow these steps:

1. **Clone the Repository**:

    ```bash
    git clone https://github.com/real-zephex/Good-Proxy.git
    cd goodproxy
    ```

2. **Install Dependencies**:

    ```bash
    bun install
    ```

3. **Start the Server**:

    ```bash
    bun run dev
    ```

    The server will be available at `http://localhost:8787`.

### Deploy on Cloudflare's Workers

1. **Clone the Repository**:

    ```bash
    git clone https://github.com/real-zephex/Good-Proxy.git
    cd goodproxy
    ```

2. **Install Dependencies**:

    ```bash
    bun install
    ```

3. **Deploy the Worker**:

    ```bash
    bun run deploy
    ```

    Your default browser will open, log in your Cloudflare account and click authorize and your worker will be deployed. 
    You can then add your custom domain and view insights.

## Usage

### Endpoints

- **GET /**: The gateway page — paste a URL and browse it through the proxy.
- **GET /go?url=**: Redirects to the correct per-site proxy URL (used by the gateway form).
- **GET|POST|PUT|DELETE|OPTIONS /fetch?url=**: Proxy endpoint that fetches content from a remote server based on the `url` query parameter. Additionally, you can also pass referers using the `ref` parameter. Every method is forwarded, along with the request body.
- **GET|POST|PUT|DELETE|OPTIONS /p/&lt;host&gt;/fetch?url=**: Same as `/fetch`, but scopes the origin's cookies to `/p/<host>/`. Prefer this form; the gateway page and the browser extension use it automatically.

Any http(s) URL can be proxied; with `Upgrade: websocket` the `url` may also be `ws:`/`wss:`.

### Example Request

To fetch and transform content from a remote URL, you can make a request to `/fetch` with a `url` parameter:

```bash
curl "http://localhost:8787/fetch?url=https://example.com/resource?ref=https://some-referer.com"
```
Example:

```ts

const m3u8url = "https://vz-cea98c59-23c.b-cdn.net/c309129c-27b6-4e43-8254-62a15c77c5ee/842x480/video.m3u8";
const proxyUrl = "https://goodproxy.goodproxy.workers.dev";

const proxiedUrl = `${proxyUrl}/fetch?url=${m3u8url}`; // both encoded and non encoded urls will work
// https://goodproxy.goodproxy.workers.dev/fetch?url=https%3A%2F%2Fvz-cea98c59-23c.b-cdn.net%2Fc309129c-27b6-4e43-8254-62a15c77c5ee%2F842x480%2Fvideo.m3u8
// https://goodproxy.goodproxy.workers.dev/fetch?url=https://vz-cea98c59-23c.b-cdn.net/c309129c-27b6-4e43-8254-62a15c77c5ee/842x480/video.m3u8
```

### CORS Headers

GoodProxy includes the following CORS headers by default:

- `Access-Control-Allow-Origin`: `*`
- `Access-Control-Allow-Methods`: `GET, POST, PUT, DELETE, OPTIONS`
- `Access-Control-Allow-Headers`: `Content-Type, Authorization`
- `Access-Control-Max-Age`: `3600`

These can be modified as needed in the `request.ts` file.

## Development

For development, you can use the following commands:

- **Run in Development Mode**:

    ```bash
    bun run dev
    ```

- **Typecheck**:

    ```bash
    bun run typecheck
    ```

- **Run the tests** (`vitest` running inside workerd):

    ```bash
    bun run test
    ```

### Configuration

Optional Worker vars (see `wrangler.toml`):

- `PROXY_URL`: public URL of this deployment, shown on the gateway page. Falls back to the request origin.
- `DEBUG`: set to `"true"` to enable request logging.

### Browser extension

A minimal Chrome/Edge (MV3) extension lives in [`extension/`](extension/README.md); it routes every top-level navigation through a GoodProxy instance.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request to contribute to GoodProxy.

## Contact

For any questions or feedback, please contact [your-email@example.com](mailto:your-email@example.com).
