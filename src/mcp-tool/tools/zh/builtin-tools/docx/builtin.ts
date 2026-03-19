import * as lark from '@larksuiteoapi/node-sdk';
import { z } from 'zod';
import { McpHandlerOptions, McpTool } from '../../../../types';
import {
  applyMarkdownUpdate,
  createDocxFromMarkdown,
  fetchDocxAsMarkdown,
  handlePermissionError,
  isPermissionError,
  rewriteDocxFromMarkdown,
} from '../../../../utils';

const updateModeSchema = z.enum([
  'overwrite',
  'append',
  'replace_range',
  'replace_all',
  'insert_before',
  'insert_after',
  'delete_range',
]);

export type docxBuiltinToolName =
  | 'docx.builtin.search'
  | 'docx.builtin.import'
  | 'docx.builtin.create'
  | 'docx.builtin.fetch'
  | 'docx.builtin.update'
  | 'docx.builtin.markdownWrite'
  | 'docx.builtin.markdownRead';

function getReqOptions(options: McpHandlerOptions | undefined, useUAT?: boolean) {
  const userAccessToken = options?.userAccessToken as string | undefined;
  return userAccessToken && useUAT ? lark.withUserAccessToken(userAccessToken) : undefined;
}

function successResult(payload: Record<string, unknown> | string) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof payload === 'string' ? payload : JSON.stringify(payload),
      },
    ],
  };
}

function errorResult(payload: Record<string, unknown> | string) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: typeof payload === 'string' ? payload : JSON.stringify(payload),
      },
    ],
  };
}

function normalizeError(error: unknown) {
  if (isPermissionError(error)) {
    return errorResult(handlePermissionError(error));
  }
  return errorResult((error as any)?.response?.data || { msg: (error as Error)?.message || String(error) });
}

function requireDocumentTarget(data: { document_id?: string; doc_id?: string }) {
  const target = data.document_id || data.doc_id;
  if (!target) {
    throw new Error('必须提供 document_id 或 doc_id');
  }
  return target;
}

function validateUpdatePayload(data: {
  document_id?: string;
  doc_id?: string;
  markdown?: string;
  mode: z.infer<typeof updateModeSchema>;
  selection_with_ellipsis?: string;
  selection_by_title?: string;
}) {
  requireDocumentTarget(data);

  const selectionRequired = ['replace_range', 'insert_before', 'insert_after', 'delete_range'].includes(data.mode);
  if (selectionRequired) {
    const hasEllipsis = Boolean(data.selection_with_ellipsis);
    const hasTitle = Boolean(data.selection_by_title);
    if ((hasEllipsis && hasTitle) || (!hasEllipsis && !hasTitle)) {
      throw new Error('selection_with_ellipsis 与 selection_by_title 互斥，并且在当前模式下必须二选一');
    }
  }

  const markdownRequired = !['delete_range'].includes(data.mode);
  if (markdownRequired && !data.markdown) {
    throw new Error(`mode=${data.mode} 时必须提供 markdown`);
  }
}

export const larkDocxBuiltinSearchTool: McpTool = {
  project: 'docx',
  name: 'docx.builtin.search',
  accessTokens: ['user'],
  description: '[飞书/Lark] - 云文档-文档 - 搜索文档 - 搜索云文档，只支持 user_access_token',
  schema: {
    data: z.object({
      search_key: z.string().describe('搜索关键词'),
      count: z.number().describe('指定搜索返回的文件数量。取值范围为 [0,50]。').optional(),
      offset: z
        .number()
        .describe(
          '指定搜索的偏移量，该参数最小为 0，即不偏移。该参数的值与返回的文件数量之和不得大于或等于 200（即 offset + count < 200）。',
        )
        .optional(),
      owner_ids: z.array(z.string()).describe('文件所有者的 Open ID').optional(),
      chat_ids: z.array(z.string()).describe('文件所在群的 ID').optional(),
      docs_types: z
        .array(z.enum(['doc', 'sheet', 'slides', 'bitable', 'mindnote', 'file']))
        .describe(
          '文件类型，支持以下枚举：doc：旧版文档；sheet：电子表格；slides：幻灯片；bitable：多维表格；mindnote：思维笔记；file：文件',
        )
        .optional(),
    }),
    useUAT: z.boolean().describe('是否使用用户身份请求，false 则使用应用身份请求').optional(),
  },
  customHandler: async (client, params, options): Promise<any> => {
    try {
      const userAccessToken = options?.userAccessToken;

      if (!userAccessToken) {
        return errorResult({ msg: '当前未配置 userAccessToken' });
      }

      const response = await client.request(
        {
          method: 'POST',
          url: '/open-apis/suite/docs-api/search/object',
          data: params.data,
        },
        lark.withUserAccessToken(userAccessToken),
      );

      return successResult(response.data ?? response);
    } catch (error) {
      return errorResult((error as any)?.response?.data || { msg: (error as Error)?.message || String(error) });
    }
  },
};

