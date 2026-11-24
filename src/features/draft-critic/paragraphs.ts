export interface MarkdownParagraph {
  index: number;
  text: string;
  startOffset: number;
  endOffset: number;
  wordCount: number;
}

/**
 * Split Markdown content into blank-line-separated paragraphs while preserving
 * character offsets for cursor-to-paragraph tracking.
 */
export function splitMarkdownParagraphs(markdown: string): MarkdownParagraph[] {
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (!normalized.trim()) return [];

  const paragraphs: MarkdownParagraph[] = [];
  const separatorRegex = /\n\s*\n/g;
  let cursor = 0;
  let idx = 0;

  const pushSlice = (rawStart: number, rawEnd: number) => {
    const slice = normalized.slice(rawStart, rawEnd);
    const trimmed = slice.trim();
    if (!trimmed) return;
    const leadingSpaces = slice.search(/\S/);
    const startOffset = rawStart + Math.max(0, leadingSpaces);
    const endOffset = startOffset + trimmed.length;
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    paragraphs.push({
      index: idx,
      text: trimmed,
      startOffset,
      endOffset,
      wordCount,
    });
    idx += 1;
  };

  let match: RegExpExecArray | null;
  while ((match = separatorRegex.exec(normalized)) !== null) {
    pushSlice(cursor, match.index);
    cursor = match.index + match[0].length;
  }
  pushSlice(cursor, normalized.length);

  return paragraphs;
}

export function findParagraphIndexAtOffset(
  paragraphs: MarkdownParagraph[],
  offset: number
): number {
  if (paragraphs.length === 0) return 0;
  for (const para of paragraphs) {
    if (offset >= para.startOffset && offset <= para.endOffset) {
      return para.index;
    }
    if (offset < para.startOffset) {
      return para.index;
    }
  }
  return paragraphs[paragraphs.length - 1].index;
}
