import { rect } from './geometry';
import type { Layout } from './layout';

// Hand-made test level (plan task 2) until generation (phases 6–7) exists.
// Cell pitch 48 m. Big loop of 10 rooms: the green line runs START → A1 → A2 →
// A3 → B3 → EYE, the way back the player has not seen is EYE → C2 → C1 → C0 →
// B0 → START. The junction B1 in the middle cuts the loop; no dead ends.
//
//   z=96   [C0] ---- [C1] ---- [C2] ---- [C3 EYE]
//           |          |                    |
//   z=48   [B0] ---- [B1]                 [B3]
//           |          |                    |
//   z=0    [S ] ---- [A1] ---- [A2] ---- [A3]

const ID = { S: 0, A1: 1, A2: 2, A3: 3, B3: 4, EYE: 5, C2: 6, C1: 7, C0: 8, B0: 9, B1: 10 } as const;

export function fixedLayout(): Layout {
  const edge = (a: number, b: number) => ({ a, b });
  return {
    graph: {
      rooms: [
        { id: ID.S, cx: 0, cz: 0 },
        { id: ID.A1, cx: 1, cz: 0 },
        { id: ID.A2, cx: 2, cz: 0 },
        { id: ID.A3, cx: 3, cz: 0 },
        { id: ID.B3, cx: 3, cz: 1 },
        { id: ID.EYE, cx: 3, cz: 2 },
        { id: ID.C2, cx: 2, cz: 2 },
        { id: ID.C1, cx: 1, cz: 2 },
        { id: ID.C0, cx: 0, cz: 2 },
        { id: ID.B0, cx: 0, cz: 1 },
        { id: ID.B1, cx: 1, cz: 1 },
      ],
      edges: [
        edge(ID.S, ID.A1),
        edge(ID.A1, ID.A2),
        edge(ID.A2, ID.A3),
        edge(ID.A3, ID.B3),
        edge(ID.B3, ID.EYE),
        edge(ID.EYE, ID.C2),
        edge(ID.C2, ID.C1),
        edge(ID.C1, ID.C0),
        edge(ID.C0, ID.B0),
        edge(ID.B0, ID.S),
        edge(ID.B1, ID.A1),
        edge(ID.B1, ID.C1),
        edge(ID.B1, ID.B0),
      ],
      start: ID.S,
      eye: ID.EYE,
      route: [ID.S, ID.A1, ID.A2, ID.A3, ID.B3, ID.EYE],
    },
    rooms: [
      { id: ID.S, rect: rect(-9, -11, 9, 11), height: 8 },
      { id: ID.A1, rect: rect(37, -10, 63, 14), height: 10 },
      { id: ID.A2, rect: rect(85, -17, 107, 13), height: 12 },
      { id: ID.A3, rect: rect(130, -11, 158, 11), height: 9 },
      { id: ID.B3, rect: rect(136, 35, 156, 61), height: 8 },
      { id: ID.EYE, rect: rect(128, 83, 160, 113), height: 14 },
      { id: ID.C2, rect: rect(84, 86, 108, 106), height: 7 },
      { id: ID.C1, rect: rect(37, 86, 59, 114), height: 10 },
      { id: ID.C0, rect: rect(-10, 86, 10, 106), height: 9 },
      { id: ID.B0, rect: rect(-11, 36, 7, 60), height: 7 },
      { id: ID.B1, rect: rect(36, 36, 64, 64), height: 12 },
    ],
    corridors: [
      { a: ID.S, b: ID.A1, width: 8, height: 6 },
      { a: ID.A1, b: ID.A2, width: 7, height: 6 },
      { a: ID.A2, b: ID.A3, width: 9, height: 7 },
      { a: ID.A3, b: ID.B3, width: 7, height: 5 },
      { a: ID.B3, b: ID.EYE, width: 8, height: 6 },
      { a: ID.EYE, b: ID.C2, width: 7, height: 6 },
      { a: ID.C2, b: ID.C1, width: 6, height: 5 },
      { a: ID.C1, b: ID.C0, width: 8, height: 6 },
      { a: ID.C0, b: ID.B0, width: 7, height: 6 },
      { a: ID.B0, b: ID.S, width: 7, height: 5 },
      { a: ID.B1, b: ID.A1, width: 8, height: 7 },
      { a: ID.B1, b: ID.C1, width: 6, height: 5 },
      { a: ID.B1, b: ID.B0, width: 6, height: 5 },
    ],
  };
}
