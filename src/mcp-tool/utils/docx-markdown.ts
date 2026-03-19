import { ReadStream } from 'fs';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import * as lark from '@larksuiteoapi/node-sdk';

export type LarkRequestOptions = ReturnType<typeof lark.withUserAccessToken> | undefined;

type DocumentBlockChildrenCreatePayload = NonNullable<
  Parameters<lark.Client['docx']['documentBlockChildren']['create']>[0]
>;
type DocxCreateBlock = NonNullable<NonNullable<DocumentBlockChildrenCreatePayload['data']>['children']>[number];
type DocxCreateTextBlock = NonNullable<DocxCreateBlock['text']>;
type DocxCreateTextElement = NonNullable<DocxCreateTextBlock['elements']>[number];

export type DocxUpdateMode =
  | 'overwrite'
  | 'append'
  | 'replace_range'
  | 'replace_all'
  | 'insert_before'
  | 'insert_after'
  | 'delete_range';

export interface FetchDocxMarkdownOptions {
  lang?: 'zh' | 'en' | 'ja';
}

export interface FetchDocxMarkdownResult {
  documentId: string;
  title?: string;
  revisionId?: number;
  markdown: string;
  wikiNode?: {
    spaceId: string;
    nodeToken: string;
    title?: string;
  };
}

export interface CreateDocxFromMarkdownOptions {
  markdown: string;
  title?: string;
  folderToken?: string;
}

export interface CreateDocxFromMarkdownResult {
  documentId?: string;
  url?: string;
}

export interface ApplyMarkdownUpdateOptions {
  mode: DocxUpdateMode;
  markdown?: string;
  selection_with_ellipsis?: string;
  selection_by_title?: string;
}

export interface RewriteDocxFromMarkdownResult {
  documentId: string;
  title?: string;
  revisionId?: number;
  blockCount: number;
  wikiNode?: {
    spaceId: string;
    nodeToken: string;
    title?: string;
  };
}

export interface UpdateDocxTitleResult {
  documentId: string;
  title: string;
  updated: boolean;
  via: 'wiki' | 'unsupported';
  wikiNode?: {
    spaceId: string;
    nodeToken: string;
  };
}

interface LineInfo {
  text: string;
  start: number;
  end: number;
}

const DOCX_BLOCK_TYPE = {
  PAGE: 1,
  TEXT: 2,
  HEADING1: 3,
  HEADING2: 4,
  HEADING3: 5,
  HEADING4: 6,
  HEADING5: 7,
  HEADING6: 8,
  BULLET: 12,
  ORDERED: 13,
  CODE: 14,
  QUOTE: 15,
  TODO: 17,
  DIVIDER: 22,
} as const;

