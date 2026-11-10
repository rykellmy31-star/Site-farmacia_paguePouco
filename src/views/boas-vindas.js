/** Pop-up opcional e leve, apenas para visitantes na página inicial. */
import {escapeHtml as e} from '../lib/security.js';

export function popupBoasVindas(config) {
  if (!config?.ativo) return '';
  return [
    '<div class="ppbv-fundo" id="ppbv" hidden>',
      '<section class="ppbv-janela" role="dialog" aria-modal="true" aria-labelledby="ppbv-titulo">',
        '<button type="button" class="ppbv-fechar" data-bv-fechar aria-label="Fechar oferta">×</button>',
        '<span class="ppbv-icone" aria-hidden="true">🎁</span>',
        '<h2 id="ppbv-titulo">'+e(config.titulo||'Ganhe um cupom exclusivo!')+'</h2>',
        '<p class="ppbv-subtitulo">'+e(config.subtitulo||'Cadastre-se e receba uma oferta especial.')+'</p>',
        '<div class="ppbv-feedback" data-bv-feedback role="status" aria-live="polite" hidden></div>',
        '<form id="ppbv-form" data-bv-iniciar>',
          '<label for="ppbv-nome">Nome completo</label>',
          '<input id="ppbv-nome" name="nome" autocomplete="name" maxlength="120" required placeholder="Seu nome e sobrenome">',
          '<label for="ppbv-email">E-mail</label>',
          '<input id="ppbv-email" name="email" type="email" autocomplete="email" maxlength="250" required placeholder="seuemail@exemplo.com">',
          '<label for="ppbv-telefone">Celular com WhatsApp e DDD</label>',
          '<input id="ppbv-telefone" name="telefone" type="tel" inputmode="tel" autocomplete="tel" maxlength="22" required placeholder="(73) 99999-9999">',
          '<label class="ppbv-check"><input type="checkbox" name="politica" value="1" required> <span>Li a <a href="/pagina/politica-de-privacidade" target="_blank" rel="noopener">Política de Privacidade</a> e autorizo o uso dos dados para validar e entregar meu cupom.</span></label>',
          '<label class="ppbv-check"><input type="checkbox" name="receberCupomWhatsapp" value="1" checked> <span>Quero receber meu cupom também pelo WhatsApp.</span></label>',
          '<label class="ppbv-check"><input type="checkbox" name="marketing" value="1"> <span>Quero receber futuras ofertas e novidades pelo WhatsApp e e-mail (opcional).</span></label>',
          '<button class="ppbv-enviar" type="submit">Receber código de verificação</button>',
        '</form>',
        '<form id="ppbv-confirmar" data-bv-confirmar hidden>',
          '<p>Enviamos um código de 6 dígitos para o seu WhatsApp. O código é válido por 10 minutos.</p>',
          '<label for="ppbv-codigo">Código de verificação</label>',
          '<input id="ppbv-codigo" name="codigo" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required placeholder="000000">',
          '<button class="ppbv-enviar" type="submit">Confirmar e gerar meu cupom</button>',
        '</form>',
        '<div class="ppbv-concluido" data-bv-concluido hidden>',
          '<h3>Seu cupom está pronto! 🎉</h3>',
          '<p>Use este código exclusivo na primeira compra:</p>',
          '<strong class="ppbv-cupom" data-bv-cupom></strong>',
          '<p data-bv-validade></p>',
          '<p class="texto-pequeno">Para usar no carrinho, finalize seu cadastro com o mesmo e-mail e WhatsApp.</p>',
          '<a class="ppbv-enviar" href="/conta/cadastro">Criar minha conta e aproveitar</a>',
        '</div>',
        '<p class="ppbv-rodape">Uma participação por WhatsApp confirmado e navegador. Sujeito às condições da oferta.</p>',
      '</section>',
    '</div>'
  ].join('');
}
