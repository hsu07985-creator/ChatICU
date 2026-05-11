import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Renders AI safety warnings from the guardrail system.
 */
export function SafetyWarnings({ warnings }: { warnings?: string[] | null }) {
  const { t } = useTranslation('chat');
  if (!warnings || warnings.length === 0) return null;
  return (
    <div className="mt-3 rounded-lg border border-amber-400 bg-amber-50 dark:bg-amber-950 dark:border-amber-600 p-3">
      <div className="flex items-center gap-2 mb-1">
        <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
        <span className="font-semibold text-amber-800 text-sm">{t('aiMarkdown.safetyWarning')}</span>
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
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h2 className="text-lg font-bold mt-3 mb-1">{children}</h2>,
          h2: ({ children }) => <h3 className="text-base font-bold mt-3 mb-1">{children}</h3>,
          h3: ({ children }) => <h4 className="text-sm font-bold mt-2 mb-1">{children}</h4>,
          p: ({ children }) => <p className="mb-2 leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-1.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-1.5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-bold">{children}</strong>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-amber-400 bg-amber-50 dark:bg-amber-950 dark:border-amber-600 pl-3 py-1 my-2 text-sm">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
              <table className="min-w-full border-collapse text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-amber-50 dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="[&>tr:nth-child(even)]:bg-gray-50 dark:[&>tr:nth-child(even)]:bg-slate-800/40">
              {children}
            </tbody>
          ),
          tr: ({ children }) => (
            <tr className="border-b border-gray-100 dark:border-slate-700/60 last:border-b-0">
              {children}
            </tr>
          ),
          th: ({ children }) => (
            <th className="px-4 py-2.5 text-left font-semibold text-gray-900 dark:text-slate-100 align-top">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-4 py-2.5 align-top leading-relaxed text-gray-800 dark:text-slate-200 break-words">
              {children}
            </td>
          ),
          code: ({ children, className: codeClassName }) => {
            const isBlock = codeClassName?.includes('language-');
            if (isBlock) {
              return (
                <pre className="bg-gray-100 dark:bg-slate-800 rounded p-3 my-2 overflow-x-auto text-sm font-mono">
                  <code>{children}</code>
                </pre>
              );
            }
            return <code className="bg-gray-100 dark:bg-slate-800 px-1 rounded text-sm font-mono">{children}</code>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
