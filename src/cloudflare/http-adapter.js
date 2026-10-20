/**
 * Ponte entre Request/Response do Workers e o roteador existente.
 * Não abre portas TCP nem inicia um servidor Node.
 */
export async function readWebBody(request, limit) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > limit) throw Object.assign(new Error('PAYLOAD_TOO_LARGE'), { status: 413 });
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw Object.assign(new Error('PAYLOAD_TOO_LARGE'), { status: 413 });
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export async function dispatchFetch(app, request, context = {}) {
  const headers = Object.fromEntries(request.headers);
  const rawReq = {
    url: request.url, method: request.method, headers,
    trustedIp: context.ip || 'unknown',
    context, _webRequest: request,
  };
  let status = 200, responseHeaders = {}, body = null, ended = false;
  const rawRes = {
    writeHead(code, values) { status = code; responseHeaders = values; },
    end(value) { body = value; ended = true; },
  };
  try {
    await app.handle(rawReq, rawRes);
    if (!ended) throw new Error('Resposta não finalizada pelo roteador.');
  } catch (err) {
    status = err.status || (err instanceof URIError ? 400 : 500);
    responseHeaders = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' };
    body = status === 413 ? 'Arquivo ou requisição muito grande.' :
      status < 500 ? 'Requisição inválida.' : 'Ocorreu um erro ao processar a solicitação.';
    // Nunca devolve stack ou variáveis de ambiente ao visitante.
    if (status >= 500) console.error('[worker] falha no roteador:', err.message);
  }
  const resultHeaders = new Headers();
  for (const [name, value] of Object.entries(responseHeaders)) {
    for (const item of [].concat(value)) resultHeaders.append(name, String(item));
  }
  if (!resultHeaders.has('Cache-Control')) resultHeaders.set('Cache-Control', 'no-store');
  resultHeaders.set('X-Content-Type-Options', 'nosniff');
  const empty = request.method === 'HEAD' || [204, 205, 304].includes(status);
  return new Response(empty ? null : body, { status, headers: resultHeaders });
}
