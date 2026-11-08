/**
 * Destino da recuperação: utiliza apenas CEP conhecido na cesta ou no
 * endereço principal da CONTA. Não deduz bairro/cidade a partir de texto.
 * O checkout presencial atual só atende ao mesmo CEP da sede.
 */
import { getSetting } from './settings.js';
import { isValidCep, normalizeCep } from './cep.js';
import { pedidoPresencialPorCEP } from './pagamento-presencial.js';
import { normalizeFreightConfig } from './freight.js';

export function destinoRecuperacao(db, carrinho, cliente) {
  const endereco = carrinho?.frete?.endereco ||
    (cliente?.enderecos || []).find(e=>e.padrao) ||
    (cliente?.enderecos || [])[0];
  const cep = normalizeCep(endereco?.cep);
  const empresa = getSetting(db,'empresa');
  const cepSede = normalizeCep(empresa?.endereco?.cep);
  if (!isValidCep(cep) || !isValidCep(cepSede)) return 'indefinido';
  if (!pedidoPresencialPorCEP(cep,cepSede)) return 'nacional';
  const frete=normalizeFreightConfig(getSetting(db,'frete'));
  // Sem retirada ou entrega local não há checkout presencial utilizável.
  return frete.retirada?.ativo || frete.entregaLocal?.ativo ? 'local' : 'indefinido';
}
