const BlockType = {
  PAGE: 1,
  TEXT: 2,
  HEADING1: 3,
  HEADING2: 4,
  HEADING3: 5,
  HEADING4: 6,
  HEADING5: 7,
  HEADING6: 8,
  HEADING7: 9,
  HEADING8: 10,
  HEADING9: 11,
  BULLET: 12,
  ORDERED: 13,
  CODE: 14,
  QUOTE: 15,
  TODO: 17,
  DIVIDER: 22,
  IMAGE: 27,
  TABLE: 31,
  CALLOUT: 34,
  QUOTE_CONTAINER: 36,
} as const;

export interface TextElement {
  text_run?: {
    content: string;
    text_element_style?: {
      bold?: boolean;
      italic?: boolean;
      strikethrough?: boolean;
      underline?: boolean;
      inline_code?: boolean;
      link?: {
        url: string;
      };
    };
  };
  mention_user?: {
    user_id: string;
  };
  mention_doc?: {
    token: string;
    url?: string;
    title?: string;
  };
}

export interface BlockStyle {
  done?: boolean;
  language?: number;
}

export interface Block {
  block_id?: string;
  children?: string[];
  block_type: number;
  page?: { elements?: TextElement[]; style?: BlockStyle };
  text?: { elements?: TextElement[]; style?: BlockStyle };
  heading1?: { elements?: TextElement[]; style?: BlockStyle };
  heading2?: { elements?: TextElement[]; style?: BlockStyle };
  heading3?: { elements?: TextElement[]; style?: BlockStyle };
  heading4?: { elements?: TextElement[]; style?: BlockStyle };
  heading5?: { elements?: TextElement[]; style?: BlockStyle };
  heading6?: { elements?: TextElement[]; style?: BlockStyle };
  heading7?: { elements?: TextElement[]; style?: BlockStyle };
  heading8?: { elements?: TextElement[]; style?: BlockStyle };
  heading9?: { elements?: TextElement[]; style?: BlockStyle };
  bullet?: { elements?: TextElement[]; style?: BlockStyle };
  ordered?: { elements?: TextElement[]; style?: BlockStyle };
  code?: { elements?: TextElement[]; style?: BlockStyle };
  quote?: { elements?: TextElement[]; style?: BlockStyle };
  todo?: { elements?: TextElement[]; style?: BlockStyle };
  image?: { token?: string };
  table?: { cells?: string[]; property?: { row_size?: number; column_size?: number } };
  callout?: { elements?: TextElement[]; style?: BlockStyle };
}

const CODE_LANGUAGE_MAP: Record<number, string> = {
  1: 'plaintext',
  7: 'bash',
  9: 'c',
  10: 'cpp',
  12: 'css',
  22: 'go',
  24: 'html',
  28: 'json',
  29: 'java',
  30: 'javascript',
  38: 'markdown',
  42: 'php',
  47: 'python',
  50: 'ruby',
  51: 'rust',
  54: 'sql',
  59: 'swift',
  61: 'typescript',
  64: 'xml',
  65: 'yaml',
};

function formatTextElement(element: TextElement): string {
  if (element.mention_user) {
    return `@${element.mention_user.user_id}`;
  }

  if (element.mention_doc) {
    const title = element.mention_doc.title || element.mention_doc.token;
    return element.mention_doc.url ? `[${title}](${element.mention_doc.url})` : title;
  }

  if (!element.text_run) return '';

  let text = element.text_run.content;
  const style = element.text_run.text_element_style;
  if (!style) return text;

  if (style.inline_code) return `\`${text}\``;
  if (style.bold) text = `**${text}**`;
  if (style.italic) text = `*${text}*`;
  if (style.strikethrough) text = `~~${text}~~`;
  if (style.link) text = `[${text}](${style.link.url})`;
  return text;
}

function elementsToText(elements?: TextElement[]): string {
  if (!elements?.length) return '';
  return elements.map(formatTextElement).join('');
}

