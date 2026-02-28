import { useState, useEffect } from "react";
import { makeCommit } from "./utils/crypto";
import {
  connectWallet,
  disconnectWallet,
  getWalletState,
  callContract,
  readContract,
  WalletState,
} from "./utils/stacks";
import { CONTRACT_ADDRESS, CONTRACT_NAME } from "./utils/contract";

type Screen = "home" | "create" | "join" | "game" | "reveal" | "result";
type Move = "rock" | "paper" | "scissors";

interface GameState {
  gameId: number | null;
  move: Move | null;
  salt: string | null;
  commit: string | null;
  status: number | null;
  winner: string | null;
  p1Move: number;
  p2Move: number;
}

const MOVE_ICONS: Record<Move, string> = { rock: "✊", paper: "✋", scissors: "✌️" };
const MOVE_NUMS: Record<Move, number> = { rock: 1, paper: 2, scissors: 3 };
const NUM_MOVES: Record<number, Move> = { 1: "rock", 2: "paper", 3: "scissors" };

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [game, setGame] = useState<GameState>({
    gameId: null, move: null, salt: null, commit: null,
    status: null, winner: null, p1Move: 0, p2Move: 0,
  });
  const [joinId, setJoinId] = useState("");
  const [revealGameId, setRevealGameId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<{ wins: number; losses: number; draws: number; played: number } | null>(null);
  const [glitch, setGlitch] = useState(false);
  const [txId, setTxId] = useState<string | null>(null);

  useEffect(() => {
    setGlitch(true);
    const t = setTimeout(() => setGlitch(false), 400);
    return () => clearTimeout(t);
  }, [screen]);

  useEffect(() => {
    const w = getWalletState();
    if (w) setWallet(w);
  }, []);

  useEffect(() => {
    if (wallet?.address) loadStats(wallet.address);
  }, [wallet?.address]);

  async function loadStats(address: string) {
    try {
      const result = await readContract("get-player-stats", [{ type: "principal", value: address }]);
      if (result) {
        setStats({
          wins: Number(result.wins?.value ?? 0),
          losses: Number(result.losses?.value ?? 0),
          draws: Number(result.draws?.value ?? 0),
          played: Number(result["games-played"]?.value ?? 0),
        });
      }
    } catch {}
  }

  async function handleConnect() {
    setLoading(true); setError("");
    try {
      const w = await connectWallet();
      setWallet(w);
    } catch (e: any) { setError(e.message ?? "Connection failed"); }
    setLoading(false);
  }

  function handleDisconnect() {
    disconnectWallet(); setWallet(null); setStats(null); setScreen("home");
  }

  async function handleCreateGame(move: Move) {
    if (!wallet) return;
    setLoading(true); setError("");
    try {
      const { commit, salt } = await makeCommit(MOVE_NUMS[move]);
      const tx = await callContract("create-game", [{ type: "buff", value: commit }]);
      setTxId(tx);
      setGame(g => ({ ...g, move, salt, commit, gameId: null }));
      setScreen("game");
    } catch (e: any) { setError(e.message ?? "Failed to create game"); }
    setLoading(false);
  }

  async function handleJoinGame(move: Move) {
    if (!wallet || !joinId) return;
    setLoading(true); setError("");
    try {
      const { commit, salt } = await makeCommit(MOVE_NUMS[move]);
      const tx = await callContract("join-game", [
        { type: "uint", value: joinId },
        { type: "buff", value: commit },
      ]);
      setTxId(tx);
      setGame(g => ({ ...g, move, salt, commit, gameId: Number(joinId) }));
      setScreen("reveal");
    } catch (e: any) { setError(e.message ?? "Failed to join game"); }
    setLoading(false);
  }

  async function handleReveal() {
    if (!wallet || !game.move || !game.salt) return;
    const id = game.gameId ?? Number(revealGameId);
    if (isNaN(id)) { setError("Enter a valid game ID"); return; }
    setLoading(true); setError("");
    try {
      const tx = await callContract("reveal", [
        { type: "uint", value: id.toString() },
        { type: "uint", value: MOVE_NUMS[game.move].toString() },
        { type: "buff", value: game.salt },
      ]);
      setTxId(tx);
      setScreen("result");
      setTimeout(() => loadGameResult(id), 5000);
    } catch (e: any) { setError(e.message ?? "Reveal failed"); }
    setLoading(false);
  }

  async function loadGameResult(id: number) {
    try {
      const g = await readContract("get-game", [{ type: "uint", value: id.toString() }]);
      if (g) {
        setGame(prev => ({
          ...prev,
          status: Number(g.status?.value ?? 0),
          winner: g.winner?.value?.value ?? null,
          p1Move: Number(g["p1-move"]?.value ?? 0),
          p2Move: Number(g["p2-move"]?.value ?? 0),
        }));
        if (wallet?.address) loadStats(wallet.address);
      }
    } catch {}
  }

  function reset() {
    setGame({ gameId: null, move: null, salt: null, commit: null, status: null, winner: null, p1Move: 0, p2Move: 0 });
    setJoinId(""); setRevealGameId(""); setError(""); setTxId(null); setScreen("home");
  }

  const currentGameId = game.gameId ?? (revealGameId ? Number(revealGameId) : null);

  return (
    <div className={`app ${glitch ? "glitch" : ""}`}>
      <div className="scanlines" />
      <div className="noise" />

      <header className="header">
        <div className="logo" onClick={reset} style={{ cursor: "pointer" }}>
          <span className="logo-rps">RPS</span>
          <span className="logo-chain">CHAIN</span>
        </div>
        <div className="header-right">
          {wallet ? (
            <div className="wallet-info">
              <div className="wallet-address">{wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}</div>
              {stats && (
                <div className="wallet-stats">
                  <span className="stat-w">{stats.wins}W</span>
                  <span className="stat-d">{stats.draws}D</span>
                  <span className="stat-l">{stats.losses}L</span>
                </div>
              )}
              <button className="btn-ghost" onClick={handleDisconnect}>DISCONNECT</button>
            </div>
          ) : (
            <button className="btn-primary" onClick={handleConnect} disabled={loading}>
              {loading ? "CONNECTING…" : "CONNECT WALLET"}
            </button>
          )}
        </div>
      </header>

      <main className="main">
        {error && <div className="error-banner">⚠ {error}<button onClick={() => setError("")}>×</button></div>}
        {txId && (
          <div className="tx-banner">
            TX: <a href={`https://explorer.hiro.so/txid/${txId}?chain=testnet`} target="_blank" rel="noreferrer">
              {txId.slice(0, 10)}…{txId.slice(-6)} ↗
            </a>
            <button onClick={() => setTxId(null)}>×</button>
          </div>
        )}

        {screen === "home"   && <HomeScreen wallet={wallet} onNavigate={setScreen} onConnect={handleConnect} loading={loading} />}
        {screen === "create" && <MoveSelect title="PICK YOUR MOVE" subtitle="Stays hidden until both players reveal" onSelect={handleCreateGame} onBack={() => setScreen("home")} loading={loading} />}
        {screen === "join"   && <JoinScreen joinId={joinId} setJoinId={setJoinId} onSelect={handleJoinGame} onBack={() => setScreen("home")} loading={loading} />}
        {screen === "game"   && <GameCreatedScreen game={game} onReveal={() => setScreen("reveal")} onHome={reset} />}
        {screen === "reveal" && <RevealScreen game={game} revealGameId={revealGameId} setRevealGameId={setRevealGameId} onReveal={handleReveal} onBack={() => setScreen("home")} loading={loading} />}
        {screen === "result" && <ResultScreen game={game} wallet={wallet} onPlayAgain={reset} onRefresh={() => currentGameId !== null && loadGameResult(currentGameId)} />}
      </main>

      <footer className="footer">
        <span>STACKS TESTNET</span>
        <span className="footer-contract">{CONTRACT_ADDRESS}.{CONTRACT_NAME}</span>
        <a href={`https://explorer.hiro.so/address/${CONTRACT_ADDRESS}.${CONTRACT_NAME}?chain=testnet`} target="_blank" rel="noreferrer">EXPLORER ↗</a>
      </footer>
    </div>
  );
}

