import { createServer } from "node:http";

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    return;
  }
  if (request.method !== "POST" || request.url !== "/chat/completions") {
    response.writeHead(404).end();
    return;
  }
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk: string) => {
    body += chunk;
    if (body.length > 1_000_000) request.destroy();
  });
  request.on("end", () => {
    let numQuestions = 1;
    try {
      const payload = JSON.parse(body) as { messages?: Array<{ content?: string }> };
      const match = payload.messages?.[0]?.content?.match(/exactamente (\d+) preguntas/);
      if (match) numQuestions = Math.min(100, Number(match[1]));
    } catch {
      response.writeHead(400).end();
      return;
    }
    const answers = Array.from({ length: numQuestions }, (_, index) => ({ q: index + 1, answer: "A", confidence: 0.99 }));
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ answers }) } }] }));
  });
});

server.listen(3110, "127.0.0.1", () => console.log("DeepSeek test stub listening on 127.0.0.1:3110"));
