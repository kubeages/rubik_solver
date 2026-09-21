// Reading the cube as twenty pieces instead of fifty-four loose stickers.

import { labDist } from "./capture.js";

// Read the cube as twenty pieces instead of fifty-four loose stickers.
//
// Classifying each sticker on its own throws away almost everything we know.
// A cube is not fifty-four independent colours: it is eight corners and
// twelve edges, and we know exactly which twenty pieces exist, because the
// centres tell us the six colours. Every corner is one of the eight
// combinations of {up,down} x {right,left} x {front,back}, every edge one of
// the twelve pairs from different axes, and each piece is on the cube exactly
// once. That last part is the strong one: it stops two corners from claiming
// to be the same piece, which is what an impossible corner is.
//
// So instead of "which colour is this sticker", the question becomes "which
// piece is in this corner", answered for all eight at once by a minimum-cost
// assignment. A red read as orange no longer breaks the cube: the piece it
// would make is already taken, and the next cheapest reading wins.
export function assignMinCost(cost) {
  // Hungarian algorithm, the textbook O(n^3) one with potentials.
  const n = cost.length;
  const u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const out = new Array(n);
  for (let j = 1; j <= n; j++) out[p[j] - 1] = j - 1;
  return out;                        // out[row] = column
}

// The twenty pieces of this cube, taken from the solver's own description of
// a solved cube, so the browser and the server agree on which way round a
// corner reads. Each piece is named by the colours of the centres.
function piecesOf(centreKeys, model, meta) {
  const solved = meta.solved;
  const keyOf = (letter) => centreKeys[model.faces.indexOf(letter)];
  const group = (facelets) => facelets.map((fs) =>
    ({ facelets: fs, colors: fs.map((i) => keyOf(solved[i])) }));
  return { corners: group(meta.corner_facelets), edges: group(meta.edge_facelets) };
}

// Places every piece where it costs least, each piece used exactly once.
export function readPieces(lab, prototypes, centreKeys, model, meta) {
  const { corners, edges } = piecesOf(centreKeys, model, meta);
  const cost = (slot, piece, shift) =>
    slot.facelets.reduce((s, facelet, i) =>
      s + labDist(lab[String(facelet)], prototypes[piece.colors[(i + shift) % piece.colors.length]]), 0);

  const place = (group) => {
    const shifts = group[0].colors.length;        // 3 for a corner, 2 for an edge
    const table = group.map((slot) => group.map((piece) => {
      let best = Infinity;
      for (let s = 0; s < shifts; s++) best = Math.min(best, cost(slot, piece, s));
      return best;
    }));
    const chosen = assignMinCost(table);
    return group.map((slot, i) => {
      let shift = 0, best = Infinity;
      for (let s = 0; s < shifts; s++) {
        const c = cost(slot, group[chosen[i]], s);
        if (c < best) { best = c; shift = s; }
      }
      return { piece: chosen[i], shift };
    });
  };

  const state = { corners: place(corners), edges: place(edges) };
  const build = () => {
    const out = new Array(54).fill(null);
    centreKeys.forEach((key, f) => { out[f * 9 + 4] = key; });
    for (const [group, placed] of [[corners, state.corners], [edges, state.edges]]) {
      placed.forEach((p, i) => {
        const piece = group[p.piece], n = piece.colors.length;
        group[i].facelets.forEach((facelet, k) => { out[facelet] = piece.colors[(k + p.shift) % n]; });
      });
    }
    return out;
  };

  repairInvariants(state, { corners, edges }, cost, build, model);
  return build();
}

// A cube made of the right twenty pieces can still be impossible: a corner
// turned in place, an edge flipped, two pieces swapped. Those are exactly the
// three laws of the cube (corner twists add up to a multiple of three, edge
// flips to a multiple of two, and the two permutations have equal parity), so
// the diagnosis says which one is broken and only the changes that could mend
// it are tried, cheapest first. Blind swapping was the old way and it needed
// luck; this needs arithmetic.
function repairInvariants(state, groups, cost, build, model) {
  const badness = (colors) => {
    const d = model.diagnose(colors);
    if (d.ok) return 0;
    if (d.why) return 9;              // not even made of real pieces: hopeless here
    return (d.twist ? 1 : 0) + (d.flip ? 1 : 0) + (d.parityOff ? 1 : 0);
  };
  for (let round = 0; round < 3; round++) {
    const now = badness(build());
    if (now === 0) return;
    let best = null;
    const consider = (apply, undo, extra) => {
      apply();
      const score = badness(build());
      if (score < now && (!best || extra < best.extra)) best = { apply, extra };
      undo();
    };
    for (const which of ["corners", "edges"]) {
      const group = groups[which], placed = state[which];
      const shifts = group[0].colors.length;
      // turn one piece in place
      placed.forEach((p, i) => {
        for (let s = 1; s < shifts; s++) {
          const shift = (p.shift + s) % shifts;
          const extra = cost(group[i], group[p.piece], shift) - cost(group[i], group[p.piece], p.shift);
          const old = p.shift;
          consider(() => { p.shift = shift; }, () => { p.shift = old; }, extra);
        }
      });
      // exchange two pieces, each taking its best turn in its new place
      for (let a = 0; a < placed.length; a++) {
        for (let b = a + 1; b < placed.length; b++) {
          const pa = placed[a], pb = placed[b];
          const bestShift = (slot, piece) => {
            let shift = 0, low = Infinity;
            for (let s = 0; s < shifts; s++) {
              const c = cost(slot, piece, s);
              if (c < low) { low = c; shift = s; }
            }
            return { shift, low };
          };
          const na = bestShift(group[a], group[pb.piece]);
          const nb = bestShift(group[b], group[pa.piece]);
          const extra = na.low + nb.low
            - cost(group[a], group[pa.piece], pa.shift) - cost(group[b], group[pb.piece], pb.shift);
          const old = [pa.piece, pa.shift, pb.piece, pb.shift];
          consider(() => {
            pa.piece = old[2]; pa.shift = na.shift;
            pb.piece = old[0]; pb.shift = nb.shift;
          }, () => {
            pa.piece = old[0]; pa.shift = old[1];
            pb.piece = old[2]; pb.shift = old[3];
          }, extra);
        }
      }
    }
    if (!best) return;
    best.apply();
  }
}
