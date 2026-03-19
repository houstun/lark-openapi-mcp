import * as lark from '@larksuiteoapi/node-sdk';
import { z } from 'zod';
import { McpTool } from '../../../../types';
import { handlePermissionError, isPermissionError } from '../../../../utils/permission-error';
import { parseBitableUrl } from '../../../../utils/url-parser';

export type bitableBuiltinToolName = 'bitable.builtin.smartQuery';

export const larkBitableBuiltinSmartQueryTool: McpTool = {
  project: 'bitable',
  name: 'bitable.builtin.smartQuery',
  accessTokens: ['user', 'tenant'],
  description: '[Feishu/Lark]-Bitable-Smart Query-Resolve a Bitable or Wiki URL and fetch records with auto pagination.',
  schema: {
    data: z.object({
      url: z.string().describe('Feishu/Lark Bitable or Wiki URL'),
      table_id: z.string().describe('Table ID, optional when the URL already points to a single table').optional(),
      filter: z.string().describe('Filter condition JSON string').optional(),
      page_size: z.number().describe('Number of records per page, defaults to 100').optional(),
    }),
    useUAT: z.boolean().describe('Use user identity for the request, otherwise use application identity').optional(),
  },
  customHandler: async (client, params, options): Promise<any> => {
    try {
      const { userAccessToken } = options || {};
      const reqOptions = userAccessToken && params.useUAT ? lark.withUserAccessToken(userAccessToken) : undefined;

      const parsed = parseBitableUrl(params.data.url);
      let appToken = parsed.appToken;
      let tableId = params.data.table_id ?? parsed.tableId;

      if (parsed.isWiki) {
        const nodeResponse = reqOptions
          ? await client.wiki.space.getNode({ params: { token: parsed.appToken } }, reqOptions)
          : await client.wiki.space.getNode({ params: { token: parsed.appToken } });
        const node = nodeResponse?.data?.node;
        const objToken = node?.obj_token;
        const objType = node?.obj_type;

        if (!objToken) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ msg: 'Failed to resolve the Wiki node. Verify the URL and current access scope.' }),
              },
            ],
          };
        }

        if (objType !== undefined && String(objType) !== 'bitable' && Number(objType) !== 22) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ msg: `This Wiki node is not a Bitable. Current node type: ${objType}` }),
              },
            ],
          };
        }

        appToken = objToken;
      }

      if (!tableId) {
        const tablesResponse = reqOptions
          ? await client.bitable.appTable.list({ path: { app_token: appToken } }, reqOptions)
          : await client.bitable.appTable.list({ path: { app_token: appToken } });
        const tables = tablesResponse?.data?.items ?? [];
        if (tables.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ app_token: appToken, tables: [], message: 'No tables were found in this Bitable' }),
              },
            ],
          };
        }

        if (tables.length > 1) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  app_token: appToken,
                  tables: tables.map((table) => ({
                    table_id: table.table_id,
                    name: table.name,
                    revision: table.revision,
                  })),
                  message: `This Bitable has ${tables.length} tables. Please specify table_id and try again.`,
                }),
              },
            ],
          };
        }

        tableId = tables[0].table_id;
      }

      const pageSize = params.data.page_size ?? 100;
      const records: Array<{ record_id?: string; fields?: Record<string, unknown> }> = [];
      let pageToken: string | undefined;
      let total = 0;

      do {
        const listParams: Record<string, unknown> = {
          page_size: pageSize,
          page_token: pageToken,
        };
        if (params.data.filter) {
          listParams.filter = params.data.filter;
        }

        const response = reqOptions
          ? await client.bitable.appTableRecord.list(
              { path: { app_token: appToken, table_id: tableId! }, params: listParams as any },
              reqOptions,
            )
          : await client.bitable.appTableRecord.list({
              path: { app_token: appToken, table_id: tableId! },
              params: listParams as any,
            });
        const items = response?.data?.items ?? [];
        records.push(...(items as typeof records));
        total = response?.data?.total ?? records.length;
        pageToken = response?.data?.page_token ?? undefined;
      } while (pageToken);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              app_token: appToken,
              table_id: tableId,
              total,
              count: records.length,
              records: records.map((record) => ({ record_id: record.record_id, fields: record.fields })),
            }),
          },
        ],
      };
    } catch (error) {
      if (isPermissionError(error)) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: handlePermissionError(error) }],
        };
      }

      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify((error as any)?.response?.data || { msg: (error as Error)?.message || String(error) }),
          },
        ],
      };
    }
  },
};

export const bitableBuiltinTools = [larkBitableBuiltinSmartQueryTool];
