import type { Data, DataItem } from '../types.js';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cdataWrap(str: string): string {
  return `<![CDATA[${str.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

function renderItem(item: DataItem): string {
  const parts: string[] = ['<item>'];

  if (item.title) parts.push(`<title>${cdataWrap(item.title)}</title>`);
  if (item.link) parts.push(`<link>${escapeXml(item.link)}</link>`);
  if (item.description) parts.push(`<description>${cdataWrap(item.description)}</description>`);
  if (item.pubDate) {
    const d = item.pubDate instanceof Date ? item.pubDate : new Date(item.pubDate);
    parts.push(`<pubDate>${d.toUTCString()}</pubDate>`);
  }
  if (item.guid) {
    parts.push(`<guid isPermaLink="false">${escapeXml(item.guid)}</guid>`);
  } else if (item.link) {
    parts.push(`<guid isPermaLink="false">${escapeXml(item.link)}</guid>`);
  }
  if (item.author) parts.push(`<author>${cdataWrap(item.author)}</author>`);
  if (item.category) {
    for (const cat of item.category) {
      parts.push(`<category>${cdataWrap(cat)}</category>`);
    }
  }

  parts.push('</item>');
  return parts.join('');
}

export function renderRSS(data: Data, selfLink?: string): string {
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss xmlns:atom="http://www.w3.org/2005/Atom" version="2.0">',
    '<channel>',
  ];

  parts.push(`<title>${cdataWrap(data.title)}</title>`);
  if (data.link) parts.push(`<link>${escapeXml(data.link)}</link>`);
  if (selfLink) {
    parts.push(`<atom:link href="${escapeXml(selfLink)}" rel="self" type="application/rss+xml"/>`);
  }
  parts.push(`<description>${cdataWrap(data.description || `${data.title} - Powered by OpenRSS`)}</description>`);
  parts.push('<generator>OpenRSS</generator>');
  if (data.language) parts.push(`<language>${data.language}</language>`);
  if (data.image) {
    parts.push(`<image><url>${escapeXml(data.image)}</url><title>${cdataWrap(data.title)}</title>${data.link ? `<link>${escapeXml(data.link)}</link>` : ''}</image>`);
  }
  parts.push(`<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>`);
  parts.push('<ttl>5</ttl>');

  if (data.item) {
    for (const item of data.item) {
      parts.push(renderItem(item));
    }
  }

  parts.push('</channel>');
  parts.push('</rss>');

  return parts.join('\n');
}
