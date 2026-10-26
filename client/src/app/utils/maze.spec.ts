import { MazeCell } from '../models/game.models';
import { canStep, stepTo } from './maze';

function openCell(): MazeCell {
  return { N: false, E: false, S: false, W: false };
}

function walledCell(): MazeCell {
  return { N: true, E: true, S: true, W: true };
}

describe('canStep', () => {
  it('allows stepping through an open side within bounds', () => {
    const cells = [[openCell(), openCell()]];
    expect(canStep(cells, 0, 0, 'E')).toBe(true);
  });

  it('blocks stepping through a wall', () => {
    const cells = [[walledCell(), walledCell()]];
    expect(canStep(cells, 0, 0, 'E')).toBe(false);
  });

  it('blocks stepping off the edge of the maze even if that side is open', () => {
    const cells = [[openCell()]];
    expect(canStep(cells, 0, 0, 'E')).toBe(false);
    expect(canStep(cells, 0, 0, 'S')).toBe(false);
  });
});

describe('stepTo', () => {
  it('computes the destination cell for each direction', () => {
    expect(stepTo(2, 2, 'N')).toEqual({ row: 1, col: 2 });
    expect(stepTo(2, 2, 'S')).toEqual({ row: 3, col: 2 });
    expect(stepTo(2, 2, 'E')).toEqual({ row: 2, col: 3 });
    expect(stepTo(2, 2, 'W')).toEqual({ row: 2, col: 1 });
  });
});
