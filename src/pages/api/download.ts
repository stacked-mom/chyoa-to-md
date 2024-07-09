import { LOG_PREFIX } from "~/consts";
import type { APIRoute } from "astro";
import { inspect, type RequestData } from "~/lib/api";

export const post: APIRoute = async ({ request }) => {
  const formData = await request.formData();
  const data = extractData(formData);
  if (!dataIsValid(data))
    return new Response("Must provide URL", { status: 400 });

  const stream = new ReadableStream({
    async start(controller) {
      function log(...args: any[]) {
        controller.enqueue(
          [Date.now().toString(), LOG_PREFIX, ...args, "\n"].join(" ")
        );
      }
      await inspect(data, log);
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};

function extractData(data: FormData): RequestData {
  const url = data.get("url") as string;
  const author = data.get("author") as string;
  const maxDepth = parseInt(data.get("max-depth") as string);
  const cookiesRaw = data.get("cookies") as string;
  const cookies = cookiesRaw
    ? cookiesRaw.split("\n").map((str) => {
        const split = str.split("=");
        return { key: split[0], value: split[1] };
      })
    : [];
  return { url, author, maxDepth, cookies };
}

function dataIsValid(data: RequestData) {
  const { url } = data;
  return !!url;
}
