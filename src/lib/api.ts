import fs from "fs";
import { OUT_PATH, AUTHOR, MAX_DEPTH } from "~/consts";
import { mkdir } from "shelljs"; // https://github.com/shelljs/shelljs
import { JSDOM, CookieJar } from "jsdom"; // https://github.com/jsdom/jsdom
import Turndown from "turndown"; // https://github.com/mixmark-io/turndown
import kebabcase from "lodash.kebabcase"; // https://github.com/lodash/lodash

let depth = 0;
let runName = Date.now().toString();
let storyName = "";
let storySlug = "";

type Cookie = { key: string; value: string };
export type RequestData = {
  url: string;
  author?: string;
  maxDepth?: number;
  cookies?: Cookie[];
};

/*
  - Looks at the given url
  - saves it to markdown file if valid
  - recurses into any links in the footer
*/
export async function inspect(
  data: RequestData,
  log: (...args: any[]) => void,
  rerun = false
) {
  if (!rerun) depth = 0;
  const { url, author = AUTHOR, maxDepth = MAX_DEPTH, cookies } = data;
  try {
    log(`Inspecting ${url}`);

    const dom = await getDOM(url, cookies);
    if (!dom) throw "Could not get DOM";

    const headerHtml = dom.querySelector(".chapter-header")?.innerHTML || "";
    if (!isByAuthor(headerHtml, author)) {
      log(`Skipping ${url} because it is not by ${author}`);
      return;
    }

    depth += 1;
    log(`Yes! written by ${author}`);
    const meta = getMeta(dom);
    const { title, slug, fileName } = meta;

    if (depth === 1) {
      runName = slug;
      storyName = title;
      storySlug = slug;
      mkdir("-p", `${OUT_PATH}/${runName}`);
      addStoryIndex(meta);
    }

    const rendered = getMarkdownString(meta);

    const fullPath = `${OUT_PATH}/${runName}/${fileName}.md`;
    writeFile(fullPath, rendered);
    log(`Saved to ${fullPath}\n`);
    const branches = getBranches(dom);

    if (branches.length === 0) {
      log(`No more branches`);
      return;
    }

    if (depth > maxDepth) {
      log(`Max depth reached`);
      return;
    }

    const promises = branches.map(
      async (branch) => await inspect({ ...data, url: branch }, log, true)
    );
    await Promise.all(promises);
  } catch (err: any) {
    log(`Failure for ${url}. Reason:`, err.toString());
    return;
  }
}

// Returns an array of branch urls included in the given document
function getBranches(document: Document) {
  const answers = document.querySelectorAll(
    ".question-content a"
  ) as NodeListOf<HTMLAnchorElement>;
  const urls = Array.from(answers).map((a) => a.href);
  const filtered = urls.filter(
    (url) => url.includes("chapter") && !url.includes("/new")
  );
  return filtered;
}

// Returns true if the given document is by the given author
function isByAuthor(html: string, author: string) {
  const regex = new RegExp(author, "i");
  return regex.test(html);
}

// Returns the DOM for the given url
async function getDOM(url: string, cookies: Cookie[] = []) {
  const cookieJar = new CookieJar();
  cookies.forEach(({ key, value }) => {
    cookieJar.setCookie(`${key}=${value}`, url);
  });

  const dom = await JSDOM.fromURL(url, { cookieJar });
  const { document } = dom.window;
  return document;
}

// Returns the meta data for the given document
type MetaObj = {
  title: string;
  description: string | null;
  slug: string;
  pubDate: string | null;
  updatedDate: string | null;
  tag: string | null;
  content: string;
  fileName: string;
};
function getMeta(document: Document): MetaObj {
  const header = document.querySelector(".chapter-header");
  const body = document.querySelector(".chapter-content");
  if (!header || !body) throw new Error(`Could not find story header or body`);
  const title =
    header.querySelector("h1")?.textContent?.trim() || `Untitled ${Date.now()}`;
  const slug = kebabcase(title);
  const chapter = header.innerHTML.match(/chapter (\d+)/i)?.[1] || null;
  const fileName = `${chapter ? `ch-${chapter}-` : ""}${slug}`;
  const content = body?.innerHTML || "";

  function getMetaTag(name: string) {
    return (
      document
        .querySelector(`meta[property='${name}']`)
        ?.getAttribute("content") || null
    );
  }

  const description = getMetaTag("og:description");
  const pubDate = getMetaTag("article:published_time");
  const updatedDate = getMetaTag("article:modified_time");
  const tag = getMetaTag("article:tag");

  return {
    title,
    description,
    slug,
    pubDate,
    updatedDate,
    tag,
    content,
    fileName,
  };
}

type FmField = [string, string | null | undefined];
function addFields(fields: FmField[]) {
  return fields.reduce((acc, [key, value]) => {
    if (!value) return acc;
    return `${acc}${key}: "${value.replaceAll('"', "'")}"\n`;
  }, "");
}

function getFrontMatter(fields: FmField[]) {
  return `---\n${addFields(fields)}---\n\n`;
}

// Returns rendered markdown content + frontmatter for the given meta data
function getMarkdownString({
  title,
  pubDate,
  updatedDate,
  tag,
  content,
}: MetaObj): string {
  const td = new Turndown();
  const markdown = td.turndown(content);
  const frontmatter = getFrontMatter([
    ["title", title],
    ["pubDate", pubDate],
    ["updatedDate", updatedDate],
    ["tags", tag],
  ]);
  return `${frontmatter}${markdown}`;
}

// Adds the index.md file (one per story)
function addStoryIndex({ description }: MetaObj) {
  const frontMatter = getFrontMatter([
    ["title", storyName],
    ["description", description],
  ]);

  writeFile(`${OUT_PATH}/${runName}/index.md`, frontMatter);
}

// Writes the given content to the given file path
function writeFile(path: string, content: string) {
  return new Promise<void>((resolve, reject) => {
    fs.writeFile(path, content, (err) => {
      if (err) reject(err);
      resolve();
    });
  });
}
