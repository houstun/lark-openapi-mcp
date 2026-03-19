import { handlePermissionError, isPermissionError } from '../../../src/mcp-tool/utils/permission-error';
import { parseBitableUrl } from '../../../src/mcp-tool/utils/url-parser';

describe('openclaw helper utils', () => {
  describe('parseBitableUrl', () => {
    it('should parse a base URL with table and view query params', () => {
      expect(parseBitableUrl('https://feishu.cn/base/appToken123?table=tbl456&view=vew789')).toEqual({
        appToken: 'appToken123',
        tableId: 'tbl456',
        viewId: 'vew789',
        isWiki: false,
      });
    });

    it('should parse a wiki URL and mark it as wiki', () => {
      expect(parseBitableUrl('https://feishu.cn/wiki/wikiToken001?table=tbl456')).toEqual({
        appToken: 'wikiToken001',
        tableId: 'tbl456',
        viewId: undefined,
        isWiki: true,
      });
    });

    it('should normalize URLs without protocol', () => {
      expect(parseBitableUrl('feishu.cn/base/appToken123')).toEqual({
        appToken: 'appToken123',
        tableId: undefined,
        viewId: undefined,
        isWiki: false,
      });
    });
  });

  describe('permission-error', () => {
    it('should detect and format permission violations with auth urls', () => {
      const error = {
        response: {
          data: {
            code: 99991672,
            permission_violations: [{ uri: 'https://open.feishu.cn/auth/1' }, { uri: 'https://open.feishu.cn/auth/2' }],
          },
        },
      };

      expect(isPermissionError(error)).toBe(true);
      expect(JSON.parse(handlePermissionError(error))).toEqual({
        msg: 'Insufficient permissions. Please visit the following links to request access.',
        auth_urls: ['https://open.feishu.cn/auth/1', 'https://open.feishu.cn/auth/2'],
      });
    });

    it('should rethrow non-permission errors', () => {
      const error = { response: { data: { code: 400 } } };

      expect(isPermissionError(error)).toBe(false);
      expect(() => handlePermissionError(error)).toThrow();
    });
  });
});