const LANGUAGE_TO_CODE: Record<string, number> = {
  plaintext: 1,
  text: 1,
  bash: 7,
  shell: 60,
  sh: 60,
  c: 10,
  cpp: 9,
  css: 12,
  go: 22,
  html: 24,
  json: 28,
  java: 29,
  javascript: 30,
  js: 30,
  kotlin: 32,
  markdown: 39,
  nginx: 40,
  php: 43,
  python: 49,
  py: 49,
  ruby: 52,
  rust: 53,
  sql: 56,
  swift: 61,
  typescript: 63,
  ts: 63,
  xml: 66,
  yaml: 67,
  yml: 67,
  toml: 75,
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isWikiTarget(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (!/^https?:\/\//.test(trimmed) && !trimmed.includes('/')) {
    return trimmed.startsWith('wiki');
  }

  let normalized = trimmed;
  if (!/^https?:\/\//.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  const parsed = new URL(normalized);
  return /\/wiki\//.test(parsed.pathname);
}

async function withOptionalUserToken<T>(
  reqOptions: LarkRequestOptions,
  withToken: (options: NonNullable<LarkRequestOptions>) => Promise<T>,
  withoutToken: () => Promise<T>,
): Promise<T> {
  if (reqOptions) {
    return withToken(reqOptions);
  }
  return withoutToken();
}

export function resolveDocxDocumentId(documentIdOrUrl: string): string {
  const value = documentIdOrUrl.trim();
  if (!value) {
    throw new Error('Document ID or URL is required');
  }

  if (!/^https?:\/\//.test(value) && !value.includes('/')) {
    return value;
  }

  let normalized = value;
  if (!/^https?:\/\//.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  const parsed = new URL(normalized);
  const pathname = parsed.pathname;
  const docxMatch = pathname.match(/\/docx\/([A-Za-z0-9]+)/);
  if (docxMatch) {
    return docxMatch[1];
  }

  const docsMatch = pathname.match(/\/docs\/([A-Za-z0-9]+)/);
  if (docsMatch) {
    return docsMatch[1];
  }

  const segments = pathname.split('/').filter(Boolean);
  if (segments.length > 0) {
    return segments[segments.length - 1];
  }

  throw new Error(`Cannot parse Feishu/Lark document ID from: ${documentIdOrUrl}`);
}

async function tryGetWikiNode(
  client: lark.Client,
  token: string,
  reqOptions: LarkRequestOptions,
  objType?: 'docx' | 'wiki',
) {
  try {
    return await withOptionalUserToken(
      reqOptions,
      (tokenOptions) => client.wiki.space.getNode({ params: { token, obj_type: objType } }, tokenOptions),
      () => client.wiki.space.getNode({ params: { token, obj_type: objType } }),
    );
  } catch (error) {
    return undefined;
  }
}

async function resolveDocxTarget(client: lark.Client, documentIdOrUrl: string, reqOptions?: LarkRequestOptions) {
  const token = resolveDocxDocumentId(documentIdOrUrl);
  const targetIsWiki = isWikiTarget(documentIdOrUrl);

  if (targetIsWiki) {
    const wikiResponse = await tryGetWikiNode(client, token, reqOptions, undefined);
    const node = wikiResponse?.data?.node;
    if (!node?.obj_token || node.obj_type !== 'docx' || !node.space_id || !node.node_token) {
      throw new Error('The provided Wiki target does not point to a docx document');
    }

    return {
      documentId: node.obj_token,
      wikiNode: {
        spaceId: node.space_id,
        nodeToken: node.node_token,
        title: node.title,
      },
    };
  }

  const wikiResponse = await tryGetWikiNode(client, token, reqOptions, 'docx');
  const node = wikiResponse?.data?.node;
  if (node?.obj_type === 'docx' && node.space_id && node.node_token) {
    return {
      documentId: node.obj_token || token,
      wikiNode: {
        spaceId: node.space_id,
        nodeToken: node.node_token,
        title: node.title,
      },
    };
  }

  return { documentId: token };
}

export async function createDocxFromMarkdown(
  client: lark.Client,
  options: CreateDocxFromMarkdownOptions,
  reqOptions?: LarkRequestOptions,
): Promise<CreateDocxFromMarkdownResult> {
  const file = Readable.from(options.markdown) as ReadStream;
  const uploadData = {
    file_name: `${options.title || 'document'}.md`,
    parent_type: 'ccm_import_open' as const,
    parent_node: '/',
    size: Buffer.byteLength(options.markdown),
    file,
    extra: JSON.stringify({ obj_type: 'docx', file_extension: 'md' }),
  };

  const uploadResponse = await withOptionalUserToken(
    reqOptions,
    (tokenOptions) => client.drive.media.uploadAll({ data: uploadData }, tokenOptions),
    () => client.drive.media.uploadAll({ data: uploadData }),
  );

  if (!uploadResponse?.file_token) {
    throw new Error('Failed to upload markdown payload');
  }

  const importData = {
    file_extension: 'md',
    file_name: options.title || 'document',
    file_token: uploadResponse.file_token,
    type: 'docx',
    point: {
      mount_type: 1,
      mount_key: options.folderToken || '',
    },
  };

  const importResponse = await withOptionalUserToken(
    reqOptions,
    (tokenOptions) => client.drive.importTask.create({ data: importData }, tokenOptions),
    () => client.drive.importTask.create({ data: importData }),
  );

  const ticket = importResponse.data?.ticket;
  if (!ticket) {
    throw new Error('Failed to create import task');
  }

  for (let index = 0; index < 10; index += 1) {
    const taskResponse = await withOptionalUserToken(
      reqOptions,
      (tokenOptions) => client.drive.importTask.get({ path: { ticket } }, tokenOptions),
      () => client.drive.importTask.get({ path: { ticket } }),
    );

    if (taskResponse.data?.result?.job_status === 0) {
      const result = taskResponse.data.result as unknown as Record<string, unknown> | undefined;
      const documentId =
        typeof result?.document_id === 'string'
          ? result.document_id
          : typeof result?.token === 'string'
            ? result.token
            : undefined;
      const url = typeof result?.url === 'string' ? result.url : undefined;
      return {
        documentId,
        url: url || (documentId ? `https://feishu.cn/docx/${documentId}` : undefined),
      };
    }

    if (taskResponse.data?.result?.job_status !== 1 && taskResponse.data?.result?.job_status !== 2) {
      throw new Error(JSON.stringify(taskResponse.data));
    }
    await sleep(1000);
  }

  throw new Error('Import timed out, please try again later');
}

export async function fetchDocxAsMarkdown(
  client: lark.Client,
  documentIdOrUrl: string,
  reqOptions?: LarkRequestOptions,
  options?: FetchDocxMarkdownOptions,
): Promise<FetchDocxMarkdownResult> {
  const resolvedTarget = await resolveDocxTarget(client, documentIdOrUrl, reqOptions);
  const documentId = resolvedTarget.documentId;
  const [markdownResponse, documentResponse] = await Promise.all([
    withOptionalUserToken(
      reqOptions,
      (tokenOptions) =>
        client.docs.v1.content.get(
          {
            params: {
              doc_token: documentId,
              doc_type: 'docx',
              content_type: 'markdown',
              lang: options?.lang,
            },
          },
          tokenOptions,
        ),
      () =>
        client.docs.v1.content.get({
          params: {
            doc_token: documentId,
            doc_type: 'docx',
            content_type: 'markdown',
            lang: options?.lang,
          },
        }),
    ),
    withOptionalUserToken(
      reqOptions,
      (tokenOptions) => client.docx.document.get({ path: { document_id: documentId } }, tokenOptions),
      () => client.docx.document.get({ path: { document_id: documentId } }),
    ),
  ]);

  return {
    documentId,
    title: resolvedTarget.wikiNode?.title || documentResponse?.data?.document?.title,
    revisionId: documentResponse?.data?.document?.revision_id,
    markdown: markdownResponse?.data?.content || '',
    wikiNode: resolvedTarget.wikiNode,
  };
}

export function applyMarkdownUpdate(currentMarkdown: string, options: ApplyMarkdownUpdateOptions): string {
  const current = normalizeMarkdown(currentMarkdown);
  const incoming = normalizeMarkdown(options.markdown || '');

  if (options.mode === 'overwrite' || options.mode === 'replace_all') {
    return incoming;
  }

  if (options.mode === 'append') {
    return joinMarkdownSegments(current, incoming);
  }

  const range = locateMarkdownRange(current, options.selection_by_title, options.selection_with_ellipsis);
  const before = current.slice(0, range.start).trimEnd();
  const target = current.slice(range.start, range.end).trim();
  const after = current.slice(range.end).trimStart();

  switch (options.mode) {
    case 'replace_range':
      return joinMarkdownSegments(before, incoming, after);
    case 'insert_before':
      return joinMarkdownSegments(before, incoming, target, after);
    case 'insert_after':
      return joinMarkdownSegments(before, target, incoming, after);
    case 'delete_range':
      return joinMarkdownSegments(before, after);
    default:
      return current;
  }
}

export async function rewriteDocxFromMarkdown(
  client: lark.Client,
  documentIdOrUrl: string,
  markdown: string,
  reqOptions?: LarkRequestOptions,
): Promise<RewriteDocxFromMarkdownResult> {
  const resolvedTarget = await resolveDocxTarget(client, documentIdOrUrl, reqOptions);
  const documentId = resolvedTarget.documentId;
  const metadata = await withOptionalUserToken(
    reqOptions,
    (tokenOptions) => client.docx.document.get({ path: { document_id: documentId } }, tokenOptions),
    () => client.docx.document.get({ path: { document_id: documentId } }),
  );

  const blocks = await listDocxBlocks(client, documentId, reqOptions);
  const pageBlock = blocks.find((block) => block.block_type === DOCX_BLOCK_TYPE.PAGE);
  if (!pageBlock?.block_id) {
    throw new Error('Failed to locate the root page block of the document');
  }

  const topLevelBlockIds = pageBlock.children || [];
  if (topLevelBlockIds.length > 0) {
    await withOptionalUserToken(
      reqOptions,
      (tokenOptions) =>
        client.docx.documentBlockChildren.batchDelete(
          {
            path: {
              document_id: documentId,
              block_id: pageBlock.block_id!,
            },
            data: {
              start_index: 0,
              end_index: topLevelBlockIds.length,
            },
            params: {
              client_token: randomUUID(),
            },
          },
          tokenOptions,
        ),
      () =>
        client.docx.documentBlockChildren.batchDelete({
          path: {
            document_id: documentId,
            block_id: pageBlock.block_id!,
          },
          data: {
            start_index: 0,
            end_index: topLevelBlockIds.length,
          },
          params: {
            client_token: randomUUID(),
          },
        }),
    );
  }

  const nextBlocks = parseMarkdownToDocxBlocks(markdown);
  if (nextBlocks.length > 0) {
    await withOptionalUserToken(
      reqOptions,
      (tokenOptions) =>
        client.docx.documentBlockChildren.create(
          {
            path: {
              document_id: documentId,
              block_id: pageBlock.block_id!,
            },
            data: {
              children: nextBlocks,
              index: 0,
            },
            params: {
              client_token: randomUUID(),
            },
          },
          tokenOptions,
        ),
      () =>
        client.docx.documentBlockChildren.create({
          path: {
            document_id: documentId,
            block_id: pageBlock.block_id!,
          },
          data: {
            children: nextBlocks,
            index: 0,
          },
          params: {
            client_token: randomUUID(),
          },
        }),
    );
  }

  return {
    documentId,
    title: resolvedTarget.wikiNode?.title || metadata?.data?.document?.title,
    revisionId: metadata?.data?.document?.revision_id,
    blockCount: nextBlocks.length,
    wikiNode: resolvedTarget.wikiNode,
  };
}

export async function updateDocxTitle(
  client: lark.Client,
  documentIdOrUrl: string,
  title: string,
  reqOptions?: LarkRequestOptions,
): Promise<UpdateDocxTitleResult> {
  const nextTitle = title.trim();
  if (!nextTitle) {
    throw new Error('Title cannot be empty');
  }

  const resolvedTarget = await resolveDocxTarget(client, documentIdOrUrl, reqOptions);
  if (!resolvedTarget.wikiNode) {
    return {
      documentId: resolvedTarget.documentId,
      title: nextTitle,
      updated: false,
      via: 'unsupported',
    };
  }

  await withOptionalUserToken(
    reqOptions,
    (tokenOptions) =>
      client.wiki.spaceNode.updateTitle(
        {
          path: {
            space_id: resolvedTarget.wikiNode!.spaceId,
            node_token: resolvedTarget.wikiNode!.nodeToken,
          },
          data: {
            title: nextTitle,
          },
        },
        tokenOptions,
      ),
    () =>
      client.wiki.spaceNode.updateTitle({
        path: {
          space_id: resolvedTarget.wikiNode!.spaceId,
          node_token: resolvedTarget.wikiNode!.nodeToken,
        },
        data: {
          title: nextTitle,
        },
      }),
  );

  return {
    documentId: resolvedTarget.documentId,
    title: nextTitle,
    updated: true,
    via: 'wiki',
    wikiNode: {
      spaceId: resolvedTarget.wikiNode.spaceId,
      nodeToken: resolvedTarget.wikiNode.nodeToken,
    },
  };
}

export function parseMarkdownToDocxBlocks(markdown: string): DocxCreateBlock[] {
  const lines = normalizeMarkdown(markdown).split('\n');
  const blocks: DocxCreateBlock[] = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const codeStart = trimmed.match(/^```([A-Za-z0-9_-]+)?\s*$/);
    if (codeStart) {
      const body: string[] = [];
      const language = codeStart[1]?.toLowerCase();
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        body.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({
        block_type: DOCX_BLOCK_TYPE.CODE,
        code: {
          elements: [{ text_run: { content: body.join('\n') } }],
          style: language ? { language: LANGUAGE_TO_CODE[language] || LANGUAGE_TO_CODE.plaintext } : undefined,
        },
      });
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push({ block_type: DOCX_BLOCK_TYPE.DIVIDER });
      index += 1;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = parseInlineMarkdown(headingMatch[2]);
      const key = `heading${level}` as keyof DocxCreateBlock;
      const block = {
        block_type: DOCX_BLOCK_TYPE.HEADING1 + level - 1,
        [key]: { elements: content },
      } as unknown as DocxCreateBlock;
      blocks.push(block);
      index += 1;
      continue;
    }

    const todoMatch = trimmed.match(/^[-*+]\s+\[( |x|X)\]\s+(.*)$/);
    if (todoMatch) {
      blocks.push({
        block_type: DOCX_BLOCK_TYPE.TODO,
        todo: {
          elements: parseInlineMarkdown(todoMatch[2]),
          style: { done: todoMatch[1].toLowerCase() === 'x' },
        },
      });
      index += 1;
      continue;
    }

    const bulletMatch = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bulletMatch) {
      blocks.push({
        block_type: DOCX_BLOCK_TYPE.BULLET,
        bullet: {
          elements: parseInlineMarkdown(bulletMatch[1]),
        },
      });
      index += 1;
      continue;
    }

    const orderedMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    if (orderedMatch) {
      blocks.push({
        block_type: DOCX_BLOCK_TYPE.ORDERED,
        ordered: {
          elements: parseInlineMarkdown(orderedMatch[1]),
        },
      });
      index += 1;
      continue;
    }

    const quoteMatch = line.match(/^\s*>\s?(.*)$/);
    if (quoteMatch) {
      const quoteLines: string[] = [quoteMatch[1]];
      index += 1;
      while (index < lines.length) {
        const nextQuote = lines[index].match(/^\s*>\s?(.*)$/);
        if (!nextQuote) {
          break;
        }
        quoteLines.push(nextQuote[1]);
        index += 1;
      }
      blocks.push({
        block_type: DOCX_BLOCK_TYPE.QUOTE,
        quote: {
          elements: parseInlineMarkdown(quoteLines.join('\n')),
        },
      });
      continue;
    }

    const paragraph: string[] = [trimmed];
    index += 1;
    while (index < lines.length) {
      const next = lines[index];
      const nextTrimmed = next.trim();
      if (
        !nextTrimmed ||
        /^```/.test(nextTrimmed) ||
        /^#{1,6}\s+/.test(nextTrimmed) ||
        /^---+$/.test(nextTrimmed) ||
        /^[-*+]\s+\[( |x|X)\]\s+/.test(nextTrimmed) ||
        /^\s*[-*+]\s+/.test(next) ||
        /^\s*\d+\.\s+/.test(next) ||
        /^\s*>\s?/.test(next)
      ) {
        break;
      }
      paragraph.push(nextTrimmed);
      index += 1;
    }

    blocks.push({
      block_type: DOCX_BLOCK_TYPE.TEXT,
      text: {
        elements: parseInlineMarkdown(paragraph.join('\n')),
      },
    });
  }

  return blocks;
}

function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
}

