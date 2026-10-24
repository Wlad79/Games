import "./style.css";
import { Chess, type Move, type Square } from "chess.js";
import { ThreeChessBoard, type MoveRecord } from "./board";

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleProfile {
  sub: string;
  name: string;
  email: string;
  picture?: string;
}

interface GoogleIdentity {
  oauth2: {
    initTokenClient(options: {
      client_id: string;
      scope: string;
      callback: (response: GoogleTokenResponse) => void;
      error_callback: (error: { type: string; message?: string }) => void;
    }): { requestAccessToken(options?: { prompt?: string }): void };
  };
}

declare global {
  interface Window {
    google?: { accounts: GoogleIdentity };
  }
}

interface Player {
  id: string;
  name: string;
  email: string;
  picture?: string;
}

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required page element is missing: ${selector}`);
  return element;
};

const loginView = $("#login-view");
const lobbyView = $("#lobby-view");
const gameView = $("#game-view");
const accountArea = $("#account-area");
const accountName = $("#account-name");
const lobbyMessage = $("#lobby-message");
const gameMessage = $("#game-message");
const gameCanvasContainer = $("#chess-board");
const moveList = $("#move-list");
const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();

let player: Player | null = null;
let chess: Chess | null = null;
let board: ThreeChessBoard | null = null;
let selectedSquare: Square | null = null;
let selectedTargets: Square[] = [];
let lastMove: MoveRecord | undefined;
let computerThinking = false;
let activeAccessToken: string | null = null;
let difficulty = 2;

loginView.hidden = false;
if (!clientId) {
  showMessage(
    $("#login-view .quiet-note"),
    "Add VITE_GOOGLE_CLIENT_ID to .env.local. Create a Google OAuth web client and authorize this app's hostname.",
  );
} else {
  $("#sign-in").removeAttribute("disabled");
  $("#sign-in").addEventListener("click", signInWithGoogle);
}

$("#sign-out").addEventListener("click", signOutPlayer);
$("#start-game").addEventListener("click", startGame);
$("#new-game").addEventListener("click", startGame);
$("#back-to-lobby").addEventListener("click", returnToLobby);
$("#difficulty").addEventListener("change", (event) => {
  difficulty = Number((event.currentTarget as HTMLSelectElement).value);
});

function signInWithGoogle(): void {
  if (!clientId) return;
  if (!window.google) {
    showMessage($("#login-view .quiet-note"), "Google sign-in is still loading. Please try again in a moment.");
    return;
  }
  showMessage($("#login-view .quiet-note"), "");
  const tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: "openid email profile",
    callback: (response) => {
      if (!response.access_token) {
        showMessage($("#login-view .quiet-note"), response.error_description ?? response.error ?? "Google sign-in failed.");
        return;
      }
      activeAccessToken = response.access_token;
      void fetchGoogleProfile(response.access_token);
    },
    error_callback: (error) => {
      showMessage($("#login-view .quiet-note"), error.message ?? `Google sign-in failed (${error.type}).`);
    },
  });
  tokenClient.requestAccessToken({ prompt: "consent" });
}

async function fetchGoogleProfile(accessToken: string): Promise<void> {
  try {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(`Google profile request failed (${response.status}).`);
    const profile = await response.json() as GoogleProfile;
    if (!profile.sub || !profile.name || !profile.email) throw new Error("Google returned an incomplete profile.");
    player = { id: profile.sub, name: profile.name, email: profile.email, picture: profile.picture };
    accountName.textContent = player.name;
    accountArea.hidden = false;
    loginView.hidden = true;
    lobbyView.hidden = false;
    gameView.hidden = true;
    showMessage(lobbyMessage, "");
  } catch (error) {
    activeAccessToken = null;
    showMessage($("#login-view .quiet-note"), errorMessage(error, "Could not retrieve your Google profile."));
  }
}

function signOutPlayer(): void {
  if (activeAccessToken) {
    void fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(activeAccessToken)}`, { method: "POST" });
  }
  player = null;
  activeAccessToken = null;
  abandonGame();
  accountArea.hidden = true;
  loginView.hidden = false;
  lobbyView.hidden = true;
  gameView.hidden = true;
}

