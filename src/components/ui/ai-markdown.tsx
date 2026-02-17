import ReactMarkdown from 'react-markdown';
import { AlertTriangle } from 'lucide-react';

/**
 * Renders AI safety warnings from the guardrail system.
 */
export function SafetyWarnings({ warnings }: { warnings?: string[] | null }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <div className="mt-3 rounded-lg border-2 border-amber-400 bg-amber-50 p-3">
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
        <span className="font-semibold text-amber-800 text-sm">安全提醒</span>
      </div>
      <ul className="list-disc pl-5 text-sm text-amber-900 space-y-1">
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Renders AI-generated Markdown content with proper formatting.
 * Replaces raw <pre> rendering that displayed Markdown syntax as plain text.
 */
export function AiMarkdown({ content, className = '' }: { content: string; className?: string }) {
  return (
    <div className={`ai-markdown ${className}`}>
      <ReactMarkdown
        components={{
          h1: ({ children }) => <h2 className="text-lg font-bold mt-3 mb-1">{children}</h2>,
          h2: ({ children }) => <h3 className="text-base font-bold mt-3 mb-1">{children}</h3>,
          h3: ({ children }) => <h4 className="text-sm font-bold mt-2 mb-1">{children}</h4>,
          p: ({ children }) => <p className="mb-2 leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-bold">{children}</strong>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-amber-400 bg-amber-50 pl-3 py-1 my-2 text-sm">
              {children}
            </blockquote>
          ),
          code: ({ children, className: codeClassName }) => {
            const isBlock = codeClassName?.includes('language-');
            if (isBlock) {
              return (
                <pre className="bg-gray-100 rounded p-3 my-2 overflow-x-auto text-sm font-mono">
                  <code>{children}</code>
                </pre>
              );
            }
            return <code className="bg-gray-100 px-1 rounded text-sm font-mono">{children}</code>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
