import { describe, it, expect, beforeEach } from "vitest";
import { Cl, ClarityType, cvToValue } from "@stacks/transactions";
import { initSimnet } from "@hirosystems/clarinet-sdk";

// ================================================================
// Setup
// ================================================================

const simnet = await initSimnet();
const accounts = simnet.getAccounts();

const DEPLOYER = accounts.get("deployer")!;
const P1       = accounts.get("wallet_1")!;
const P2       = accounts.get("wallet_2")!;
const P3       = accounts.get("wallet_3")!;

const CONTRACT = "rps";

// ================================================================
// Move constants — must match rps.clar
// ================================================================

const MOVE_ROCK     = 1;
const MOVE_PAPER    = 2;
const MOVE_SCISSORS = 3;

// ================================================================
// Error constants — must match rps.clar
// ================================================================

const ERR_GAME_NOT_FOUND   = Cl.error(Cl.uint(100));
const ERR_GAME_FULL        = Cl.error(Cl.uint(101));
const ERR_NOT_YOUR_GAME    = Cl.error(Cl.uint(102));
const ERR_ALREADY_REVEALED = Cl.error(Cl.uint(103));
const ERR_BAD_COMMIT       = Cl.error(Cl.uint(104));
const ERR_INVALID_MOVE     = Cl.error(Cl.uint(105));
const ERR_NOT_READY        = Cl.error(Cl.uint(106));
const ERR_SAME_PLAYER      = Cl.error(Cl.uint(107));
const ERR_GAME_OVER        = Cl.error(Cl.uint(108));

// ================================================================
// Helpers
// ================================================================

// sha256(moveBytes || salt) — mirrors the Clarity commit scheme
async function makeCommit(move: number, salt: Uint8Array): Promise<Uint8Array> {
  const moveBytes = new Uint8Array([move]);
  const combined  = new Uint8Array([...moveBytes, ...salt]);
  const digest    = await crypto.subtle.digest("SHA-256", combined);
  return new Uint8Array(digest);
}

function randomSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

// Create a game as `player` with `move`, returns { gameId, salt }
async function createGame(player: string, move: number) {
  const salt   = randomSalt();
  const commit = await makeCommit(move, salt);
  const result = simnet.callPublicFn(
    CONTRACT,
    "create-game",
    [Cl.buffer(commit)],
    player
  );
  // Extract the returned game-id from the ok value
  const gameId = Number((result.result as any).value.value);
  return { gameId, salt, commit, result };
}

// Join a game as `player` with `move`, returns { salt }
async function joinGame(gameId: number, player: string, move: number) {
  const salt   = randomSalt();
  const commit = await makeCommit(move, salt);
  const result = simnet.callPublicFn(
    CONTRACT,
    "join-game",
    [Cl.uint(gameId), Cl.buffer(commit)],
    player
  );
  return { salt, commit, result };
}

// Reveal a move for a player
async function reveal(
  gameId: number,
  player: string,
  move: number,
  salt: Uint8Array
) {
  return simnet.callPublicFn(
    CONTRACT,
    "reveal",
    [Cl.uint(gameId), Cl.uint(move), Cl.buffer(salt)],
    player
  );
}

// Run a complete game from start to finish, returns the final reveal result
async function playFullGame(p1Move: number, p2Move: number) {
  const { gameId, salt: s1 } = await createGame(P1, p1Move);
  const { salt: s2 }         = await joinGame(gameId, P2, p2Move);
  await reveal(gameId, P1, p1Move, s1);
  const finalReveal = await reveal(gameId, P2, p2Move, s2);
  return { gameId, finalReveal };
}

// Read a game's state map from the chain
function getGame(gameId: number) {
  return simnet.callReadOnlyFn(
    CONTRACT,
    "get-game",
    [Cl.uint(gameId)],
    DEPLOYER
  );
}

// Read a player's stats from the chain
function getStats(player: string) {
  return simnet.callReadOnlyFn(
    CONTRACT,
    "get-player-stats",
    [Cl.principal(player)],
    DEPLOYER
  );
}

// Pull a named uint field out of a Clarity tuple response
function statField(player: string, field: string): bigint {
  const res  = getStats(player);
  const data = (res.result as any).value.data;
  return data[field].value;
}

// Pull a named field from get-game tuple response
function gameField(gameId: number, field: string): any {
  const res  = getGame(gameId);
  const data = (res.result as any).value.data;
  return data[field];
}

// ================================================================
// Test Suite
// ================================================================

