/** Classificador de log com vocabulário fechado: não retorna conteúdo bruto. */
export function validarUuidBuild(valor) {
  return typeof valor === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(valor);
}
const categorias = [
  { re: /name in your wrangler configuration file[\s\S]{0,200}must match|wrangler.*name.*must match/i,
    categoria: 'NOME_WORKER_DIVERGENTE', proximo_passo: 'Revisar wrangler.jsonc e Worker existente; ver PR 43.' },
  { re: /missing entry-point/i,
    categoria: 'ENTRYPOINT_AUSENTE', proximo_passo: 'Verificar raiz do build e campo main no Wrangler.' },
  { re: /build token[\s\S]{0,160}(deleted|rolled|invalid|stale)|api token[\s\S]{0,160}(deleted|rolled|invalid|stale)/i,
    categoria: 'TOKEN_DE_BUILD_INVALIDO', proximo_passo: 'Revisar credencial de build na Cloudflare sem expor o valor.' },
  { re: /permission denied|authentication error|not authorized|authentication failed/i,
    categoria: 'AUTORIZACAO_BUILD_FALHOU', proximo_passo: 'Verificar permissões do token de build no painel Cloudflare.' },
  { re: /cannot find module|module not found|cannot resolve/i,
    categoria: 'DEPENDENCIA_OU_MODULO_AUSENTE', proximo_passo: 'Revisar dependências e diretório raiz do build.' },
];
export function analisarLogsBuild(linhas) {
  if (!Array.isArray(linhas)) return {
    categoria: 'FORMATO_INESPERADO', proximo_passo: 'Verificar formato da API da Cloudflare.',
  };
  const mensagem = linhas.slice(0, 2000).flatMap(l => Array.isArray(l) ? l : [])
    .filter(v => typeof v === 'string').join('\n').slice(0, 120000);
  for (const c of categorias) if (c.re.test(mensagem)) return {
    categoria: c.categoria, proximo_passo: c.proximo_passo,
  };
  return {
    categoria: 'CAUSA_NAO_CLASSIFICADA',
    proximo_passo: 'Abrir detalhes do build no painel Cloudflare autenticado.',
  };
}