function joinMarkdownSegments(...segments: string[]): string {
  return segments
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function locateMarkdownRange(markdown: string, selectionByTitle?: string, selectionWithEllipsis?: string) {
  if (selectionByTitle) {
    return locateRangeByHeading(markdown, selectionByTitle);
  }
  if (selectionWithEllipsis) {
    return locateRangeByEllipsis(markdown, selectionWithEllipsis);
  }
  throw new Error('A selection is required for this update mode');
}

function buildLineIndex(markdown: string): LineInfo[] {
  const lines = markdown.split('\n');
  const lineIndex: LineInfo[] = [];
  let cursor = 0;
  for (const line of lines) {
    const start = cursor;
    const end = cursor + line.length;
    lineIndex.push({ text: line, start, end });
    cursor = end + 1;
  }
  return lineIndex;
}

function locateRangeByHeading(markdown: string, selectionByTitle: string) {
  const normalizedSelection = selectionByTitle.trim();
  const explicitHeading = normalizedSelection.match(/^(#{1,6})\s+(.*)$/);
  const expectedLevel = explicitHeading?.[1].length;
  const expectedTitle = (explicitHeading?.[2] || normalizedSelection).trim();
  const lines = buildLineIndex(markdown);

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    const heading = current.text.trim().match(/^(#{1,6})\s+(.*)$/);
    if (!heading) {
      continue;
    }

    const currentLevel = heading[1].length;
    const currentTitle = heading[2].trim();
    if (currentTitle !== expectedTitle) {
      continue;
    }
    if (expectedLevel && currentLevel !== expectedLevel) {
      continue;
    }

    let end = markdown.length;
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const nextHeading = lines[nextIndex].text.trim().match(/^(#{1,6})\s+(.*)$/);
      if (nextHeading && nextHeading[1].length <= currentLevel) {
        end = lines[nextIndex].start;
        break;
      }
    }

    return { start: current.start, end };
  }

  throw new Error(`Cannot locate heading selection: ${selectionByTitle}`);
}

function locateRangeByEllipsis(markdown: string, selectionWithEllipsis: string) {
  const [startMarkerRaw, endMarkerRaw] = selectionWithEllipsis.split('...');
  const startMarker = startMarkerRaw?.trim();
  const endMarker = endMarkerRaw?.trim();
  if (!startMarker || !endMarker) {
    throw new Error('selection_with_ellipsis must follow the format "start...end"');
  }

  const start = markdown.indexOf(startMarker);
  if (start < 0) {
    throw new Error(`Cannot locate selection start marker: ${startMarker}`);
  }

  const endStart = markdown.indexOf(endMarker, start + startMarker.length);
  if (endStart < 0) {
    throw new Error(`Cannot locate selection end marker: ${endMarker}`);
  }

  return {
    start,
    end: endStart + endMarker.length,
  };
}

function parseInlineMarkdown(text: string): DocxCreateTextElement[] {
  const elements: DocxCreateTextElement[] = [];
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*]+)\*/g;

  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      elements.push({ text_run: { content: text.slice(lastIndex, index) } });
    }

    if (match[1] && match[2]) {
      elements.push({
        text_run: {
          content: match[1],
          text_element_style: {
            link: { url: match[2] },
          },
        },
      });
    } else if (match[3]) {
      elements.push({
        text_run: {
          content: match[3],
          text_element_style: {
            inline_code: true,
          },
        },
      });
    } else if (match[4]) {
      elements.push({
        text_run: {
          content: match[4],
          text_element_style: {
            bold: true,
          },
        },
      });
    } else if (match[5]) {
      elements.push({
        text_run: {
          content: match[5],
          text_element_style: {
            strikethrough: true,
          },
        },
      });
    } else if (match[6]) {
      elements.push({
        text_run: {
          content: match[6],
          text_element_style: {
            italic: true,
          },
        },
      });
    }

    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    elements.push({ text_run: { content: text.slice(lastIndex) } });
  }

  return elements.length > 0 ? elements : [{ text_run: { content: text } }];
}

async function listDocxBlocks(client: lark.Client, documentId: string, reqOptions?: LarkRequestOptions) {
  const blocks: Array<{ block_id?: string; children?: string[]; block_type: number }> = [];
  let pageToken: string | undefined;

  do {
    const response = await withOptionalUserToken(
      reqOptions,
      (tokenOptions) =>
        client.docx.documentBlock.list(
          {
            path: { document_id: documentId },
            params: { page_size: 500, page_token: pageToken },
          },
          tokenOptions,
        ),
      () =>
        client.docx.documentBlock.list({
          path: { document_id: documentId },
          params: { page_size: 500, page_token: pageToken },
        }),
    );

    const items = response?.data?.items || [];
    blocks.push(...(items as typeof blocks));
    pageToken = response?.data?.page_token || undefined;
  } while (pageToken);

  return blocks;
}
