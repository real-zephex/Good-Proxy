
# GoodProxy

GoodProxy is a lightweight proxy server built with Hono that facilitates fetching and transforming resources from remote servers. It handles various types of content including VTT files, HLS streams, and more, while providing enhanced CORS support and URL transformation capabilities.

## Features

- **CORS Support**: Allows cross-origin requests with customizable headers.
- **Content Handling**: Supports fetching and transforming VTT files, HLS streams, and more.
- **Dynamic URL Replacement**: Automatically updates URLs in fetched content to proxy paths.

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

- **GET /**: Returns a simple "Hello Hono!" message.
- **GET /fetch**: Proxy endpoint that fetches content from a remote server based on the `url` query parameter. Additonally, you can also pass referers using `ref` parameter.

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

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request to contribute to GoodProxy.

## Contact

For any questions or feedback, please contact [your-email@example.com](mailto:your-email@example.com).
