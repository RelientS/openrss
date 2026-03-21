#!/bin/bash
# Refresh ByteTech OpenClaw RSS feed via Chrome CDP WebSocket
# Requires Chrome running with --remote-debugging-port (or DevToolsActivePort)
# Usage: ./refresh-bytetech-openclaw.sh

set -e

FEED_DIR="$(dirname "$0")/../static"
mkdir -p "$FEED_DIR"
OUTPUT="$FEED_DIR/bytetech-openclaw-topics.xml"

# Read Chrome's DevTools WebSocket endpoint
CHROME_DIR="$HOME/Library/Application Support/Google/Chrome"
PORT_FILE="$CHROME_DIR/DevToolsActivePort"

if [ ! -f "$PORT_FILE" ]; then
  echo "Error: Chrome DevToolsActivePort not found. Is Chrome running with remote debugging?"
  exit 1
fi

PORT=$(head -1 "$PORT_FILE")
WS_PATH=$(tail -1 "$PORT_FILE")
WS_URL="ws://127.0.0.1:${PORT}${WS_PATH}"

echo "Connecting to Chrome at $WS_URL..."

# Use Node.js to connect to Chrome, navigate to bytetech, and extract feed
/Users/bytedance/.nvm/versions/node/v22.14.0/bin/node -e "
const WebSocket = require('/tmp/node_modules/ws');
const fs = require('fs');

const ws = new WebSocket('$WS_URL');
const timeout = setTimeout(() => { console.error('Timeout'); process.exit(1); }, 30000);
let msgId = 1;
let sessionId;
let targetId;

ws.on('open', () => {
  // Create a new tab for bytetech
  ws.send(JSON.stringify({id: msgId++, method: 'Target.createTarget', params: {url: 'https://bytetech.info/topic'}}));
});

ws.on('message', async (d) => {
  const resp = JSON.parse(d.toString());

  if (resp.id === 1) {
    targetId = resp.result.targetId;
    ws.send(JSON.stringify({id: msgId++, method: 'Target.attachToTarget', params: {targetId, flatten: true}}));
  } else if (resp.id === 2) {
    sessionId = resp.result.sessionId;
    // Wait for page to load
    ws.send(JSON.stringify({id: msgId++, method: 'Page.enable', sessionId}));
    ws.send(JSON.stringify({id: msgId++, method: 'Network.enable', sessionId}));
  } else if (resp.method === 'Page.loadEventFired') {
    // Page loaded, wait a bit then extract
    setTimeout(() => {
      const script = \`(async () => {
        const resp = await fetch('/proxy_tech_api/v1/content/topic/feed', {
          method: 'POST',
          headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
          body: JSON.stringify({sort: 2, cursor: '1', limit: 50, application_id: '7613691314101649454'})
        });
        const data = await resp.json();
        const items = data.data.topic_infos.map(info => {
          const topic = info.topic;
          const author = info.author || {};
          const html = topic.html_content || '';
          const div = document.createElement('div');
          div.innerHTML = html;
          const text = div.textContent.trim();
          const titleText = text.replace(/#[^#]+#/g, '').replace(/◆\\\\S+/g, '').trim();
          return {
            title: (titleText.substring(0, 120) || 'Untitled').replace(/\\\\n/g, ' '),
            link: 'https://bytetech.info/topic/' + topic.msg_id,
            author: author.name || author.en_name || '',
            pubDate: new Date(topic.ctime * 1000).toISOString(),
            description: text.substring(0, 800)
          };
        });
        return JSON.stringify(items);
      })()\`;
      ws.send(JSON.stringify({id: msgId++, method: 'Runtime.evaluate', sessionId, params: {expression: script, awaitPromise: true}}));
    }, 3000);
  } else if (resp.id >= 5 && resp.result && resp.result.result && resp.result.result.value) {
    const items = JSON.parse(resp.result.result.value);

    const escXml = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    let rss = '<?xml version=\"1.0\" encoding=\"UTF-8\"?>\\n<rss version=\"2.0\">\\n<channel>\\n';
    rss += '<title>ByteTech - OpenClaw Topics</title>\\n';
    rss += '<link>https://bytetech.info/topic</link>\\n';
    rss += '<description>ByteTech 话题广场 - OpenClaw 产品相关讨论</description>\\n';
    rss += '<lastBuildDate>' + new Date().toUTCString() + '</lastBuildDate>\\n';

    for (const item of items) {
      rss += '<item>\\n';
      rss += '<title>' + escXml(item.title) + '</title>\\n';
      rss += '<link>' + escXml(item.link) + '</link>\\n';
      rss += '<author>' + escXml(item.author) + '</author>\\n';
      rss += '<pubDate>' + new Date(item.pubDate).toUTCString() + '</pubDate>\\n';
      rss += '<description><![CDATA[' + item.description + ']]></description>\\n';
      rss += '<guid>' + escXml(item.link) + '</guid>\\n';
      rss += '</item>\\n';
    }
    rss += '</channel>\\n</rss>';

    fs.writeFileSync('$OUTPUT', rss);
    console.log('RSS written to $OUTPUT with ' + items.length + ' items');

    // Close the tab
    ws.send(JSON.stringify({id: msgId++, method: 'Target.closeTarget', params: {targetId}}));
    clearTimeout(timeout);
    setTimeout(() => process.exit(0), 500);
  }
});
ws.on('error', (e) => { console.error('Error:', e.message); process.exit(1); });
"

echo "Done! Feed available at: $OUTPUT"
