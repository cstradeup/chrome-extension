export async function calculateResponseSize(
    url: string,
    method: 'GET' | 'POST',
    headers: Record<string, string>,
    body?: string
): Promise<number> {
    const opts: RequestInit = {method, headers};
    if (body) {
        opts.body = body;
    }
    const response = await fetch(url, opts);

    const statusLine = `HTTP/1.1 ${response.status} ${response.statusText}`;
    let headersSize = statusLine.length + 2; // +2 for CRLF (\r\n)

    response.headers.forEach((value, name) => {
        headersSize += name.length + value.length + 4; // for ": " and "\r\n"
    });

    // Not included in fetch headers, but is in the network response
    headersSize += 'Connection: close'.length + 2;
    headersSize += 'X-N: S'.length + 2;

    // Add the final CRLF that separates the headers from the body.
    headersSize += 2;

    const contentLength = response.headers.get('content-length');

    if (!contentLength) {
        throw new Error('no content length in response headers');
    }

    const bodySize = parseInt(contentLength, 10);

    return headersSize + bodySize;
}

export function calculateRequestSize(
    url: string,
    method: 'GET' | 'POST',
    headers: Record<string, string>,
    body?: string
): number {
    const requestLineSize = new TextEncoder().encode(`${method} ${url} HTTP/1.1\r\n`).length;

    const headersSize = new TextEncoder().encode(
        Object.entries(headers)
            .map(([key, value]) => `${key}: ${value}\r\n`) // CRLF after each header
            .join('')
    ).length;

    const bodySize = body ? new TextEncoder().encode(JSON.stringify(body)).length : 0;

    return requestLineSize + headersSize + 2 + bodySize; // +2 for CRLF after headers
}