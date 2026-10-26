import { Player } from '../models/game.models';
import { buildRanking } from './ranking';

function player(overrides: Partial<Player>): Player {
  return {
    socketId: 'id',
    name: 'NAME',
    color: '#fff',
    isHost: false,
    row: 0,
    col: 0,
    distanceToExit: 0,
    percent: 0,
    finished: false,
    finishOrder: null,
    finishTimeMs: null,
    ...overrides,
  };
}

describe('buildRanking', () => {
  it('ranks finishers ahead of everyone still in the maze, by arrival order', () => {
    const players = [
      player({ socketId: 'a', finished: true, finishOrder: 2 }),
      player({ socketId: 'b', finished: true, finishOrder: 1 }),
      player({ socketId: 'c', finished: false, distanceToExit: 5 }),
    ];

    const ranked = buildRanking(players);
    expect(ranked.map((p) => p.socketId)).toEqual(['b', 'a', 'c']);
    expect(ranked.map((p) => p.rank)).toEqual([1, 2, 3]);
  });

  it('orders unfinished players by fewest remaining steps to the exit', () => {
    const players = [
      player({ socketId: 'a', distanceToExit: 10 }),
      player({ socketId: 'b', distanceToExit: 2 }),
      player({ socketId: 'c', distanceToExit: 6 }),
    ];

    const ranked = buildRanking(players);
    expect(ranked.map((p) => p.socketId)).toEqual(['b', 'c', 'a']);
  });

  it('gives tied players (equal distance, or a tie that cannot happen between finishers) the same rank', () => {
    const players = [
      player({ socketId: 'a', distanceToExit: 4 }),
      player({ socketId: 'b', distanceToExit: 4 }),
      player({ socketId: 'c', distanceToExit: 9 }),
    ];

    const ranked = buildRanking(players);
    const byId = Object.fromEntries(ranked.map((p) => [p.socketId, p.rank]));
    expect(byId['a']).toBe(byId['b']);
    expect(byId['c']).toBe(3); // standard competition ranking: skips rank 2 after a 2-way tie at 1
  });
});
