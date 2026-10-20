/**
 * Serializa a requisição inteira, inclusive quando o pagamento faz await/fetch.
 * Uma falha não interrompe o atendimento da próxima requisição.
 */
export class RequestQueue {
  constructor() { this.tail = Promise.resolve(); }
  run(operation) {
    const result = this.tail.then(operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
