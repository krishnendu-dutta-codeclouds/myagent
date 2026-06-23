import { useState } from 'react';

/**
 * Parses markdown into tokens of text and code blocks.
 * Supports streaming/unfinished blocks.
 */
function parseMarkdown(text) {
  if (!text) return [];

  const tokens = [];
  const lines = text.split('\n');

  let inCodeBlock = false;
  let currentLanguage = '';
  let currentCodeLines = [];

  let inDetails = false;
  let detailsSummary = '';
  let detailsLines = [];

  let currentTextLines = [];

  const flushText = () => {
    if (currentTextLines.length > 0) {
      tokens.push({
        type: 'text',
        content: currentTextLines.join('\n'),
      });
      currentTextLines = [];
    }
  };

  const flushCode = () => {
    if (inCodeBlock) {
      tokens.push({
        type: 'code',
        language: currentLanguage || 'plaintext',
        content: currentCodeLines.join('\n'),
      });
      currentCodeLines = [];
    }
  };

  const flushDetails = () => {
    if (inDetails) {
      tokens.push({
        type: 'details',
        summary: detailsSummary || 'Thinking Process',
        content: detailsLines.join('\n'),
      });
      detailsLines = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (inCodeBlock) {
      if (trimmed.startsWith('```')) {
        flushCode();
        inCodeBlock = false;
      } else {
        currentCodeLines.push(line);
      }
    } else if (inDetails) {
      if (trimmed.startsWith('</details>')) {
        flushDetails();
        inDetails = false;
      } else if (trimmed.startsWith('<summary>') || trimmed.includes('</summary>')) {
        const summaryMatch = line.match(/<summary>(.*?)<\/summary>/i);
        if (summaryMatch) {
          detailsSummary = summaryMatch[1];
        } else {
          const clean = line.replace(/<\/?summary>/gi, '').trim();
          if (clean) detailsSummary = clean;
        }
      } else {
        detailsLines.push(line);
      }
    } else {
      if (trimmed.startsWith('```')) {
        flushText();
        inCodeBlock = true;
        currentLanguage = trimmed.slice(3).trim();
      } else if (trimmed.startsWith('<details')) {
        flushText();
        inDetails = true;
        const summaryMatch = line.match(/<summary>(.*?)<\/summary>/i);
        detailsSummary = summaryMatch ? summaryMatch[1] : 'Thinking Process';
        detailsLines = [];
      } else {
        currentTextLines.push(line);
      }
    }
  }

  if (inCodeBlock) {
    flushCode();
  } else if (inDetails) {
    flushDetails();
  } else {
    flushText();
  }

  return tokens;
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Robust token-based syntax highlighter for HTML, CSS, and JS code.
 */
function highlightCode(code, lang) {
  if (!code) return '';
  const l = lang.toLowerCase();

  if (l === 'html' || l === 'xml' || l === 'svg') {
    const tokenRegex = /(<!--[\s\S]*?-->)|(<[^>]+>)|([^<]+)|(.)/g;
    let html = '';
    let match;
    while ((match = tokenRegex.exec(code)) !== null) {
      const [lexeme, comment, tag, text, fallback] = match;
      if (comment) {
        html += `<span class="hl-comment">${escapeHtml(comment)}</span>`;
      } else if (tag) {
        const tagContent = tag.slice(1, -1);
        const isClosing = tagContent.startsWith('/');
        const content = isClosing ? tagContent.slice(1) : tagContent;
        
        const parts = content.split(/(\s+)/);
        const tagName = parts[0];
        
        let highlightedTag = isClosing ? '&lt;/' : '&lt;';
        highlightedTag += `<span class="hl-tag">${escapeHtml(tagName)}</span>`;
        
        for (let i = 1; i < parts.length; i++) {
          const part = parts[i];
          if (part.includes('=')) {
            const attrParts = part.split(/(=)/);
            const attrName = attrParts[0];
            const attrVal = attrParts.slice(2).join('');
            highlightedTag += `<span class="hl-attr">${escapeHtml(attrName)}</span>=`;
            if ((attrVal.startsWith('"') && attrVal.endsWith('"')) || (attrVal.startsWith("'") && attrVal.endsWith("'"))) {
              highlightedTag += `<span class="hl-string">${escapeHtml(attrVal)}</span>`;
            } else {
              highlightedTag += escapeHtml(attrVal);
            }
          } else {
            highlightedTag += escapeHtml(part);
          }
        }
        highlightedTag += '&gt;';
        html += highlightedTag;
      } else if (text) {
        html += escapeHtml(text);
      } else if (fallback) {
        html += escapeHtml(fallback);
      }
    }
    return html;
  }

  if (l === 'css') {
    const tokenRegex = /(\/\*[\s\S]*?\*\/)|([^{}\n]+)(?=\s*\{)|([a-zA-Z0-9-]+)(?=\s*:)|(:\s*[^;\n}]+)|([\s\S])/g;
    let html = '';
    let match;
    while ((match = tokenRegex.exec(code)) !== null) {
      const [lexeme, comment, selector, property, value, fallback] = match;
      if (comment) {
        html += `<span class="hl-comment">${escapeHtml(comment)}</span>`;
      } else if (selector) {
        html += `<span class="hl-selector">${escapeHtml(selector)}</span>`;
      } else if (property) {
        html += `<span class="hl-property">${escapeHtml(property)}</span>`;
      } else if (value) {
        const valHtml = escapeHtml(value).replace(/("[^"]*"|'[^']*')/g, '<span class="hl-string">$1</span>');
        html += valHtml;
      } else {
        html += escapeHtml(fallback);
      }
    }
    return html;
  }

  if (l === 'js' || l === 'jsx' || l === 'javascript' || l === 'ts' || l === 'tsx' || l === 'json') {
    const tokenRegex = /(\/\/.*)|(\/\*[\s\S]*?\*\/)|("(\\.|[^"])*")|('(\\.|[^'])*')|(`(\\.|[^`])*`)|(\b(const|let|var|function|return|import|export|from|default|class|extends|if|else|for|while|new|try|catch|finally|async|await|throw|typeof|instanceof)\b)|(\b(true|false|null|undefined|NaN|document|window|console)\b)|(\b\d+\b)|([^"'/`\w]+|[\w]+)/g;
    let html = '';
    let match;
    while ((match = tokenRegex.exec(code)) !== null) {
      const [lexeme, lineComment, blockComment, doubleStr, singleStr, backtickStr, keyword, builtin, number] = match;
      if (lineComment || blockComment) {
        html += `<span class="hl-comment">${escapeHtml(lexeme)}</span>`;
      } else if (doubleStr || singleStr || backtickStr) {
        html += `<span class="hl-string">${escapeHtml(lexeme)}</span>`;
      } else if (keyword) {
        html += `<span class="hl-keyword">${escapeHtml(lexeme)}</span>`;
      } else if (builtin) {
        html += `<span class="hl-builtin">${escapeHtml(lexeme)}</span>`;
      } else if (number) {
        html += `<span class="hl-number">${escapeHtml(lexeme)}</span>`;
      } else {
        html += escapeHtml(lexeme);
      }
    }
    return html;
  }

  return escapeHtml(code);
}

/**
 * Inline text renderer supporting bold and inline code.
 */
function InlineText({ content }) {
  if (!content) return null;
  const parts = content.split(/(\*\*.*?\*\*|`.*?`)/g);

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code className="md-inline-code" key={index}>
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

/**
 * Text block renderer supporting paragraphs and lists.
 */
function TextBlockRenderer({ text }) {
  const lines = text.split('\n');
  const blocks = [];
  let currentList = null;

  const flushList = () => {
    if (currentList) {
      blocks.push(currentList);
      currentList = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.*)/);
    const olMatch = line.match(/^(\s*)\d+\.\s+(.*)/);

    if (ulMatch) {
      if (!currentList || currentList.type !== 'ul') {
        flushList();
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(ulMatch[2]);
    } else if (olMatch) {
      if (!currentList || currentList.type !== 'ol') {
        flushList();
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push(olMatch[2]);
    } else {
      flushList();
      if (line.trim() !== '') {
        blocks.push({ type: 'p', content: line });
      }
    }
  }
  flushList();

  return (
    <>
      {blocks.map((block, index) => {
        if (block.type === 'ul') {
          return (
            <ul key={index} className="md-ul">
              {block.items.map((item, idx) => (
                <li key={idx}>
                  <InlineText content={item} />
                </li>
              ))}
            </ul>
          );
        }
        if (block.type === 'ol') {
          return (
            <ol key={index} className="md-ol">
              {block.items.map((item, idx) => (
                <li key={idx}>
                  <InlineText content={item} />
                </li>
              ))}
            </ol>
          );
        }
        return (
          <p key={index} className="md-p">
            <InlineText content={block.content} />
          </p>
        );
      })}
    </>
  );
}

/**
 * Code block with header bar, copy button, and syntax highlighting.
 */
function CodeBlock({ code, language }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const highlightedHtml = highlightCode(code, language);

  return (
    <div className="md-code-block">
      <div className="md-code-header">
        <span className="md-code-lang">{language}</span>
        <button className="md-code-copy" onClick={handleCopy}>
          {copied ? (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--ok)' }}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Copied!</span>
            </>
          ) : (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>Copy code</span>
            </>
          )}
        </button>
      </div>
      <div className="md-code-body">
        <pre>
          <code
            dangerouslySetInnerHTML={{ __html: highlightedHtml || code }}
          />
        </pre>
      </div>
    </div>
  );
}

function DetailsBlock({ summary, content }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="md-details" open={open} onToggle={(e) => setOpen(e.target.open)}>
      <summary className="md-summary">
        <span className="md-summary-icon">{open ? '▼' : '▶'}</span>
        {summary}
      </summary>
      <div className="md-details-content">
        <MarkdownRenderer text={content} />
      </div>
    </details>
  );
}

/**
 * Main Markdown renderer component.
 */
export default function MarkdownRenderer({ text }) {
  const tokens = parseMarkdown(text);

  return (
    <div className="markdown-body">
      {tokens.map((token, index) => {
        if (token.type === 'code') {
          return (
            <CodeBlock
              key={index}
              code={token.content}
              language={token.language}
            />
          );
        }
        if (token.type === 'details') {
          return (
            <DetailsBlock
              key={index}
              summary={token.summary}
              content={token.content}
            />
          );
        }
        return <TextBlockRenderer key={index} text={token.content} />;
      })}
    </div>
  );
}
