/** Local MCP fixture shared by provider and Desktop integration tests. */
import { createServer } from 'node:http'

export const results = [
  { title: 'Official release', link: 'https://example.com/releases', content: 'Release details', publish_date: '2026-10-15' },
  { title: 'Duplicate', url: 'https://example.com/releases' },
  { title: 'Guide', link: 'https://example.com/guide', content: 'Guide details' },
  { title: 'Third', url: 'https://example.net/third' },
  { url: 'javascript:alert(1)' },
]
export const tools = [{ name: 'webSearchPrime', description: 'Search', inputSchema: {
  type: 'object', properties: { search_query: { type: 'string' }, count: { type: 'integer', minimum: 1, maximum: 10 } }, required: ['search_query'],
} }]

export async function startMcpFixture(t) {
  const observed = []
  const calls = []
  let redirects = 0
  let ended = 0
  const server = createServer(async (req, res) => {
    if (req.url === '/redirect-target') { redirects++; res.end('should never be reached'); return }
    if (req.method === 'GET') { res.writeHead(405).end(); return }
    if (req.method === 'DELETE') { ended++; res.writeHead(200).end(); return }
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    observed.push({ body, authorization: req.headers.authorization, protocol: req.headers['mcp-protocol-version'] })
    const send = result => {
      if (res.destroyed) return
      const response = { jsonrpc: '2.0', id: body.id, result }
      if (req.url === '/sse') {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end(`: comment\n\nevent: message\ndata: ${JSON.stringify(response)}\n\n`)
      } else {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(response))
      }
    }
    if (body.id === undefined) { res.writeHead(202).end(); return }
    if (body.method === 'initialize') {
      res.setHeader('mcp-session-id', `fixture-${observed.length}`)
      send({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'glm-fixture', version: '1.0.0' } }); return
    }
    if (body.method === 'tools/list') { send({ tools }); return }
    if (body.method !== 'tools/call') { res.writeHead(500).end(); return }
    calls.push(body.params)
    const query = body.params.arguments.search_query
    if (query === 'timeout') return // The caller must abort the outstanding request.
    if (query === 'redirect') { res.writeHead(307, { location: '/redirect-target' }).end(); return }
    if (query === 'disconnect') { res.destroy(); return }
    if (query.startsWith('http-')) { res.writeHead(Number(query.slice(5))).end('fixture error'); return }
    if (query === 'rpc-error') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -400, message: 'search_query cannot be empty' } })); return
    }
    if (query === 'tool-error') { send({ isError: true, content: [{ type: 'text', text: 'quota exceeded' }] }); return }
    if (query === 'echo-key-error') { send({ isError: true, content: [{ type: 'text', text: req.headers.authorization }] }); return }
    if (query === 'oversize') { send({ content: [{ type: 'text', text: 'x'.repeat(9 * 1024 * 1024) }] }); return }
    send({ content: [{ type: 'text', text: JSON.stringify({ search_result: results }) }] })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  return { base, endpoint: `${base}/mcp`, calls, observed, redirects: () => redirects, ended: () => ended }
}

