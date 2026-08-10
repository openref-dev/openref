/**
 * Markdown from a specification description, turned into HTML that is safe to insert.
 *
 * The order is fixed and is the whole point: render, then sanitize. `marked` passes raw
 * HTML through by design, so its output is untrusted no matter how trusted the markdown
 * looked. SPEC 19.1 calls for sanitization rather than escaping, so HTML written in a
 * description keeps working, and every byte of it goes through the sanitizer.
 */

import { Marked } from 'marked';
import { plainHighlighter, type IHighlighter } from '../../highlight/domain/highlight';
import { sanitizeHtml } from './sanitize';

/** How a description is turned into HTML. */
export interface MarkdownOptions {
  /** Highlighter for fenced code blocks. Defaults to escaping without colour. */
  readonly highlighter?: IHighlighter;
}

/** Renders one description at a time, holding the configured `marked` instance. */
export interface IMarkdownRenderer {
  /**
   * @param markdown - Description as written in the specification, possibly undefined
   * @returns Sanitized HTML, empty when there is nothing to render
   */
  render(markdown: string | undefined): string;
  /** Renders a fenced block on its own, for an example that is not part of prose. */
  renderCode(code: string, language: string | undefined): string;
}

/**
 * Builds a markdown renderer.
 *
 * `marked` is configured without `gfm` heading ids and without `mangle`, both of which add
 * non determinism or transform link text. Rendering is synchronous: an async renderer
 * would make the page model depend on scheduling, and the page model feeds the hash keyed
 * cache.
 *
 * @param options - Highlighter to use for fenced blocks
 * @returns A renderer whose output is already sanitized
 */
export function createMarkdownRenderer(options: MarkdownOptions = {}): IMarkdownRenderer {
  const highlighter = options.highlighter ?? plainHighlighter;

  const marked = new Marked({
    async: false,
    gfm: true,
    breaks: false,
    pedantic: false,
    renderer: {
      code({ text, lang }): string {
        const language = lang === undefined || lang.trim() === '' ? undefined : lang.trim();
        return highlighter.highlight(text, language);
      },
    },
  });

  return {
    render(markdown): string {
      if (markdown === undefined || markdown.trim() === '') return '';

      const html = marked.parse(markdown, { async: false });
      return sanitizeHtml(html);
    },

    renderCode(code, language): string {
      return sanitizeHtml(highlighter.highlight(code, language));
    },
  };
}