function getBlockContent(block: Block): { elements?: TextElement[]; style?: BlockStyle } | undefined {
  switch (block.block_type) {
    case BlockType.PAGE:
      return block.page;
    case BlockType.TEXT:
      return block.text;
    case BlockType.HEADING1:
      return block.heading1;
    case BlockType.HEADING2:
      return block.heading2;
    case BlockType.HEADING3:
      return block.heading3;
    case BlockType.HEADING4:
      return block.heading4;
    case BlockType.HEADING5:
      return block.heading5;
    case BlockType.HEADING6:
      return block.heading6;
    case BlockType.HEADING7:
      return block.heading7;
    case BlockType.HEADING8:
      return block.heading8;
    case BlockType.HEADING9:
      return block.heading9;
    case BlockType.BULLET:
      return block.bullet;
    case BlockType.ORDERED:
      return block.ordered;
    case BlockType.CODE:
      return block.code;
    case BlockType.QUOTE:
      return block.quote;
    case BlockType.TODO:
      return block.todo;
    case BlockType.CALLOUT:
      return block.callout;
    default:
      return undefined;
  }
}

export function blocksToMarkdown(blocks: Block[], blockMap?: Map<string, Block>): string {
  const map = blockMap ?? new Map<string, Block>();
  if (!blockMap) {
    for (const block of blocks) {
      if (block.block_id) map.set(block.block_id, block);
    }
  }

  const pageBlock = blocks.find((block) => block.block_type === BlockType.PAGE);
  const topLevelIds =
    pageBlock?.children ??
    blocks
      .filter((block) => block.block_type !== BlockType.PAGE)
      .map((block) => block.block_id!)
      .filter(Boolean);

  const lines: string[] = [];
  let orderedCounter = 0;
  let prevType = 0;

  for (const blockId of topLevelIds) {
    const block = map.get(blockId);
    if (!block) continue;
    if (block.block_type !== BlockType.ORDERED && prevType === BlockType.ORDERED) {
      orderedCounter = 0;
    }
    const line = convertBlockToMarkdown(block, map, 0, orderedCounter);
    if (line !== null) lines.push(line);
    if (block.block_type === BlockType.ORDERED) {
      orderedCounter += 1;
    }
    prevType = block.block_type;
  }

  return lines.join('\n');
}

function convertBlockToMarkdown(
  block: Block,
  blockMap: Map<string, Block>,
  depth: number,
  orderedIndex: number,
): string | null {
  const content = getBlockContent(block);
  const text = elementsToText(content?.elements);
  const indent = '  '.repeat(depth);

  switch (block.block_type) {
    case BlockType.PAGE:
      return null;
    case BlockType.TEXT:
      return `${indent}${text}`;
    case BlockType.HEADING1:
      return `${indent}# ${text}`;
    case BlockType.HEADING2:
      return `${indent}## ${text}`;
    case BlockType.HEADING3:
      return `${indent}### ${text}`;
    case BlockType.HEADING4:
      return `${indent}#### ${text}`;
    case BlockType.HEADING5:
      return `${indent}##### ${text}`;
    case BlockType.HEADING6:
    case BlockType.HEADING7:
    case BlockType.HEADING8:
    case BlockType.HEADING9:
      return `${indent}###### ${text}`;
    case BlockType.BULLET: {
      const childLines = convertChildren(block, blockMap, depth + 1);
      const line = `${indent}- ${text || extractChildText(block, blockMap)}`;
      return childLines ? `${line}\n${childLines}` : line;
    }
    case BlockType.ORDERED: {
      const childLines = convertChildren(block, blockMap, depth + 1);
      const line = `${indent}${orderedIndex + 1}. ${text || extractChildText(block, blockMap)}`;
      return childLines ? `${line}\n${childLines}` : line;
    }
    case BlockType.CODE: {
      const language = CODE_LANGUAGE_MAP[content?.style?.language ?? 1] ?? '';
      return `${indent}\`\`\`${language}\n${text}\n${indent}\`\`\``;
    }
    case BlockType.QUOTE: {
      const quoteLines = text
        .split('\n')
        .map((line) => `${indent}> ${line}`)
        .join('\n');
      const childLines = convertQuoteChildren(block, blockMap, depth);
      return childLines ? `${quoteLines}\n${childLines}` : quoteLines;
    }
    case BlockType.TODO:
      return `${indent}- ${content?.style?.done ? '[x]' : '[ ]'} ${text}`;
    case BlockType.DIVIDER:
      return `${indent}---`;
    case BlockType.IMAGE:
      return `${indent}![image](${block.image?.token ?? ''})`;
    case BlockType.TABLE:
      return convertTable(block, blockMap, indent);
    case BlockType.CALLOUT: {
      const childLines = convertQuoteChildren(block, blockMap, depth);
      const line = text ? `${indent}> ${text}` : '';
      return childLines ? `${line}\n${childLines}` : line;
    }
    case BlockType.QUOTE_CONTAINER:
      return convertQuoteChildren(block, blockMap, depth);
    default:
      return text ? `${indent}${text}` : null;
  }
}

