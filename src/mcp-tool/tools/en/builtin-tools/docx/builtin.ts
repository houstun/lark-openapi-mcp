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
    throw new Error('document_id or doc_id is required');
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
      throw new Error(
        'selection_with_ellipsis and selection_by_title are mutually exclusive, and one of them is required for this mode',
      );
    }
  }

  const markdownRequired = !['delete_range'].includes(data.mode);
  if (markdownRequired && !data.markdown) {
    throw new Error(`markdown is required when mode=${data.mode}`);
  }
}

export const larkDocxBuiltinSearchTool: McpTool = {
  project: 'docx',
  name: 'docx.builtin.search',
  accessTokens: ['user'],
  description: '[Feishu/Lark]-Docs-Document-Search Document-Search cloud documents, only supports user_access_token',
  schema: {
    data: z.object({
      search_key: z.string().describe('Search keyword'),
      count: z
        .number()
        .describe('Specify the number of files returned in the search. Value range is [0,50].')
        .optional(),
      offset: z
        .number()
        .describe(
          'Specifies the search offset. The minimum value is 0, which means no offset. The sum of this parameter and the number of returned files must not be greater than or equal to 200 (i.e., offset + count < 200).',
        )
        .optional(),
      owner_ids: z.array(z.string()).describe('Open ID of the file owner').optional(),
      chat_ids: z.array(z.string()).describe('ID of the group where the file is located').optional(),
      docs_types: z
        .array(z.enum(['doc', 'sheet', 'slides', 'bitable', 'mindnote', 'file']))
        .describe(
          'File types, supports the following enumerations: doc: old version document; sheet: spreadsheet; slides: slides; bitable: multi-dimensional table; mindnote: mind map; file: file',
        )
        .optional(),
    }),
    useUAT: z
      .boolean()
      .describe('Whether to use user identity for the request, false means using application identity')
      .optional(),
  },
  customHandler: async (client, params, options): Promise<any> => {
    try {
      const userAccessToken = options?.userAccessToken;

      if (!userAccessToken) {
        return errorResult({ msg: 'User access token is not configured' });
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
  description: '[Feishu/Lark]-Docs-Document-Import Document-Import a docx document from Markdown, up to 20MB.',
  schema: {
    data: z.object({
      markdown: z.string().describe('Markdown file content'),
      file_name: z.string().describe('File name').max(27).optional(),
    }),
    useUAT: z.boolean().describe('Use user identity for the request, otherwise use application identity').optional(),
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
  description: '[Feishu/Lark]-Docs-Document-Create Document-Create a new document from Markdown content.',
  schema: {
    data: z.object({
      markdown: z.string().describe('Markdown content to import'),
      title: z.string().describe('Title of the new document'),
      folder_token: z.string().describe('Optional folder token where the document should be created').optional(),
    }),
    useUAT: z.boolean().describe('Use user identity for the request, otherwise use application identity').optional(),
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
  description:
    '[Feishu/Lark]-Docs-Document-Fetch Document-Fetch document title and Markdown content, with optional pagination.',
  schema: {
    data: z.object({
      document_id: z.string().describe('Document ID or docx URL').optional(),
      doc_id: z.string().describe('Alias of document_id for OpenClaw-style compatibility').optional(),
      offset: z.number().min(0).describe('Optional character offset for pagination').optional(),
      limit: z.number().min(1).describe('Optional maximum number of characters to return').optional(),
      lang: z.enum(['zh', 'en', 'ja']).describe('Language for mention rendering').optional(),
    }),
    useUAT: z.boolean().describe('Use user identity for the request, otherwise use application identity').optional(),
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
  description:
    '[Feishu/Lark]-Docs-Document-Markdown Write-Create a new document from Markdown, or overwrite an existing document when document_id is provided.',
  schema: {
    data: z.object({
      document_id: z.string().describe('Optional document ID or URL to overwrite in place').optional(),
      markdown: z.string().describe('Markdown content to write'),
      title: z.string().describe('Title for the new document').optional(),
      folder_token: z.string().describe('Folder token where the new document should be created').optional(),
    }),
    useUAT: z.boolean().describe('Use user identity for the request, otherwise use application identity').optional(),
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
            ? 'Title updates are not supported by the current official docx API. Markdown content was overwritten in place.'
            : 'Markdown content was overwritten in place.',
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
    '[Feishu/Lark]-Docs-Document-Update Document-Update an existing document in place with overwrite, append, replace, insert, or delete modes.',
  schema: {
    data: z.object({
      document_id: z.string().describe('Document ID or docx URL').optional(),
      doc_id: z.string().describe('Alias of document_id for OpenClaw-style compatibility').optional(),
      markdown: z.string().describe('Markdown payload used by the update mode').optional(),
      mode: updateModeSchema.describe('Update mode'),
      selection_with_ellipsis: z
        .string()
        .describe('Range selector in the form "start...end", required for range-based modes')
        .optional(),
      selection_by_title: z
        .string()
        .describe('Heading selector such as "## Section Title", required for heading-based range modes')
        .optional(),
      new_title: z.string().describe('Reserved. Title update is not yet supported by the official API').optional(),
      lang: z
        .enum(['zh', 'en', 'ja'])
        .describe('Language for mention rendering when fetching current Markdown')
        .optional(),
    }),
    useUAT: z.boolean().describe('Use user identity for the request, otherwise use application identity').optional(),
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
        note: params.data.new_title
          ? 'Document title update is not supported by the current official docx API. The body content was updated successfully.'
          : undefined,
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
  description:
    '[Feishu/Lark]-Docs-Document-Markdown Read-Read a Feishu/Lark document and return official Markdown content.',
  schema: {
    data: z.object({
      document_id: z.string().describe('Feishu/Lark document ID or URL'),
      lang: z.enum(['zh', 'en', 'ja']).describe('Language for mention rendering').optional(),
    }),
    useUAT: z.boolean().describe('Use user identity for the request, otherwise use application identity').optional(),
  },
  customHandler: async (client, params, options): Promise<any> => {
    try {
      const reqOptions = getReqOptions(options, params.useUAT);
      const fetched = await fetchDocxAsMarkdown(client, params.data.document_id, reqOptions, {
        lang: params.data.lang,
      });
      return successResult(fetched.markdown || '(Document is empty)');
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
