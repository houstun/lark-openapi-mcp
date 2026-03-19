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
  description:
    '[飞书/Lark] - 多维表格-智能查询 - 输入多维表格或 Wiki URL，自动解析并分页查询记录。',
  schema: {
    data: z.object({
      url: z.string().describe('飞书多维表格或 Wiki URL'),
      table_id: z.string().describe('数据表 ID，不传则自动解析或先列出所有数据表').optional(),
      filter: z.string().describe('过滤条件 JSON 字符串').optional(),
      page_size: z.number().describe('每页记录数，默认 100').optional(),
    }),
    useUAT: z.boolean().describe('使用用户身份请求，否则为应用身份').optional(),
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
                text: JSON.stringify({ msg: '无法解析 Wiki 节点，请确认 URL 正确且当前身份有访问权限。' }),
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
                text: JSON.stringify({ msg: `该 Wiki 节点不是多维表格，当前类型为: ${objType}` }),
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
                text: JSON.stringify({ app_token: appToken, tables: [], message: '该多维表格中没有数据表' }),
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
                  message: `该多维表格有 ${tables.length} 个数据表，请指定 table_id 后重试`,
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