// ── Screens ───────────────────────────────────────────────────────────────────

function HomeScreen({ wallet, onNavigate, onConnect, loading }: any) {
  return (
    <div className="screen home-screen">
      <div className="hero">
        <div className="hero-moves">
          {["✊", "✋", "✌️"].map((icon, i) => (
            <span key={i} className="hero-move" style={{ animationDelay: `${i * 0.35}s` }}>{icon}</span>
          ))}
        </div>
        <h1 className="hero-title">ROCK<br />PAPER<br />SCISSORS</h1>
        <p className="hero-sub">On-chain · Commit-reveal · No trust required</p>
      </div>

      {wallet ? (
        <div className="home-actions">
          {[
            { key: "create", label: "CREATE GAME", sub: "Start a new challenge", cls: "btn-create" },
            { key: "join", label: "JOIN GAME", sub: "Enter with a game ID", cls: "btn-join" },
            { key: "reveal", label: "REVEAL MOVE", sub: "Complete your reveal", cls: "btn-reveal" },
          ].map(({ key, label, sub, cls }) => (
            <button key={key} className={`btn-arcade ${cls}`} onClick={() => onNavigate(key as Screen)}>
              <span className="btn-label">{label}</span>
              <span className="btn-sub">{sub}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="home-connect">
          <p className="connect-prompt">Connect your Stacks wallet to start playing</p>
          <button className="btn-primary btn-xl" onClick={onConnect} disabled={loading}>
            {loading ? "CONNECTING…" : "CONNECT WALLET"}
          </button>
        </div>
      )}

      <div className="how-it-works">
        <h3>HOW IT WORKS</h3>
        <div className="steps">
          <div className="step"><span className="step-n">01</span><p>P1 picks a move &amp; commits a hidden hash on-chain</p></div>
          <div className="step"><span className="step-n">02</span><p>P2 joins with the game ID and commits their own hash</p></div>
          <div className="step"><span className="step-n">03</span><p>Both reveal — the smart contract determines the winner</p></div>
        </div>
      </div>
    </div>
  );
}

function MoveSelect({ title, subtitle, onSelect, onBack, loading }: any) {
  const [selected, setSelected] = useState<Move | null>(null);
  return (
    <div className="screen move-screen">
      <button className="btn-back" onClick={onBack}>← BACK</button>
      <h2 className="screen-title">{title}</h2>
      <p className="screen-sub">{subtitle}</p>
      <div className="move-grid">
        {(["rock", "paper", "scissors"] as Move[]).map(m => (
          <button key={m} className={`move-card ${selected === m ? "selected" : ""}`} onClick={() => setSelected(m)}>
            <span className="move-icon">{MOVE_ICONS[m]}</span>
            <span className="move-name">{m.toUpperCase()}</span>
          </button>
        ))}
      </div>
      <button className="btn-primary btn-xl" disabled={!selected || loading} onClick={() => selected && onSelect(selected)}>
        {loading ? "SUBMITTING…" : "LOCK IT IN →"}
      </button>
    </div>
  );
}

function JoinScreen({ joinId, setJoinId, onSelect, onBack, loading }: any) {
  const [move, setMove] = useState<Move | null>(null);
  return (
    <div className="screen join-screen">
      <button className="btn-back" onClick={onBack}>← BACK</button>
      <h2 className="screen-title">JOIN GAME</h2>
      <div className="input-group">
        <label className="input-label">GAME ID</label>
        <input className="input-field" type="number" min="0" placeholder="0" value={joinId} onChange={e => setJoinId(e.target.value)} />
      </div>
      <p className="screen-sub" style={{ marginTop: "2rem" }}>PICK YOUR MOVE</p>
      <div className="move-grid">
        {(["rock", "paper", "scissors"] as Move[]).map(m => (
          <button key={m} className={`move-card ${move === m ? "selected" : ""}`} onClick={() => setMove(m)}>
            <span className="move-icon">{MOVE_ICONS[m]}</span>
            <span className="move-name">{m.toUpperCase()}</span>
          </button>
        ))}
      </div>
      <button className="btn-primary btn-xl" disabled={!move || !joinId || loading} onClick={() => move && onSelect(move)}>
        {loading ? "JOINING…" : "JOIN & COMMIT →"}
      </button>
    </div>
  );
}

function GameCreatedScreen({ game, onReveal, onHome }: any) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(String(game.gameId ?? ""));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="screen created-screen">
      <div className="success-badge">✓ COMMITTED ON-CHAIN</div>
      <h2 className="screen-title">WAITING FOR OPPONENT</h2>
      <div className="game-id-display">
        <span className="gid-label">GAME ID</span>
        <span className="gid-value">{game.gameId !== null ? game.gameId : "check TX ↑"}</span>
        <button className="btn-copy" onClick={copy}>{copied ? "COPIED!" : "COPY"}</button>
      </div>
      <div className="secret-box">
        <p className="secret-label">YOUR COMMITTED MOVE</p>
        <p className="secret-move">{game.move ? `${MOVE_ICONS[game.move as Move]} ${game.move.toUpperCase()}` : "?"}</p>
        <p className="secret-warn">⚠ Don't share your move — the chain verifies it on reveal</p>
      </div>
      <div className="created-actions">
        <button className="btn-primary" onClick={onReveal}>I'M READY TO REVEAL</button>
        <button className="btn-ghost" onClick={onHome}>HOME</button>
      </div>
    </div>
  );
}

function RevealScreen({ game, revealGameId, setRevealGameId, onReveal, onBack, loading }: any) {
  return (
    <div className="screen reveal-screen">
      <button className="btn-back" onClick={onBack}>← BACK</button>
      <h2 className="screen-title">REVEAL YOUR MOVE</h2>
      <p className="screen-sub">The chain verifies your reveal matches what you committed</p>
      {game.gameId === null && (
        <div className="input-group">
          <label className="input-label">GAME ID</label>
          <input className="input-field" type="number" min="0" placeholder="0" value={revealGameId} onChange={e => setRevealGameId(e.target.value)} />
        </div>
      )}
      {game.move ? (
        <div className="reveal-move-preview">
          <p className="secret-label">YOU PLAYED</p>
          <div className="reveal-icon">{MOVE_ICONS[game.move as Move]}</div>
          <p className="reveal-move-name">{game.move.toUpperCase()}</p>
        </div>
      ) : (
        <p style={{ color: "var(--red)", textAlign: "center", margin: "2rem 0" }}>
          No session move found — did you create/join from this tab?
        </p>
      )}
      <button className="btn-primary btn-xl btn-glow" onClick={onReveal} disabled={loading || !game.move}>
        {loading ? "REVEALING…" : "REVEAL NOW →"}
      </button>
    </div>
  );
}

function ResultScreen({ game, wallet, onPlayAgain, onRefresh }: any) {
  const isWinner = wallet?.address && game.winner === wallet.address;
  const isDraw = game.status === 2 && !game.winner;
  const p1MoveName = game.p1Move ? NUM_MOVES[game.p1Move] : null;
  const p2MoveName = game.p2Move ? NUM_MOVES[game.p2Move] : null;

  return (
    <div className="screen result-screen">
      {game.status !== 2 ? (
        <div className="waiting-reveal">
          <div className="spinner" />
          <h2>WAITING FOR BOTH REVEALS</h2>
          <p>Share the game ID with your opponent. Once both reveal, the winner is set on-chain.</p>
          <button className="btn-ghost" style={{ marginTop: "1.5rem" }} onClick={onRefresh}>
            CHECK RESULT
          </button>
        </div>
      ) : (
        <>
          <div className={`result-badge ${isWinner ? "win" : isDraw ? "draw" : "loss"}`}>
            {isWinner ? "🏆 YOU WIN!" : isDraw ? "🤝 DRAW" : "💀 YOU LOSE"}
          </div>
          {p1MoveName && p2MoveName && (
            <div className="moves-reveal">
              <div className="player-move">
                <span className="pm-label">PLAYER 1</span>
                <span className="pm-icon">{MOVE_ICONS[p1MoveName]}</span>
                <span className="pm-name">{p1MoveName.toUpperCase()}</span>
              </div>
              <span className="vs-text">VS</span>
              <div className="player-move">
                <span className="pm-label">PLAYER 2</span>
                <span className="pm-icon">{MOVE_ICONS[p2MoveName]}</span>
                <span className="pm-name">{p2MoveName.toUpperCase()}</span>
              </div>
            </div>
          )}
          <button className="btn-primary btn-xl" onClick={onPlayAgain}>PLAY AGAIN</button>
        </>
      )}
    </div>
  );
}
