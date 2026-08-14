/**
 * Which class an HTTP status code takes.
 *
 * ONE HOME, BECAUSE TWO COLUMNS SHOW THE SAME CODE. The responses the specification documents
 * and the error contracts the application declares stand side by side on an operation page, and
 * a 404 that is one colour on the left and another on the right would say the two are different
 * kinds of thing. It lives here rather than in either of them because one caller is the page
 * model, which runs only on the server, and the other is a component, which runs in both places.
 */

/**
 * @param status - Status code as a string, which is how a document writes it
 * @returns The class name, `oref-status-default` for anything that is not 1xx to 5xx
 */
export function statusClass(status: string): string {
  const first = status.slice(0, 1);

  return /^[1-5]$/.test(first) ? `oref-status-${first}xx` : 'oref-status-default';
}

/**
 * Reason phrases of the IANA status code registry, for the compact response row of
 * `TX-PARITY-UI`.
 *
 * THE LIST IS THE REGISTRY'S AND A CODE OUTSIDE IT GETS AN EMPTY PHRASE, never a guess: the
 * row then carries the code and the document's own description, which is everything the page
 * actually knows. It runs on the server only, in the page model builder, so the table costs
 * the client bundle nothing.
 */
const REASON_PHRASES: Readonly<Record<string, string>> = {
  '100': 'Continue',
  '101': 'Switching Protocols',
  '200': 'OK',
  '201': 'Created',
  '202': 'Accepted',
  '203': 'Non-Authoritative Information',
  '204': 'No Content',
  '205': 'Reset Content',
  '206': 'Partial Content',
  '207': 'Multi-Status',
  '208': 'Already Reported',
  '226': 'IM Used',
  '300': 'Multiple Choices',
  '301': 'Moved Permanently',
  '302': 'Found',
  '303': 'See Other',
  '304': 'Not Modified',
  '307': 'Temporary Redirect',
  '308': 'Permanent Redirect',
  '400': 'Bad Request',
  '401': 'Unauthorized',
  '402': 'Payment Required',
  '403': 'Forbidden',
  '404': 'Not Found',
  '405': 'Method Not Allowed',
  '406': 'Not Acceptable',
  '407': 'Proxy Authentication Required',
  '408': 'Request Timeout',
  '409': 'Conflict',
  '410': 'Gone',
  '411': 'Length Required',
  '412': 'Precondition Failed',
  '413': 'Content Too Large',
  '414': 'URI Too Long',
  '415': 'Unsupported Media Type',
  '416': 'Range Not Satisfiable',
  '417': 'Expectation Failed',
  '421': 'Misdirected Request',
  '422': 'Unprocessable Content',
  '423': 'Locked',
  '424': 'Failed Dependency',
  '425': 'Too Early',
  '426': 'Upgrade Required',
  '428': 'Precondition Required',
  '429': 'Too Many Requests',
  '431': 'Request Header Fields Too Large',
  '451': 'Unavailable For Legal Reasons',
  '500': 'Internal Server Error',
  '501': 'Not Implemented',
  '502': 'Bad Gateway',
  '503': 'Service Unavailable',
  '504': 'Gateway Timeout',
  '505': 'HTTP Version Not Supported',
  '506': 'Variant Also Negotiates',
  '507': 'Insufficient Storage',
  '508': 'Loop Detected',
  '511': 'Network Authentication Required',
};

/**
 * @param status - Status code as a string, `default` and ranges included
 * @returns The registry's phrase, or empty for a code it does not list
 */
export function reasonPhrase(status: string): string {
  return REASON_PHRASES[status] ?? '';
}
