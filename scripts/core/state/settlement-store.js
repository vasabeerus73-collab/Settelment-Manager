export class SettlementStore {
  static #state = {};
  static #subs = new Set();

  static getState(){ return this.#state; }

  static setState(state){
    this.#state = structuredClone(state);
    this.#notify();
  }

  static update(mutator){
    const next = structuredClone(this.#state);
    mutator(next);
    this.#state = next;
    this.#notify();
  }

  static subscribe(fn){
    this.#subs.add(fn);
    return ()=>this.#subs.delete(fn);
  }

  static #notify(){
    for(const fn of this.#subs){
      try{ fn(this.#state); }catch(err){ console.error(err); }
    }
  }
}
