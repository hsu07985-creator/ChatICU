const TABLE_SEPARATOR = /\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|/;

export function normalizeAiMarkdown(content: string) {
  let inCodeFence = false;

  return content
    .split(/(^[ \t]*(?:`{3,}|~{3,})[^\n]*$)/gm)
    .map((part) => {
      if (/^[ \t]*(?:`{3,}|~{3,})/.test(part)) {
        inCodeFence = !inCodeFence;
        return part;
      }
      if (inCodeFence || !TABLE_SEPARATOR.test(part)) return part;

      return part
        .split('\n')
        .map((line) => (
          TABLE_SEPARATOR.test(line)
            ? line.replace(/\|[ \t]*\|/g, '|\n|')
            : line
        ))
        .join('\n')
        .replace(/(^[ \t]*\|[^\n]*\|)[ \t]*\n(?:[ \t]*\n)+(?=[ \t]*\|)/gm, '$1\n');
    })
    .join('');
}
