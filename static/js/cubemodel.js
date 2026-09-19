// Cube model in the browser. The geometry and permutations come from
// /api/meta, so the browser and the Python solver share one definition.

export const COLORS = {
  W: { hex: "#f2f2ec", name: "blanco", lab: [95, 0, 2] },
  Y: { hex: "#f7c928", name: "amarillo", lab: [84, 2, 80] },
  R: { hex: "#c8252c", name: "rojo", lab: [44, 64, 40] },
  O: { hex: "#f2842a", name: "naranja", lab: [66, 38, 66] },
  B: { hex: "#1f5fbf", name: "azul", lab: [40, 12, -58] },
  G: { hex: "#1f8a4c", name: "verde", lab: [51, -48, 25] },
};
export const COLOR_KEYS = Object.keys(COLORS);
// Western colour scheme, used for demo cubes and manual entry.
export const STANDARD_SCHEME = { U: "W", R: "R", F: "G", D: "Y", L: "O", B: "B" };

export class CubeModel {
  constructor(meta) {
    this.meta = meta;
    this.faces = meta.faces;
    this.perms = meta.perms;
    this.stickers = meta.stickers;
    this.rings = meta.rings;
  }

  // state = array of 54 colour keys; returns a new array
  apply(state, move) {
    const p = this.perms[move];
    const out = new Array(54);
    for (let i = 0; i < 54; i++) out[p[i]] = state[i];
    return out;
  }

  applyAll(state, moves) {
    return moves.reduce((s, m) => this.apply(s, m), state);
  }

  // colour array -> facelet letters (URFDLB), using centres as reference
  toFacelets(colors) {
    const letterOf = {};
    this.faces.split("").forEach((f, k) => { letterOf[colors[9 * k + 4]] = f; });
    return colors.map((c) => letterOf[c] || "?").join("");
  }

  fromFacelets(facelets, scheme = STANDARD_SCHEME) {
    return facelets.split("").map((f) => scheme[f]);
  }

  centerColor(colors, face) {
    return colors[9 * this.faces.indexOf(face) + 4];
  }

  // Same checks as the server (cube/model.py validate), used to repair photo reads.
  isValid(colors) {
    const f = this.toFacelets(colors);
    if (f.includes("?")) return false;
    const solved = this.meta.solved;
    const CF = this.meta.corner_facelets, EF = this.meta.edge_facelets;
    const cornerCols = CF.map((fs) => fs.map((i) => solved[i]));
    const edgeCols = EF.map((fs) => fs.map((i) => solved[i]));
    const cp = [], co = [], ep = [], eo = [];
    for (const fs of CF) {
      const cols = fs.map((i) => f[i]);
      const ori = cols.findIndex((c) => c === "U" || c === "D");
      if (ori < 0) return false;
      const c1 = cols[(ori + 1) % 3], c2 = cols[(ori + 2) % 3];
      const j = cornerCols.findIndex((cc) => cc[1] === c1 && cc[2] === c2);
      if (j < 0) return false;
      cp.push(j); co.push(ori);
    }
    for (const fs of EF) {
      const cols = fs.map((i) => f[i]);
      let j = edgeCols.findIndex((ec) => ec[0] === cols[0] && ec[1] === cols[1]);
      if (j >= 0) { ep.push(j); eo.push(0); continue; }
      j = edgeCols.findIndex((ec) => ec[0] === cols[1] && ec[1] === cols[0]);
      if (j < 0) return false;
      ep.push(j); eo.push(1);
    }
    if (new Set(cp).size !== 8 || new Set(ep).size !== 12) return false;
    if (co.reduce((a, b) => a + b, 0) % 3 || eo.reduce((a, b) => a + b, 0) % 2) return false;
    const parity = (p) => { let s = 0; for (let i = 0; i < p.length; i++) for (let j = 0; j < i; j++) if (p[j] > p[i]) s++; return s % 2; };
    return parity(cp) === parity(ep);
  }

  isSolved(colors) {
    for (let k = 0; k < 6; k++) {
      for (let i = 0; i < 9; i++) if (colors[9 * k + i] !== colors[9 * k + 4]) return false;
    }
    return true;
  }
}

export function invertMoves(moves) {
  return moves.slice().reverse().map((m) => (m.endsWith("2") ? m : m.endsWith("'") ? m[0] : m + "'"));
}