describe("StacksRPS — rps.clar", () => {

  // --------------------------------------------------------------
  // create-game
  // --------------------------------------------------------------

  describe("create-game", () => {
    it("returns game id starting at 0", async () => {
      const { result } = await createGame(P1, MOVE_ROCK);
      expect(result.result).toStrictEqual(Cl.ok(Cl.uint(0)));
    });

    it("increments game id with each new game", async () => {
      await createGame(P1, MOVE_ROCK);
      const { result } = await createGame(P2, MOVE_PAPER);
      expect(result.result).toStrictEqual(Cl.ok(Cl.uint(1)));
    });

    it("sets status to WAITING (u0)", async () => {
      const { gameId } = await createGame(P1, MOVE_ROCK);
      expect(gameField(gameId, "status")).toStrictEqual(Cl.uint(0));
    });

    it("sets p1 to tx-sender", async () => {
      const { gameId } = await createGame(P1, MOVE_ROCK);
      expect(gameField(gameId, "p1")).toStrictEqual(Cl.principal(P1));
    });

    it("sets p2 to none", async () => {
      const { gameId } = await createGame(P1, MOVE_ROCK);
      expect(gameField(gameId, "p2")).toStrictEqual(Cl.none());
    });

    it("sets p1-move and p2-move to MOVE-NONE (u0)", async () => {
      const { gameId } = await createGame(P1, MOVE_ROCK);
      expect(gameField(gameId, "p1-move")).toStrictEqual(Cl.uint(0));
      expect(gameField(gameId, "p2-move")).toStrictEqual(Cl.uint(0));
    });

    it("sets winner to none initially", async () => {
      const { gameId } = await createGame(P1, MOVE_ROCK);
      expect(gameField(gameId, "winner")).toStrictEqual(Cl.none());
    });

    it("stores the correct commit hash", async () => {
      const salt   = randomSalt();
      const commit = await makeCommit(MOVE_ROCK, salt);
      simnet.callPublicFn(CONTRACT, "create-game", [Cl.buffer(commit)], P1);
      expect(gameField(0, "p1-commit")).toStrictEqual(Cl.buffer(commit));
    });

    it("increments get-total-games after creation", async () => {
      await createGame(P1, MOVE_ROCK);
      await createGame(P2, MOVE_PAPER);
      const total = simnet.callReadOnlyFn(CONTRACT, "get-total-games", [], DEPLOYER);
      expect(total.result).toStrictEqual(Cl.uint(2));
    });
  });

  // --------------------------------------------------------------
  // join-game
  // --------------------------------------------------------------

  describe("join-game", () => {
    it("returns ok true on successful join", async () => {
      const { gameId } = await createGame(P1, MOVE_ROCK);
      const { result } = await joinGame(gameId, P2, MOVE_PAPER);
      expect(result.result).toStrictEqual(Cl.ok(Cl.bool(true)));
    });

    it("sets p2 to joining player", async () => {
      const { gameId } = await createGame(P1, MOVE_ROCK);
      await joinGame(gameId, P2, MOVE_PAPER);
      expect(gameField(gameId, "p2")).toStrictEqual(Cl.some(Cl.principal(P2)));
    });

    it("sets status to ACTIVE (u1) after joining", async () => {
      const { gameId } = await createGame(P1, MOVE_ROCK);
      await joinGame(gameId, P2, MOVE_PAPER);
      expect(gameField(gameId, "status")).toStrictEqual(Cl.uint(1));
    });

    it("stores p2 commit hash", async () => {
      const { gameId }       = await createGame(P1, MOVE_ROCK);
      const { salt, commit } = await joinGame(gameId, P2, MOVE_PAPER);
      expect(gameField(gameId, "p2-commit")).toStrictEqual(Cl.some(Cl.buffer(commit)));
    });

    it("fails with ERR-GAME-NOT-FOUND for unknown game id", async () => {
      const { result } = await joinGame(999, P2, MOVE_PAPER);
      expect(result.result).toStrictEqual(ERR_GAME_NOT_FOUND);
    });

    it("fails with ERR-SAME-PLAYER if p1 tries to join own game", async () => {
      const { gameId } = await createGame(P1, MOVE_ROCK);
      const { result } = await joinGame(gameId, P1, MOVE_PAPER);
      expect(result.result).toStrictEqual(ERR_SAME_PLAYER);
    });

    it("fails with ERR-GAME-FULL if a third player tries to join", async () => {
      const { gameId } = await createGame(P1, MOVE_ROCK);
      await joinGame(gameId, P2, MOVE_PAPER);
      const { result } = await joinGame(gameId, P3, MOVE_SCISSORS);
      expect(result.result).toStrictEqual(ERR_GAME_FULL);
    });

    it("fails with ERR-GAME-FULL if same p2 tries to join again", async () => {
      const { gameId } = await createGame(P1, MOVE_ROCK);
      await joinGame(gameId, P2, MOVE_PAPER);
      const { result } = await joinGame(gameId, P2, MOVE_SCISSORS);
      expect(result.result).toStrictEqual(ERR_GAME_FULL);
    });
  });

  // --------------------------------------------------------------
  // reveal
  // --------------------------------------------------------------

  describe("reveal", () => {
    it("returns u99 (waiting) after first reveal", async () => {
      const { gameId, salt: s1 } = await createGame(P1, MOVE_ROCK);
      await joinGame(gameId, P2, MOVE_PAPER);
      const r = await reveal(gameId, P1, MOVE_ROCK, s1);
      expect(r.result).toStrictEqual(Cl.ok(Cl.uint(99)));
    });

    it("fails with ERR-NOT-READY if p2 hasn't joined yet", async () => {
      const { gameId, salt: s1 } = await createGame(P1, MOVE_ROCK);
      const r = await reveal(gameId, P1, MOVE_ROCK, s1);
      expect(r.result).toStrictEqual(ERR_NOT_READY);
    });

    it("fails with ERR-GAME-NOT-FOUND for unknown game id", async () => {
      const salt = randomSalt();
      const r = await reveal(999, P1, MOVE_ROCK, salt);
      expect(r.result).toStrictEqual(ERR_GAME_NOT_FOUND);
    });

    it("fails with ERR-NOT-YOUR-GAME for a stranger", async () => {
      const { gameId, salt: s1 } = await createGame(P1, MOVE_ROCK);
      await joinGame(gameId, P2, MOVE_PAPER);
      const r = await reveal(gameId, P3, MOVE_ROCK, s1);
      expect(r.result).toStrictEqual(ERR_NOT_YOUR_GAME);
    });

    it("fails with ERR-INVALID-MOVE for move u0 (NONE)", async () => {
      const { gameId, salt: s1 } = await createGame(P1, MOVE_ROCK);
      await joinGame(gameId, P2, MOVE_PAPER);
      const r = await reveal(gameId, P1, 0, s1);
      expect(r.result).toStrictEqual(ERR_INVALID_MOVE);
    });

    it("fails with ERR-INVALID-MOVE for move u4 (out of range)", async () => {
      const { gameId, salt: s1 } = await createGame(P1, MOVE_ROCK);
      await joinGame(gameId, P2, MOVE_PAPER);
      const r = await reveal(gameId, P1, 4, s1);
      expect(r.result).toStrictEqual(ERR_INVALID_MOVE);
    });

    it("fails with ERR-BAD-COMMIT if p1 reveals wrong move", async () => {
      const { gameId, salt: s1 } = await createGame(P1, MOVE_ROCK);
      await joinGame(gameId, P2, MOVE_PAPER);
      // Committed Rock but tries to reveal Paper
      const r = await reveal(gameId, P1, MOVE_PAPER, s1);
      expect(r.result).toStrictEqual(ERR_BAD_COMMIT);
    });

    it("fails with ERR-BAD-COMMIT if p1 uses wrong salt", async () => {
      const { gameId } = await createGame(P1, MOVE_ROCK);
      await joinGame(gameId, P2, MOVE_PAPER);
      const wrongSalt = randomSalt();
      const r = await reveal(gameId, P1, MOVE_ROCK, wrongSalt);
      expect(r.result).toStrictEqual(ERR_BAD_COMMIT);
    });

    it("fails with ERR-BAD-COMMIT if p2 reveals wrong move", async () => {
      const { gameId, salt: s1 } = await createGame(P1, MOVE_ROCK);
      const { salt: s2 }         = await joinGame(gameId, P2, MOVE_PAPER);
      await reveal(gameId, P1, MOVE_ROCK, s1);
      // Committed Paper but tries to reveal Scissors
      const r = await reveal(gameId, P2, MOVE_SCISSORS, s2);
      expect(r.result).toStrictEqual(ERR_BAD_COMMIT);
    });

    it("fails with ERR-ALREADY-REVEALED if p1 reveals twice", async () => {
      const { gameId, salt: s1 } = await createGame(P1, MOVE_ROCK);
      await joinGame(gameId, P2, MOVE_PAPER);
      await reveal(gameId, P1, MOVE_ROCK, s1);
      const r = await reveal(gameId, P1, MOVE_ROCK, s1);
      expect(r.result).toStrictEqual(ERR_ALREADY_REVEALED);
    });

    it("fails with ERR-ALREADY-REVEALED if p2 reveals twice", async () => {
      const { gameId, salt: s1 } = await createGame(P1, MOVE_ROCK);
      const { salt: s2 }         = await joinGame(gameId, P2, MOVE_PAPER);
      await reveal(gameId, P1, MOVE_ROCK, s1);
      await reveal(gameId, P2, MOVE_PAPER, s2);
      const r = await reveal(gameId, P2, MOVE_PAPER, s2);
      expect(r.result).toStrictEqual(ERR_GAME_OVER);
    });

    it("fails with ERR-GAME-OVER if reveal attempted on finished game", async () => {
      const { gameId, finalReveal } = await playFullGame(MOVE_ROCK, MOVE_SCISSORS);
      const salt = randomSalt();
      const r = await reveal(gameId, P1, MOVE_ROCK, salt);
      expect(r.result).toStrictEqual(ERR_GAME_OVER);
    });
  });

  // --------------------------------------------------------------
  // Game outcomes — all 9 move combinations
  // --------------------------------------------------------------

  describe("game outcomes", () => {
    it("Rock vs Rock → draw (u0)", async () => {
      const { finalReveal } = await playFullGame(MOVE_ROCK, MOVE_ROCK);
      expect(finalReveal.result).toStrictEqual(Cl.ok(Cl.uint(0)));
    });

    it("Paper vs Paper → draw (u0)", async () => {
      const { finalReveal } = await playFullGame(MOVE_PAPER, MOVE_PAPER);
      expect(finalReveal.result).toStrictEqual(Cl.ok(Cl.uint(0)));
    });

    it("Scissors vs Scissors → draw (u0)", async () => {
      const { finalReveal } = await playFullGame(MOVE_SCISSORS, MOVE_SCISSORS);
      expect(finalReveal.result).toStrictEqual(Cl.ok(Cl.uint(0)));
    });

    it("Rock vs Scissors → p1 wins (u1)", async () => {
      const { finalReveal } = await playFullGame(MOVE_ROCK, MOVE_SCISSORS);
      expect(finalReveal.result).toStrictEqual(Cl.ok(Cl.uint(1)));
    });

    it("Paper vs Rock → p1 wins (u1)", async () => {
      const { finalReveal } = await playFullGame(MOVE_PAPER, MOVE_ROCK);
      expect(finalReveal.result).toStrictEqual(Cl.ok(Cl.uint(1)));
    });

    it("Scissors vs Paper → p1 wins (u1)", async () => {
      const { finalReveal } = await playFullGame(MOVE_SCISSORS, MOVE_PAPER);
      expect(finalReveal.result).toStrictEqual(Cl.ok(Cl.uint(1)));
    });

    it("Scissors vs Rock → p2 wins (u2)", async () => {
      const { finalReveal } = await playFullGame(MOVE_SCISSORS, MOVE_ROCK);
      expect(finalReveal.result).toStrictEqual(Cl.ok(Cl.uint(2)));
    });

    it("Rock vs Paper → p2 wins (u2)", async () => {
      const { finalReveal } = await playFullGame(MOVE_ROCK, MOVE_PAPER);
      expect(finalReveal.result).toStrictEqual(Cl.ok(Cl.uint(2)));
    });

    it("Paper vs Scissors → p2 wins (u2)", async () => {
      const { finalReveal } = await playFullGame(MOVE_PAPER, MOVE_SCISSORS);
      expect(finalReveal.result).toStrictEqual(Cl.ok(Cl.uint(2)));
    });
  });

  // --------------------------------------------------------------
  // Post-game state
  // --------------------------------------------------------------

  describe("post-game state", () => {
    it("sets status to DONE (u2) after both reveal", async () => {
      const { gameId } = await playFullGame(MOVE_ROCK, MOVE_SCISSORS);
      expect(gameField(gameId, "status")).toStrictEqual(Cl.uint(2));
    });

    it("sets winner to p1 address when p1 wins", async () => {
      const { gameId } = await playFullGame(MOVE_ROCK, MOVE_SCISSORS);
      expect(gameField(gameId, "winner")).toStrictEqual(Cl.some(Cl.principal(P1)));
    });

    it("sets winner to p2 address when p2 wins", async () => {
      const { gameId } = await playFullGame(MOVE_SCISSORS, MOVE_ROCK);
      expect(gameField(gameId, "winner")).toStrictEqual(Cl.some(Cl.principal(P2)));
    });

    it("sets winner to none on a draw", async () => {
      const { gameId } = await playFullGame(MOVE_PAPER, MOVE_PAPER);
      expect(gameField(gameId, "winner")).toStrictEqual(Cl.none());
    });

    it("records both moves after full reveal", async () => {
      const { gameId } = await playFullGame(MOVE_ROCK, MOVE_PAPER);
      expect(gameField(gameId, "p1-move")).toStrictEqual(Cl.uint(MOVE_ROCK));
      expect(gameField(gameId, "p2-move")).toStrictEqual(Cl.uint(MOVE_PAPER));
    });

    it("p2 reveal order can come before p1 — game still resolves", async () => {
      const { gameId, salt: s1 } = await createGame(P1, MOVE_ROCK);
      const { salt: s2 }         = await joinGame(gameId, P2, MOVE_SCISSORS);
      // p2 reveals first
      const r1 = await reveal(gameId, P2, MOVE_SCISSORS, s2);
      expect(r1.result).toStrictEqual(Cl.ok(Cl.uint(99))); // waiting
      // p1 reveals second — should resolve
      const r2 = await reveal(gameId, P1, MOVE_ROCK, s1);
      expect(r2.result).toStrictEqual(Cl.ok(Cl.uint(1))); // p1 wins
    });
  });

  // --------------------------------------------------------------
  // player-stats
  // --------------------------------------------------------------

  describe("player-stats", () => {
    it("new player starts with all zeros", () => {
      expect(statField(P3, "wins")).toBe(0n);
      expect(statField(P3, "losses")).toBe(0n);
      expect(statField(P3, "draws")).toBe(0n);
      expect(statField(P3, "games-played")).toBe(0n);
    });

    it("win increments winner wins and games-played", async () => {
      await playFullGame(MOVE_ROCK, MOVE_SCISSORS); // P1 wins
      expect(statField(P1, "wins")).toBe(1n);
      expect(statField(P1, "games-played")).toBe(1n);
    });

    it("win increments loser losses and games-played", async () => {
      await playFullGame(MOVE_ROCK, MOVE_SCISSORS); // P2 loses
      expect(statField(P2, "losses")).toBe(1n);
      expect(statField(P2, "games-played")).toBe(1n);
    });

    it("draw increments draws for both players", async () => {
      await playFullGame(MOVE_PAPER, MOVE_PAPER);
      expect(statField(P1, "draws")).toBe(1n);
      expect(statField(P2, "draws")).toBe(1n);
    });

    it("draw does not increment wins or losses", async () => {
      await playFullGame(MOVE_PAPER, MOVE_PAPER);
      expect(statField(P1, "wins")).toBe(0n);
      expect(statField(P1, "losses")).toBe(0n);
    });

    it("stats accumulate correctly across multiple games", async () => {
      await playFullGame(MOVE_ROCK, MOVE_SCISSORS); // P1 wins
      await playFullGame(MOVE_ROCK, MOVE_SCISSORS); // P1 wins
      await playFullGame(MOVE_PAPER, MOVE_PAPER);   // draw
      await playFullGame(MOVE_SCISSORS, MOVE_ROCK); // P1 loses

      expect(statField(P1, "wins")).toBe(2n);
      expect(statField(P1, "losses")).toBe(1n);
      expect(statField(P1, "draws")).toBe(1n);
      expect(statField(P1, "games-played")).toBe(4n);
    });

    it("p2 stats are tracked independently from p1", async () => {
      await playFullGame(MOVE_SCISSORS, MOVE_ROCK); // P2 wins
      expect(statField(P2, "wins")).toBe(1n);
      expect(statField(P1, "losses")).toBe(1n);
    });
  });

  // --------------------------------------------------------------
  // read-only helpers
  // --------------------------------------------------------------

  describe("read-only functions", () => {
    it("get-total-games returns 0 with no games", () => {
      const r = simnet.callReadOnlyFn(CONTRACT, "get-total-games", [], DEPLOYER);
      expect(r.result).toStrictEqual(Cl.uint(0));
    });

    it("get-total-games returns correct count after multiple creates", async () => {
      await createGame(P1, MOVE_ROCK);
      await createGame(P2, MOVE_PAPER);
      await createGame(P3, MOVE_SCISSORS);
      const r = simnet.callReadOnlyFn(CONTRACT, "get-total-games", [], DEPLOYER);
      expect(r.result).toStrictEqual(Cl.uint(3));
    });

    it("get-game returns none for an id that doesn't exist", () => {
      const r = getGame(999);
      expect(r.result).toStrictEqual(Cl.none());
    });

    it("get-game returns some after game is created", async () => {
      const { gameId } = await createGame(P1, MOVE_ROCK);
      const r = getGame(gameId);
      expect(r.result.type).toBe(ClarityType.OptionalSome);
    });

    it("move-name returns Rock for u1", () => {
      const r = simnet.callReadOnlyFn(CONTRACT, "move-name", [Cl.uint(1)], DEPLOYER);
      expect(r.result).toStrictEqual(Cl.stringAscii("Rock"));
    });

    it("move-name returns Paper for u2", () => {
      const r = simnet.callReadOnlyFn(CONTRACT, "move-name", [Cl.uint(2)], DEPLOYER);
      expect(r.result).toStrictEqual(Cl.stringAscii("Paper"));
    });

    it("move-name returns Scissors for u3", () => {
      const r = simnet.callReadOnlyFn(CONTRACT, "move-name", [Cl.uint(3)], DEPLOYER);
      expect(r.result).toStrictEqual(Cl.stringAscii("Scissors"));
    });

    it("move-name returns None for u0", () => {
      const r = simnet.callReadOnlyFn(CONTRACT, "move-name", [Cl.uint(0)], DEPLOYER);
      expect(r.result).toStrictEqual(Cl.stringAscii("None"));
    });

    it("get-player-stats returns zeroed struct for unknown player", () => {
      const r    = getStats(P3);
      const data = (r.result as any).value.data;
      expect(data["wins"].value).toBe(0n);
      expect(data["losses"].value).toBe(0n);
      expect(data["draws"].value).toBe(0n);
      expect(data["games-played"].value).toBe(0n);
    });
  });

  // --------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------

  describe("edge cases", () => {
    it("multiple games can be active simultaneously", async () => {
      const { gameId: g1, salt: s1a } = await createGame(P1, MOVE_ROCK);
      const { gameId: g2, salt: s1b } = await createGame(P1, MOVE_PAPER);

      await joinGame(g1, P2, MOVE_SCISSORS);
      await joinGame(g2, P3, MOVE_ROCK);

      expect(gameField(g1, "status")).toStrictEqual(Cl.uint(1));
      expect(gameField(g2, "status")).toStrictEqual(Cl.uint(1));
    });

    it("game state of one game does not affect another", async () => {
      const { gameId: g1 } = await playFullGame(MOVE_ROCK, MOVE_SCISSORS);
      const { gameId: g2, salt: s1 } = await createGame(P1, MOVE_PAPER);
      await joinGame(g2, P2, MOVE_SCISSORS);

      // g1 is done, g2 is still active
      expect(gameField(g1, "status")).toStrictEqual(Cl.uint(2));
      expect(gameField(g2, "status")).toStrictEqual(Cl.uint(1));
    });

    it("commit is unique per player per game — different salts produce different commits", async () => {
      const salt1 = randomSalt();
      const salt2 = randomSalt();
      const c1 = await makeCommit(MOVE_ROCK, salt1);
      const c2 = await makeCommit(MOVE_ROCK, salt2);
      // Same move, different salts → different commits
      expect(Buffer.from(c1).toString("hex")).not.toBe(Buffer.from(c2).toString("hex"));
    });

    it("p3 cannot join a game between p1 and p2 that is already active", async () => {
      const { gameId } = await createGame(P1, MOVE_ROCK);
      await joinGame(gameId, P2, MOVE_PAPER);
      const { result } = await joinGame(gameId, P3, MOVE_SCISSORS);
      expect(result.result).toStrictEqual(ERR_GAME_FULL);
    });

    it("p1 cannot reveal with a valid move but wrong game id", async () => {
      const { salt: s1 } = await createGame(P1, MOVE_ROCK);
      await createGame(P2, MOVE_PAPER); // game id 1
      await joinGame(1, P3, MOVE_SCISSORS);
      // P1 tries to use their salt on a game they're not part of
      const r = await reveal(1, P1, MOVE_ROCK, s1);
      expect(r.result).toStrictEqual(ERR_NOT_YOUR_GAME);
    });
  });
});
