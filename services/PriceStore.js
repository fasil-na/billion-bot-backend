export class PriceStore {
  static prices = new Map();

  static update(pair, price) {
    this.prices.set(pair, price);
  }

  static getPrice(pair) {
    return this.prices.get(pair);
  }
}