export const larkDocxBuiltinImportTool: McpTool = {
  project: 'docx',
  name: 'docx.builtin.import',
  accessTokens: ['user', 'tenant'],
  description: '[飞书/Lark] - 云文档-文档 - 导入文档 - 将 Markdown 导入为新文档，最大 20MB。',
  schema: {
    data: z.object({
      markdown: z.string().describe('Markdown 文件内容'),
      file_name: z.string().describe('文件名').max(27).optional(),
    }),
    useUAT: z.boolean().describe('使用用户身份请求，否则为应用身份').optional(),
  },
  customHandler: async (client, params, options): Promise<any> => {
    try {
      const reqOptions = getReqOptions(options, params.useUAT);
      const result = await createDocxFromMarkdown(
        client,
        {
          markdown: params.data.markdown,
          title: params.data.file_name,
        },
        reqOptions,
      );
      return successResult({
        success: true,
        document_id: result.documentId || result.url,
        url: result.url,
      });
    } catch (error) {
      return normalizeError(error);
    }
  },
};

export const larkDocxBuiltinCreateTool: McpTool = {
  project: 'docx',
  name: 'docx.builtin.create',
  accessTokens: ['user', 'tenant'],
  description: '[飞书/Lark] - 云文档-文档 - 创建文档 - 根据 Markdown 创建新文档。',
  schema: {
    data: z.object({
      markdown: z.string().describe('要导入的 Markdown 内容'),
      title: z.string().describe('新建文档标题'),
      folder_token: z.string().describe('可选，目标文件夹 token').optional(),
    }),
    useUAT: z.boolean().describe('使用用户身份请求，否则为应用身份').optional(),
  },
  customHandler: async (client, params, options): Promise<any> => {
    try {
      const reqOptions = getReqOptions(options, params.useUAT);
      const result = await createDocxFromMarkdown(
        client,
        {
          markdown: params.data.markdown,
          title: params.data.title,
          folderToken: params.data.folder_token,
        },
        reqOptions,
      );
      return successResult({
        success: true,
        document_id: result.documentId || result.url,
        url: result.url,
      });
    } catch (error) {
      return normalizeError(error);
    }
  },
};

export const larkDocxBuiltinFetchTool: McpTool = {
  project: 'docx',
  name: 'docx.builtin.fetch',
  accessTokens: ['user', 'tenant'],
  description: '[飞书/Lark] - 云文档-文档 - 获取文档 - 获取文档标题与 Markdown 内容，支持按字符分页。',
  schema: {
    data: z.object({
      document_id: z.string().describe('文档 ID 或 docx URL').optional(),
      doc_id: z.string().describe('document_id 的兼容别名').optional(),
      offset: z.number().min(0).describe('可选，分页字符偏移量').optional(),
      limit: z.number().min(1).describe('可选，返回的最大字符数').optional(),
      lang: z.enum(['zh', 'en', 'ja']).describe('Mention 用户名的语言').optional(),
    }),
    useUAT: z.boolean().describe('使用用户身份请求，否则为应用身份').optional(),
  },
  customHandler: async (client, params, options): Promise<any> => {
    try {
      const reqOptions = getReqOptions(options, params.useUAT);
      const documentTarget = requireDocumentTarget(params.data);
      const result = await fetchDocxAsMarkdown(client, documentTarget, reqOptions, { lang: params.data.lang });
      const offset = params.data.offset || 0;
      const limit = params.data.limit;
      const markdown =
        limit === undefined
          ? result.markdown.slice(offset)
          : result.markdown.slice(offset, Math.max(offset, offset + limit));

      return successResult({
        success: true,
        document_id: result.documentId,
        title: result.title,
        revision_id: result.revisionId,
        markdown,
        total_length: result.markdown.length,
        offset,
        limit,
        has_more: offset + markdown.length < result.markdown.length,
      });
    } catch (error) {
      return normalizeError(error);
    }
  },
};