function startGame(): void {
  if (!player) {
    showMessage(lobbyMessage, "Sign in with Google before starting a game.");
    return;
  }
  abandonGame();
  chess = new Chess();
  difficulty = Number(($("#difficulty") as HTMLSelectElement).value);
  lastMove = undefined;
  lobbyView.hidden = true;
  gameView.hidden = false;
  showMessage(gameMessage, "");
  $("#game-title").textContent = "You vs. Computer";
  $("#white-name").textContent = player.name;
  $("#black-name").textContent = "Chess computer";
  $("#white-side").textContent = "WHITE · YOU";
  $("#black-side").textContent = "BLACK · COMPUTER";
  $("#white-turn").classList.add("active");
  $("#black-turn").classList.remove("active");
  board ??= new ThreeChessBoard(gameCanvasContainer, handleSquareClick);
  board.setPerspective("w");
  renderGame();
}

function returnToLobby(): void {
  abandonGame();
  gameView.hidden = true;
  lobbyView.hidden = !player;
  loginView.hidden = Boolean(player);
  showMessage(lobbyMessage, "");
}

function abandonGame(): void {
  chess = null;
  selectedSquare = null;
  selectedTargets = [];
  lastMove = undefined;
  computerThinking = false;
  board?.clearSelection();
}

function handleSquareClick(square: Square): void {
  if (!chess || chess.isGameOver() || chess.turn() !== "w" || computerThinking) return;
  const clickedPiece = chess.get(square);
  if (selectedSquare && selectedTargets.includes(square)) {
    makeMove(selectedSquare, square);
    return;
  }
  if (clickedPiece?.color === "w") {
    selectedSquare = square;
    selectedTargets = chess.moves({ square, verbose: true }).map((move) => move.to);
  } else {
    selectedSquare = null;
    selectedTargets = [];
  }
  renderGame();
}

function makeMove(from: Square, to: Square): void {
  if (!chess) return;
  const move = chess.move({ from, to, promotion: "q" });
  lastMove = {
    from: move.from,
    to: move.to,
    san: move.san,
    ...(move.promotion ? { promotion: move.promotion } : {}),
  };
  selectedSquare = null;
  selectedTargets = [];
  showMessage(gameMessage, "");
  renderGame();
  if (chess.isGameOver()) return;

  computerThinking = true;
  renderStatus();
  window.setTimeout(() => {
    if (!chess || chess.isGameOver() || !computerThinking) return;
    try {
      const computerMove = chooseComputerMove(chess, difficulty);
      if (!computerMove) throw new Error("The computer could not find a legal move.");
      const played = chess.move(computerMove);
      lastMove = {
        from: played.from,
        to: played.to,
        san: played.san,
        ...(played.promotion ? { promotion: played.promotion } : {}),
      };
    } catch (error) {
      showMessage(gameMessage, errorMessage(error, "The computer could not make a move."));
    } finally {
      computerThinking = false;
      renderGame();
    }
  }, 350);
}

function chooseComputerMove(position: Chess, depth: number): { from: Square; to: Square; promotion?: string } | null {
  const moves = orderedMoves(position);
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestMoves: typeof moves = [];
  for (const move of moves) {
    position.move({ from: move.from, to: move.to, promotion: move.promotion });
    const score = search(position, depth - 1, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY);
    position.undo();
    if (score > bestScore) {
      bestScore = score;
      bestMoves = [move];
    } else if (score === bestScore) {
      bestMoves.push(move);
    }
  }
  if (bestMoves.length === 0) return null;
  const chosen = bestMoves[Math.floor(Math.random() * bestMoves.length)];
  return { from: chosen.from, to: chosen.to, ...(chosen.promotion ? { promotion: chosen.promotion } : {}) };
}

