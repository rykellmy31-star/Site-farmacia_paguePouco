/**
 * Usa os dados cadastrados UMA VEZ em Configurações gerais para compor
 * páginas institucionais e rodapé, sem gravar/reescrever o HTML das páginas.
 * Os textos jurídicos [REVISAR] são preservados até aprovação humana.
 */
import { escapeHtml as e } from './security.js';

export function campoCadastrado(value) {
  const s = String(value ?? '').trim();
  if (!s || /\[(?:PREENCHER|REVISAR)\]/i.test(s)) return '';
  return s;
}

const exibicao = value => campoCadastrado(value) || 'Não informado';

function dadosEmpresa(empresa = {}) {
  const endereco = empresa.endereco || {};
  const crf = campoCadastrado(empresa.crf);
  const crfCompleto = crf
    ? (/^CRF(?:\s|\/|-[A-Z]{2}\b)/i.test(crf) ? crf : 'CRF/UF ' + crf)
    : 'CRF/UF não informado';
  const rua = [campoCadastrado(endereco.logradouro), campoCadastrado(endereco.numero)]
    .filter(Boolean).join(', ');
  const bairro = campoCadastrado(endereco.bairro);
  const cidade = [campoCadastrado(endereco.cidade), campoCadastrado(endereco.uf)]
    .filter(Boolean).join('/');
  const cep = campoCadastrado(endereco.cep);
  return {
    nomeFantasia: exibicao(empresa.nomeFantasia),
    razaoSocial: exibicao(empresa.razaoSocial),
    cnpj: exibicao(empresa.cnpj),
    inscricaoEstadual: exibicao(empresa.inscricaoEstadual),
    telefone: exibicao(empresa.telefone),
    email: exibicao(empresa.email),
    farmaceuticoResponsavel: exibicao(empresa.farmaceuticoResponsavel),
    crf: crf || 'Não informado',
    crfCompleto,
    autorizacaoSanitaria: exibicao(empresa.autorizacaoSanitaria),
    horarioAtendimento: exibicao(empresa.horarioAtendimento),
    logradouro: exibicao(endereco.logradouro),
    numero: exibicao(endereco.numero),
    bairro: exibicao(endereco.bairro),
    cidade: exibicao(endereco.cidade),
    uf: exibicao(endereco.uf),
    cep: exibicao(endereco.cep),
    enderecoLinha1: [rua, bairro].filter(Boolean).join(' — ') || 'Endereço não informado',
    enderecoLinha2: [cidade, cep ? 'CEP ' + cep : ''].filter(Boolean).join(' — ') || 'Cidade e CEP não informados',
  };
}

function trocar(html, regex, valor) {
  return html.replace(regex, () => e(valor));
}

/** Preserva todo conteúdo personalizado e substitui apenas modelos conhecidos. */
export function preencherDadosPagina(conteudo, slug, empresa = {}) {
  let html = String(conteudo || '');
  const d = dadosEmpresa(empresa);
  // Marcadores opcionais para novas páginas criadas pelo editor.
  html = html.replace(/\{\{\s*empresa\.([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/g,
    (original, chave) => Object.hasOwn(d, chave) ? e(d[chave]) : original);

  switch (slug) {
    case 'nossas-lojas':
      html = trocar(html, /<strong>Farmácia Pague Pouco<\/strong>/g, d.nomeFantasia === 'Não informado' ? 'Farmácia Pague Pouco' : d.nomeFantasia);
      html = trocar(html, /\[PREENCHER\]\s*Endereço completo, número, bairro/gi, d.enderecoLinha1);
      html = trocar(html, /\[PREENCHER\]\s*Cidade\/UF\s*—\s*CEP\s*\[PREENCHER\]/gi, d.enderecoLinha2);
      html = trocar(html, /\[PREENCHER\]\s*Segunda a sábado, das 08h às 20h\./gi, d.horarioAtendimento);
      html = trocar(html, /(?<=Telefone:\s*)\[PREENCHER\]/gi, d.telefone);
      // Nota antiga de preenchimento não se aplica a campos agora automáticos.
      html = html.replace(/<p><em>\[REVISAR\] Preencha os dados reais no painel em Configurações → Empresa\.<\/em><\/p>/gi, '');
      break;
    case 'atendimento':
      html = trocar(html, /(?<=<strong>Telefone<\/strong>\s*—\s*)\[PREENCHER\]/gi, d.telefone);
      html = trocar(html, /(?<=<strong>E-mail<\/strong>\s*—\s*)\[PREENCHER\]/gi, d.email);
      html = trocar(html, /\[PREENCHER\]\s*Configurável no painel em Configurações → WhatsApp de Atendimento\./gi, d.horarioAtendimento);
      break;
    case 'fale-conosco':
      html = trocar(html, /(?<=<strong>E-mail:<\/strong>\s*)\[PREENCHER\]/gi, d.email);
      html = trocar(html, /(?<=<strong>Telefone:<\/strong>\s*)\[PREENCHER\]/gi, d.telefone);
      break;
    case 'politica-de-privacidade':
      html = trocar(html, /\[PREENCHER\]\s*Canal de atendimento para exercício de direitos \(enviar e-mail ou WhatsApp\)\./gi,
        'Para exercer seus direitos, entre em contato pelo e-mail ' + d.email + ' ou pelo telefone ' + d.telefone + '.');
      break;
    case 'atendimento-farmaceutico':
      html = trocar(html, /(?<=<strong>Farmacêutico responsável:<\/strong>\s*)\[PREENCHER\]\s*—\s*CRF\/UF\s*\[PREENCHER\]/gi,
        d.farmaceuticoResponsavel + ' — ' + d.crfCompleto);
      break;
    case 'informacoes-sanitarias':
      html = trocar(html, /Razão social:\s*\[PREENCHER\]\s*—\s*CNPJ\s*\[PREENCHER\]/gi,
        'Razão social: ' + d.razaoSocial + ' — CNPJ ' + d.cnpj);
      html = trocar(html, /(?<=Autorização de funcionamento\/AFE:\s*)\[PREENCHER\]/gi,
        d.autorizacaoSanitaria);
      html = trocar(html, /Farmacêutico responsável:\s*\[PREENCHER\]\s*—\s*CRF\/UF\s*\[PREENCHER\]/gi,
        'Farmacêutico responsável: ' + d.farmaceuticoResponsavel + ' — ' + d.crfCompleto);
      break;
    default:
      break;
  }
  return html;
}

/** Retorna texto puro: o rodapé faz o escape uma única vez ao apresentar. */
export function textoInstitucionalDinamico(texto, empresa = {}) {
  const d = dadosEmpresa(empresa);
  let t = String(texto || '');
  t = t.replace(/\{\{\s*empresa\.([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/g,
    (original, chave) => Object.hasOwn(d, chave) ? d[chave] : original);
  if (/^Farmácia Pague Pouco\s*—\s*CNPJ\s*\[PREENCHER\]/i.test(t) && d.nomeFantasia !== 'Não informado') {
    t = t.replace(/^Farmácia Pague Pouco/, d.nomeFantasia);
  }
  t = t.replace(/CNPJ\s*\[PREENCHER\]/gi, 'CNPJ ' + d.cnpj);
  t = t.replace(/Farmacêutico responsável:\s*\[PREENCHER\]/gi,
    'Farmacêutico responsável: ' + d.farmaceuticoResponsavel);
  t = t.replace(/CRF\/UF\s*\[PREENCHER\]/gi, d.crfCompleto);
  return t;
}

export function dadosEmpresaVisiveis(empresa = {}) {
  return dadosEmpresa(empresa);
}
