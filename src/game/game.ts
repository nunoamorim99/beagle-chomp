// OWNER: gameplay-engineer (with render-artist for the sync layer)
// The integration layer: owns the GameState, wires input -> logic -> render,
// runs the fixed update, handles eating, collisions, lives, and level flow.
//
// ALL the hard logic already exists and is validated:
//   - grid.ts / movement.ts / ghostAI.ts  (proven, tested)
//   - full reference flow in /prototype/beagle-chomp.html (sections 7-11)
// This file should compose those pieces, not reinvent them. After any change to
// movement or AI, run `npm run test` before considering it done.
import { Grid } from "./grid";
import { MAZES } from "./mazes";

export class Game {
  constructor(_canvas: HTMLCanvasElement) {
    void Grid; void MAZES;
    // TODO(gameplay-engineer): build the loop by composing the proven modules
    // and the render layer. See ARCHITECTURE.md "Game loop".
  }
  start() { throw new Error("Game.start not implemented — see ARCHITECTURE.md + /prototype"); }
}