function search(position: Chess, depth: number, alpha: number, beta: number): number {
  if (position.isCheckmate()) return position.turn() === "b" ? -100_000 - depth : 100_000 + depth;
  if (position.isDraw()) return 0;
  if (depth === 0) return evaluate(position);

  const maximizing = position.turn() === "b";
  let best = maximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  for (const move of orderedMoves(position)) {
    position.move({ from: move.from, to: move.to, promotion: move.promotion });
    const score = search(position, depth - 1, alpha, beta);
    position.undo();
    if (maximizing) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, best);
    }
    if (alpha >= beta) break;
  }
  return best;
}

function orderedMoves(position: Chess): Move[] {
  return position.moves({ verbose: true }).sort((left, right) => {
    const priority = (move: Move) =>
      (move.captured ? 10 + pieceValue(move.captured) : 0) + (move.promotion ? pieceValue(move.promotion) : 0);
    return priority(right) - priority(left);
  });
}

function evaluate(position: Chess): number {
  const values: Record<string, number> = { p: 100, n: 320, b: 335, r: 500, q: 900, k: 0 };
  let score = 0;
  for (const row of position.board()) {
    for (const piece of row) {
      if (piece) score += (piece.color === "b" ? 1 : -1) * values[piece.type];
    }
  }
  return score;
}

function pieceValue(piece: string): number {
  return ({ p: 100, n: 320, b: 335, r: 500, q: 900, k: 20_000 })[piece] ?? 0;
}

function renderGame(): void {
  if (!chess) return;
  $("#move-count").textContent = String(chess.history().length).padStart(2, "0");
  moveList.replaceChildren();
  const history = chess.history();
  for (let index = 0; index < history.length; index += 2) {
    const row = document.createElement("li");
    const number = document.createElement("span");
    number.textContent = `${Math.floor(index / 2) + 1}.`;
    const white = document.createElement("strong");
    white.textContent = history[index];
    row.append(number, white);
    if (history[index + 1]) {
      const black = document.createElement("strong");
      black.textContent = history[index + 1];
      row.append(black);
    }
    moveList.append(row);
  }
  moveList.scrollTop = moveList.scrollHeight;
  renderStatus();
  board?.render(chess, lastMove, selectedSquare, selectedTargets);
}

function renderStatus(): void {
  if (!chess) return;
  const turn = chess.turn();
  const finished = chess.isGameOver();
  $("#white-turn").classList.toggle("active", !finished && turn === "w");
  $("#black-turn").classList.toggle("active", !finished && turn === "b");
  if (finished) {
    $("#game-status").textContent = gameOutcome(chess);
    $("#game-detail").textContent = "Start a new game whenever you’re ready.";
  } else if (computerThinking) {
    $("#game-status").textContent = "Computer is thinking";
    $("#game-detail").textContent = `Playing at ${difficultyLabel(difficulty)} strength.`;
  } else if (turn === "w") {
    $("#game-status").textContent = "Your turn";
    $("#game-detail").textContent = "Choose a piece to see its legal moves.";
  } else {
    $("#game-status").textContent = "Computer’s turn";
    $("#game-detail").textContent = `The computer is playing at ${difficultyLabel(difficulty)} strength.`;
  }
}

function difficultyLabel(level: number): string {
  return ({ 1: "easy", 2: "medium", 3: "hard" })[level] ?? "medium";
}

function gameOutcome(position: Chess): string {
  if (position.isCheckmate()) return position.turn() === "w" ? "Computer wins" : "You win";
  if (position.isStalemate()) return "Draw by stalemate";
  if (position.isThreefoldRepetition()) return "Draw by repetition";
  if (position.isInsufficientMaterial()) return "Draw by insufficient material";
  return "Draw";
}

function showMessage(element: Element, message: string): void {
  element.textContent = message;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
