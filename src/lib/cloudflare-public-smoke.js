/**
 * Provas de homologação públicas, estritamente GET, sem cookies,
 * autenticação, dados de clientes, endpoints de pagamento ou mutações.
 * Injetar fetch nos testes permite testar toda a política offline.
 */
export const URL_PRODUCAO = 'https://site.farmaciapaguepouco.app';
const PASSO = [
  ['saude','/__health'],
  ['pagina_inicial','/'],
  ['ofertas','/ofertas'],
  ['departamentos','/departamentos'],
  ['painel_privado','/admin/inovafarma'],
  ['dados_privados','/data/db/admins.json'],
  ['asset_banner','/img/fundo-banner-vermelho.svg'],
];
function registro(status, aprovado) { return { http: status, aprovado: !!aprovado }; }

export async function verificarCloudflarePublico({
  fetchImpl = fetch,
  origem = URL_PRODUCAO,
} = {}) {
  if (origem !== URL_PRODUCAO)
    throw new Error('O ensaio público só pode consultar o domínio fixo da farmácia.');
  const verificacoes = {};
  for (const [nome, rota] of PASSO) {
    let res = null;
    try {
      res = await fetchImpl(origem + rota, {
        method: 'GET', redirect: 'manual',
        signal: AbortSignal.timeout(12000),
        headers: { Accept: nome === 'saude' ? 'application/json' : '*/*' },
      });
      const tipo = res.headers.get('content-type') || '';
      let valido = false;
      if (nome === 'saude') {
        // JSON de saúde é público e contém somente ok, runtime e storage.
        let json = null;
        if (res.status === 200) {
          try { json = await res.json(); } catch { /* falha fechada */ }
        }
        valido = json?.ok === true &&
          json?.runtime === 'cloudflare-workers' &&
          json?.storage === 'durable-object-sqlite';
      } else if (['pagina_inicial','ofertas','departamentos'].includes(nome)) {
        valido = res.status === 200 && tipo.includes('text/html');
      } else if (nome === 'painel_privado') {
        // Em nenhuma hipótese um visitante sem sessão pode obter este painel.
        valido = [301,302,303,307,308,401,403].includes(res.status);
      } else if (nome === 'dados_privados') {
        // Jamais aceitar 200, mesmo que o conteúdo pareça inofensivo.
        valido = [401,403,404].includes(res.status);
      } else if (nome === 'asset_banner') {
        valido = res.status === 200 &&
          (tipo.includes('image/svg+xml') || tipo.includes('text/xml'));
      }
      verificacoes[nome] = registro(res.status,valido);
    } catch {
      // Não incluir headers nem corpos que possam ter dados sensíveis.
      verificacoes[nome] = registro('FALHA_REDE',false);
    } finally {
      try { if (res?.body && !res.bodyUsed) await res.body.cancel(); } catch {}
    }
  }
  return {
    origem: URL_PRODUCAO,
    modo: 'somente_get_anonimo',
    verificacoes,
    aprovado: Object.values(verificacoes).every(x => x.aprovado),
    // O ensaio não verifica durabilidade real, pagamento ou backup externo.
    limites: ['sem_teste_restauracao_remota','sem_confirmacao_pix_real','sem_conexao_erp'],
  };
}
