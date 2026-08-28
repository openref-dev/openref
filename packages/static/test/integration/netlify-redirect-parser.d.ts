/**
 * The slice of `@netlify/redirect-parser` this suite calls, typed here because the package
 * ships JavaScript with no declarations. The shapes are the ones its own README documents for
 * `parseAllRedirects`, narrowed to the fields the assertions read.
 */
declare module '@netlify/redirect-parser' {
  export interface NetlifyParsedRedirect {
    readonly from: string;
    readonly to: string;
    readonly status: number;
    readonly proxy: boolean;
    readonly force: boolean;
  }

  export interface NetlifyParseResult {
    readonly redirects: readonly NetlifyParsedRedirect[];
    readonly errors: readonly Error[];
  }

  export function parseAllRedirects(input: {
    readonly redirectsFiles: readonly string[];
    readonly configRedirects: readonly unknown[];
    readonly minimal: boolean;
  }): Promise<NetlifyParseResult>;
}
