interface Node {
  edges: Map<string, number>;
  fail: number;
  terminal: number[];
  output: number;
}

/** Aho-Corasick: one pass per input, with overlapping and duplicate-rule matches. */
export class Automaton {
  private readonly nodes: Node[] = [{ edges: new Map(), fail: 0, terminal: [], output: 0 }];
  constructor(private readonly words: readonly string[]) {
    words.forEach((word, rule) => {
      if (!word) return;
      let state = 0;
      // Deliberately use UTF-16 units to match String.slice offsets.
      for (let i = 0; i < word.length; i++) {
        const char = word[i]!;
        let next = this.nodes[state]!.edges.get(char);
        if (next === undefined) {
          next = this.nodes.length;
          this.nodes.push({ edges: new Map(), fail: 0, terminal: [], output: 0 });
          this.nodes[state]!.edges.set(char, next);
        }
        state = next;
      }
      this.nodes[state]!.terminal.push(rule);
    });
    const queue = [...this.nodes[0]!.edges.values()];
    for (let head = 0; head < queue.length; head++) {
      const state = queue[head]!;
      for (const [char, child] of this.nodes[state]!.edges) {
        let fallback = this.nodes[state]!.fail;
        while (fallback && !this.nodes[fallback]!.edges.has(char)) fallback = this.nodes[fallback]!.fail;
        const fail = this.nodes[fallback]!.edges.get(char) ?? 0;
        this.nodes[child]!.fail = fail;
        this.nodes[child]!.output = this.nodes[fail]!.terminal.length ? fail : this.nodes[fail]!.output;
        queue.push(child);
      }
    }
  }

  scan(input: string, emit: (rule: number, start: number, end: number) => void): void {
    let state = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input[i]!;
      while (state && !this.nodes[state]!.edges.has(char)) state = this.nodes[state]!.fail;
      state = this.nodes[state]!.edges.get(char) ?? 0;
      for (let matchState = state; matchState; matchState = this.nodes[matchState]!.output) {
        for (const rule of this.nodes[matchState]!.terminal) emit(rule, i + 1 - this.words[rule]!.length, i + 1);
      }
    }
  }
}
