import { readWikiGraph } from "@/view/readWikiGraph";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";

/** 启动后供 CLI 和测试使用的服务句柄。 */
export interface ViewServer {
  server: Server;
  url: string;
  close: () => Promise<void>;
}

/**
 * 将响应写为固定类型，避免浏览器缓存旧图或误判资源类型。
 *
 * @param response HTTP 响应对象。
 * @param statusCode HTTP 状态码。
 * @param contentType 资源 MIME 类型。
 * @param body 响应正文。
 */
function sendResponse(
  response: import("node:http").ServerResponse,
  statusCode: number,
  contentType: string,
  body: string | Buffer,
): void {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

/**
 * 启动只监听本机的 Wiki 查看服务。
 *
 * 启动前验证概念数据和静态资源；每次图数据请求重新读取 Wiki。
 *
 * @param wikiDirectory Wiki 根目录，默认当前工作目录下的 wiki。
 * @param clientScriptPath 已构建的浏览器脚本路径，测试可注入临时脚本。
 * @returns 服务地址和用于优雅关闭的函数。
 * @throws Wiki 不可用、脚本缺失或端口监听失败时抛出错误。
 */
export async function startViewServer(
  wikiDirectory = path.resolve(process.cwd(), "wiki"),
  clientScriptPath: URL | string = new URL("./client.js", import.meta.url),
): Promise<ViewServer> {
  await readWikiGraph(wikiDirectory);
  /** 页面和脚本在启动时加载一次，图数据则在每次 API 请求时重读。 */
  const [pageHtml, clientScript] = await Promise.all([
    readFile(new URL("./index.html", import.meta.url)),
    readFile(clientScriptPath),
  ]);
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (request.method !== "GET") {
      sendResponse(response, 405, "text/plain; charset=utf-8", "Method Not Allowed");
      return;
    }
    if (pathname === "/") {
      sendResponse(response, 200, "text/html; charset=utf-8", pageHtml);
      return;
    }
    if (pathname === "/client.js") {
      sendResponse(response, 200, "text/javascript; charset=utf-8", clientScript);
      return;
    }
    if (pathname === "/api/graph") {
      void readWikiGraph(wikiDirectory)
        .then((graph) => sendResponse(response, 200, "application/json; charset=utf-8", JSON.stringify(graph)))
        .catch((error: unknown) => sendResponse(
          response,
          500,
          "application/json; charset=utf-8",
          JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        ));
      return;
    }
    sendResponse(response, 404, "text/plain; charset=utf-8", "Not Found");
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    server.close();
    throw error;
  }

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("无法获取本地查看服务端口。");
  }

  return {
    server,
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
