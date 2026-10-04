/**
 * Decodes an HTTP body using the charset from the Content-Type header, an XML
 * prolog or an HTML <meta charset>. Some Bulgarian sites still serve windows-1251.
 */
export function detectCharset(body: Buffer, contentType: string): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const head = body.subarray(0, 4096).toString('latin1');
  const fromXml = /<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(head)?.[1];
  if (fromXml) return fromXml.toLowerCase();
  const fromMeta =
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ??
    /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(head)?.[1];
  return (fromMeta ?? 'utf-8').toLowerCase();
}

export function decodeBody(body: Buffer, contentType: string): string {
  const charset = detectCharset(body, contentType);
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}
