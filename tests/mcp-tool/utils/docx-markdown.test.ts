import {
  applyMarkdownUpdate,
  parseMarkdownToDocxBlocks,
  resolveDocxDocumentId,
  updateDocxTitle,
} from '../../../src/mcp-tool/utils/docx-markdown';

describe('docx markdown utils', () => {
  describe('resolveDocxDocumentId', () => {
    it('should keep a plain document token unchanged', () => {
      expect(resolveDocxDocumentId('doxcn123ABC')).toBe('doxcn123ABC');
    });

    it('should parse a docx URL', () => {
      expect(resolveDocxDocumentId('https://feishu.cn/docx/doxcn123ABC')).toBe('doxcn123ABC');
    });

    it('should parse a docs URL without protocol', () => {
      expect(resolveDocxDocumentId('feishu.cn/docs/doxcnXYZ789')).toBe('doxcnXYZ789');
    });

    it('should parse a wiki URL token', () => {
      expect(resolveDocxDocumentId('https://feishu.cn/wiki/wikcnXYZ789')).toBe('wikcnXYZ789');
    });
  });

  describe('updateDocxTitle', () => {
    it('should update title through wiki binding when the docx is mounted in wiki', async () => {
      const getNode = jest
        .fn()
        .mockResolvedValueOnce({
          data: {
            node: {
              obj_type: 'docx',
              obj_token: 'doxcn123ABC',
              space_id: 'space_001',
              node_token: 'wiki_001',
              title: 'Old Title',
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            node: {
              obj_type: 'docx',
              obj_token: 'doxcn123ABC',
              space_id: 'space_001',
              node_token: 'wiki_001',
              title: 'Old Title',
            },
          },
        });
      const updateTitle = jest.fn().mockResolvedValue({ data: {} });
      const client = {
        wiki: {
          space: { getNode },
          spaceNode: { updateTitle },
        },
      } as any;

      const result = await updateDocxTitle(client, 'https://feishu.cn/docx/doxcn123ABC', 'New Title');

      expect(updateTitle).toHaveBeenCalledWith({
        path: { space_id: 'space_001', node_token: 'wiki_001' },
        data: { title: 'New Title' },
      });
      expect(result).toEqual({
        documentId: 'doxcn123ABC',
        title: 'New Title',
        updated: true,
        via: 'wiki',
        wikiNode: {
          spaceId: 'space_001',
          nodeToken: 'wiki_001',
        },
      });
    });

    it('should report unsupported when the docx has no wiki binding', async () => {
      const client = {
        wiki: {
          space: { getNode: jest.fn().mockResolvedValue(undefined) },
          spaceNode: { updateTitle: jest.fn() },
        },
      } as any;

      const result = await updateDocxTitle(client, 'doxcn123ABC', 'Standalone Title');

      expect(result).toEqual({
        documentId: 'doxcn123ABC',
        title: 'Standalone Title',
        updated: false,
        via: 'unsupported',
      });
      expect(client.wiki.spaceNode.updateTitle).not.toHaveBeenCalled();
    });
  });

  describe('applyMarkdownUpdate', () => {
    const baseMarkdown = ['# Title', '## Section A', 'Alpha', '## Section B', 'Beta'].join('\n\n');

    it('should append Markdown with a blank line separator', () => {
      expect(
        applyMarkdownUpdate(baseMarkdown, {
          mode: 'append',
          markdown: '## Section C\n\nGamma',
        }),
      ).toBe(['# Title', '## Section A', 'Alpha', '## Section B', 'Beta', '## Section C\n\nGamma'].join('\n\n'));
    });

    it('should replace a heading range', () => {
      expect(
        applyMarkdownUpdate(baseMarkdown, {
          mode: 'replace_range',
          markdown: '## Section B\n\nBeta updated',
          selection_by_title: '## Section B',
        }),
      ).toBe(['# Title', '## Section A', 'Alpha', '## Section B', 'Beta updated'].join('\n\n'));
    });

    it('should insert after an ellipsis range', () => {
      expect(
        applyMarkdownUpdate(baseMarkdown, {
          mode: 'insert_after',
          markdown: 'Inserted paragraph',
          selection_with_ellipsis: 'Alpha...## Section B',
        }),
      ).toBe(['# Title', '## Section A', 'Alpha\n\n## Section B', 'Inserted paragraph', 'Beta'].join('\n\n'));
    });

    it('should delete a heading range', () => {
      expect(
        applyMarkdownUpdate(baseMarkdown, {
          mode: 'delete_range',
          selection_by_title: '## Section A',
        }),
      ).toBe(['# Title', '## Section B', 'Beta'].join('\n\n'));
    });
  });

  describe('parseMarkdownToDocxBlocks', () => {
    it('should map common Markdown structures to docx blocks', () => {
      const markdown = [
        '# Heading',
        '',
        'Paragraph with **bold** text',
        '',
        '- [x] Done item',
        '- Bullet item',
        '1. Ordered item',
        '> Quoted line',
        '---',
        '```ts',
        'const value = 1;',
        '```',
      ].join('\n');

      const blocks = parseMarkdownToDocxBlocks(markdown);

      expect(blocks.map((block) => block.block_type)).toEqual([3, 2, 17, 12, 13, 15, 22, 14]);
      expect(blocks[1].text?.elements[1].text_run?.text_element_style?.bold).toBe(true);
      expect(blocks[2].todo?.style?.done).toBe(true);
      expect(blocks[7].code?.style?.language).toBe(63);
      expect(blocks[7].code?.elements[0].text_run?.content).toBe('const value = 1;');
    });
  });
});