export const larkDocxBuiltinMarkdownWriteTool: McpTool = {
  project: 'docx',
  name: 'docx.builtin.markdownWrite',
  accessTokens: ['user', 'tenant'],
  description: '[飞书/Lark] - 云文档-文档 - Markdown 写入 - 新建文档，或在传入 document_id 时原地覆盖正文内容。',
  schema: {
    data: z.object({
      document_id: z.string().describe('可选，已有文档 ID 或 URL，传入后将原地覆盖正文').optional(),
      markdown: z.string().describe('要写入的 Markdown 内容'),
      title: z.string().describe('新建文档标题').optional(),
      folder_token: z.string().describe('新建文档放置的文件夹 token').optional(),
    }),
    useUAT: z.boolean().describe('使用用户身份请求，否则为应用身份').optional(),
  },
  customHandler: async (client, params, options): Promise<any> => {
    try {
      const reqOptions = getReqOptions(options, params.useUAT);

      if (params.data.document_id) {
        const rewritten = await rewriteDocxFromMarkdown(
          client,
          params.data.document_id,
          params.data.markdown,
          reqOptions,
        );
        return successResult({
          success: true,
          document_id: rewritten.documentId,
          title: rewritten.title,
          revision_id: rewritten.revisionId,
          block_count: rewritten.blockCount,
          note: params.data.title
            ? '当前官方 docx API 不支持直接更新文档标题，已原地覆盖正文 Markdown 内容。'
            : '已原地覆盖正文 Markdown 内容。',
        });
      }

      const created = await createDocxFromMarkdown(
        client,
        {
          markdown: params.data.markdown,
          title: params.data.title,
          folderToken: params.data.folder_token,
        },
        reqOptions,
      );

      return successResult({
        success: true,
        document_id: created.documentId || created.url,
        url: created.url,
      });
    } catch (error) {
      return normalizeError(error);
    }
  },
};

export const larkDocxBuiltinUpdateTool: McpTool = {
  project: 'docx',
  name: 'docx.builtin.update',
  accessTokens: ['user', 'tenant'],
  description:
    '[飞书/Lark] - 云文档-文档 - 更新文档 - 支持 overwrite、append、replace、insert、delete 等模式原地更新文档。',
  schema: {
    data: z.object({
      document_id: z.string().describe('文档 ID 或 docx URL').optional(),
      doc_id: z.string().describe('document_id 的兼容别名').optional(),
      markdown: z.string().describe('本次更新使用的 Markdown 内容').optional(),
      mode: updateModeSchema.describe('更新模式'),
      selection_with_ellipsis: z.string().describe('范围定位，格式为 "start...end"，用于按片段定位').optional(),
      selection_by_title: z.string().describe('标题定位，例如 "## 章节标题"，用于按标题定位整段内容').optional(),
      new_title: z.string().describe('保留字段。当前官方 API 仍不支持直接更新文档标题').optional(),
      lang: z.enum(['zh', 'en', 'ja']).describe('抓取当前 Markdown 时 Mention 用户名的语言').optional(),
    }),
    useUAT: z.boolean().describe('使用用户身份请求，否则为应用身份').optional(),
  },
  customHandler: async (client, params, options): Promise<any> => {
    try {
      validateUpdatePayload(params.data);
      const reqOptions = getReqOptions(options, params.useUAT);
      const documentTarget = requireDocumentTarget(params.data);
      const fetched = await fetchDocxAsMarkdown(client, documentTarget, reqOptions, { lang: params.data.lang });
      const nextMarkdown = applyMarkdownUpdate(fetched.markdown, {
        mode: params.data.mode,
        markdown: params.data.markdown,
        selection_by_title: params.data.selection_by_title,
        selection_with_ellipsis: params.data.selection_with_ellipsis,
      });
      const rewritten = await rewriteDocxFromMarkdown(client, fetched.documentId, nextMarkdown, reqOptions);

      return successResult({
        success: true,
        document_id: rewritten.documentId,
        title: rewritten.title,
        revision_id: rewritten.revisionId,
        mode: params.data.mode,
        markdown_length_before: fetched.markdown.length,
        markdown_length_after: nextMarkdown.length,
        block_count: rewritten.blockCount,
        note: params.data.new_title ? '当前官方 docx API 不支持直接更新文档标题，正文内容已成功更新。' : undefined,
      });
    } catch (error) {
      return normalizeError(error);
    }
  },
};

export const larkDocxBuiltinMarkdownReadTool: McpTool = {
  project: 'docx',
  name: 'docx.builtin.markdownRead',
  accessTokens: ['user', 'tenant'],
  description: '[飞书/Lark] - 云文档-文档 - Markdown 读取 - 返回官方 Markdown 内容。',
  schema: {
    data: z.object({
      document_id: z.string().describe('文档 ID 或 URL'),
      lang: z.enum(['zh', 'en', 'ja']).describe('Mention 用户名的语言').optional(),
    }),
    useUAT: z.boolean().describe('使用用户身份请求，否则为应用身份').optional(),
  },
  customHandler: async (client, params, options): Promise<any> => {
    try {
      const reqOptions = getReqOptions(options, params.useUAT);
      const fetched = await fetchDocxAsMarkdown(client, params.data.document_id, reqOptions, {
        lang: params.data.lang,
      });
      return successResult(fetched.markdown || '（文档为空）');
    } catch (error) {
      return normalizeError(error);
    }
  },
};

export const docxBuiltinTools = [
  larkDocxBuiltinSearchTool,
  larkDocxBuiltinImportTool,
  larkDocxBuiltinCreateTool,
  larkDocxBuiltinFetchTool,
  larkDocxBuiltinMarkdownWriteTool,
  larkDocxBuiltinUpdateTool,
  larkDocxBuiltinMarkdownReadTool,
];
