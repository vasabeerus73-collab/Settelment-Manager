export class EventBus{
  static #map=new Map();
  static on(ev,fn){
    if(!this.#map.has(ev)) this.#map.set(ev,new Set());
    this.#map.get(ev).add(fn);
    return ()=>this.off(ev,fn);
  }
  static off(ev,fn){ this.#map.get(ev)?.delete(fn); }
  static once(ev,fn){
    const off=this.on(ev,(...a)=>{off(); fn(...a);});
  }
  static emit(ev,payload){
    for(const fn of this.#map.get(ev)??[]){
      try{fn(payload);}catch(e){console.error(e);}
    }
  }
}