function convertChildren(block: Block, blockMap: Map<string, Block>, depth: number): string | null {
  if (!block.children?.length) return null;

  const lines: string[] = [];
  let orderedCounter = 0;
  for (const childId of block.children) {
    const child = blockMap.get(childId);
    if (!child) continue;
    const line = convertBlockToMarkdown(child, blockMap, depth, orderedCounter);
    if (line !== null) lines.push(line);
    orderedCounter = child.block_type === BlockType.ORDERED ? orderedCounter + 1 : 0;
  }
  return lines.length ? lines.join('\n') : null;
}

function convertQuoteChildren(block: Block, blockMap: Map<string, Block>, depth: number): string | null {
  if (!block.children?.length) return null;

  const indent = '  '.repeat(depth);
  const lines = block.children
    .map((childId) => blockMap.get(childId))
    .filter(Boolean)
    .map((child) => elementsToText(getBlockContent(child as Block)?.elements))
    .filter(Boolean)
    .map((line) => `${indent}> ${line}`);

  return lines.length ? lines.join('\n') : null;
}

function convertTable(block: Block, blockMap: Map<string, Block>, indent: string): string | null {
  const property = block.table?.property;
  if (!property?.row_size || !property?.column_size) return null;

  const cells = block.children ?? block.table?.cells ?? [];
  const rows: string[][] = [];
  for (let rowIndex = 0; rowIndex < property.row_size; rowIndex += 1) {
    const row: string[] = [];
    for (let colIndex = 0; colIndex < property.column_size; colIndex += 1) {
      const cellId = cells[rowIndex * property.column_size + colIndex];
      const cellBlock = cellId ? blockMap.get(cellId) : undefined;
      if (!cellBlock?.children?.length) {
        row.push('');
        continue;
      }
      const cellText = cellBlock.children
        .map((childId) => blockMap.get(childId))
        .filter(Boolean)
        .map((child) => elementsToText(getBlockContent(child as Block)?.elements))
        .filter(Boolean)
        .join(' ');
      row.push(cellText);
    }
    rows.push(row);
  }

  if (!rows.length) return null;
  const header = rows[0];
  const lines = [`${indent}| ${header.join(' | ')} |`, `${indent}| ${header.map(() => '---').join(' | ')} |`];
  for (let index = 1; index < rows.length; index += 1) {
    lines.push(`${indent}| ${rows[index].join(' | ')} |`);
  }
  return lines.join('\n');
}

function extractChildText(block: Block, blockMap: Map<string, Block>): string {
  if (!block.children?.length) return '';
  return block.children
    .map((childId) => blockMap.get(childId))
    .filter(Boolean)
    .map((child) => elementsToText(getBlockContent(child as Block)?.elements))
    .filter(Boolean)
    .join(' ');
}
