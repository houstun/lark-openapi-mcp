import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as lark from '@larksuiteoapi/node-sdk';
import { z } from 'zod';
import { McpTool } from '../../../../types';
import { handlePermissionError, isPermissionError } from '../../../../utils/permission-error';

export type driveBuiltinToolName = 'drive.builtin.upload' | 'drive.builtin.download';

export const larkDriveBuiltinUploadTool: McpTool = {
  project: 'drive',
  name: 'drive.builtin.upload',
  accessTokens: ['user', 'tenant'],
  description: '[飞书/Lark] - 云盘-文件上传 - 上传本地文件到飞书云盘，自动处理大文件分片上传。',
  schema: {
    data: z.object({
      file_path: z.string().describe('本地文件绝对路径'),
      folder_token: z.string().describe('目标文件夹 token'),
      file_name: z.string().describe('文件名，默认使用原始文件名').optional(),
    }),
    useUAT: z.boolean().describe('使用用户身份请求，否则为应用身份').optional(),
  },
  customHandler: async (client, params, options): Promise<any> => {
    try {
      const { userAccessToken } = options || {};
      if (!fs.existsSync(params.data.file_path)) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify({ msg: `文件不存在: ${params.data.file_path}` }) }],
        };
      }

      const stat = fs.statSync(params.data.file_path);
      if (!stat.isFile()) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify({ msg: `路径不是文件: ${params.data.file_path}` }) }],
        };
      }

      const reqOptions = userAccessToken && params.useUAT ? lark.withUserAccessToken(userAccessToken) : undefined;
      const fileName = params.data.file_name ?? path.basename(params.data.file_path);
      const fileSize = stat.size;
      const chunkThreshold = 20 * 1024 * 1024;

      let fileToken: string | undefined;
      if (fileSize < chunkThreshold) {
        const data = {
          file_name: fileName,
          parent_type: 'explorer' as const,
          parent_node: params.data.folder_token,
          size: fileSize,
          file: fs.createReadStream(params.data.file_path),
        };
        const response = reqOptions
          ? await client.drive.file.uploadAll({ data }, reqOptions)
          : await client.drive.file.uploadAll({ data });
        fileToken =
          response?.file_token ??
          ((response as Record<string, Record<string, unknown>>)?.data?.file_token as string | undefined);
      } else {
        fileToken = await chunkedUpload(
          client,
          params.data.file_path,
          fileName,
          fileSize,
          params.data.folder_token,
          reqOptions,
        );
      }

      if (!fileToken) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify({ msg: '上传失败：未获取到 file_token' }) }],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ success: true, file_token: fileToken, file_name: fileName, file_size: fileSize }),
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

export const larkDriveBuiltinDownloadTool: McpTool = {
  project: 'drive',
  name: 'drive.builtin.download',
  accessTokens: ['user', 'tenant'],
  description: '[飞书/Lark] - 云盘-文件下载 - 从飞书云盘下载文件到本地路径。',
  schema: {
    data: z.object({
      file_token: z.string().describe('文件 token'),
      save_path: z.string().describe('保存路径，默认保存到临时目录').optional(),
    }),
    useUAT: z.boolean().describe('使用用户身份请求，否则为应用身份').optional(),
  },
  customHandler: async (client, params, options): Promise<any> => {
    try {
      const { userAccessToken } = options || {};
      const reqOptions = userAccessToken && params.useUAT ? lark.withUserAccessToken(userAccessToken) : undefined;

      let savePath: string;
      if (params.data.save_path) {
        if (!path.isAbsolute(params.data.save_path)) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: JSON.stringify({ msg: '保存路径必须是绝对路径' }) }],
          };
        }

        const resolved = path.resolve(params.data.save_path);
        if (resolved !== params.data.save_path && resolved !== path.normalize(params.data.save_path)) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: JSON.stringify({ msg: '保存路径包含不安全的路径遍历' }) }],
          };
        }
        savePath = resolved;
      } else {
        savePath = path.join(os.tmpdir(), `feishu-download-${Date.now()}`);
      }

      fs.mkdirSync(path.dirname(savePath), { recursive: true });
      const response = reqOptions
        ? await client.drive.file.download({ path: { file_token: params.data.file_token } }, reqOptions)
        : await client.drive.file.download({ path: { file_token: params.data.file_token } });

      await response.writeFile(savePath);
      const stat = fs.statSync(savePath);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ success: true, save_path: savePath, file_size: stat.size }),
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

async function chunkedUpload(
  client: lark.Client,
  filePath: string,
  fileName: string,
  fileSize: number,
  folderToken: string,
  reqOptions?: ReturnType<typeof lark.withUserAccessToken>,
): Promise<string | undefined> {
  const prepareData = {
    file_name: fileName,
    parent_type: 'explorer' as const,
    parent_node: folderToken,
    size: fileSize,
  };
  const prepareResponse = reqOptions
    ? await client.drive.file.uploadPrepare({ data: prepareData }, reqOptions)
    : await client.drive.file.uploadPrepare({ data: prepareData });

  const uploadId = prepareResponse?.data?.upload_id;
  const blockSize = prepareResponse?.data?.block_size;
  const blockNum = prepareResponse?.data?.block_num;
  if (!uploadId || !blockSize || !blockNum) {
    throw new Error('分片上传初始化失败：缺少必要参数');
  }

  const fd = fs.openSync(filePath, 'r');
  try {
    for (let seq = 0; seq < blockNum; seq += 1) {
      const offset = seq * blockSize;
      const chunkSize = Math.min(blockSize, fileSize - offset);
      const buffer = Buffer.alloc(chunkSize);
      fs.readSync(fd, buffer, 0, chunkSize, offset);
      const partData = { upload_id: uploadId, seq, size: chunkSize, file: buffer };
      if (reqOptions) {
        await client.drive.file.uploadPart({ data: partData }, reqOptions);
      } else {
        await client.drive.file.uploadPart({ data: partData });
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  const finishData = { upload_id: uploadId, block_num: blockNum };
  const finishResponse = reqOptions
    ? await client.drive.file.uploadFinish({ data: finishData }, reqOptions)
    : await client.drive.file.uploadFinish({ data: finishData });

  return finishResponse?.data?.file_token;
}

export const driveBuiltinTools = [larkDriveBuiltinUploadTool, larkDriveBuiltinDownloadTool];
