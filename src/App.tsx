/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RotateCcw, Info, Trophy, User, ChevronRight, ChevronLeft, Cpu, Users, Sparkles, Star, Candy, Globe, Copy, Check, ArrowRight } from 'lucide-react';
import { db } from './firebase';
import { 
  doc, 
  onSnapshot, 
  updateDoc, 
  serverTimestamp, 
  getDoc,
  getDocs,
  query,
  where,
  limit,
  orderBy,
  collection,
  addDoc
} from 'firebase/firestore';

// --- Constants ---
const BOARD_SIZE = 12;
const PLAYER_1_SQUARES = [0, 1, 2, 3, 4];
const PLAYER_2_SQUARES = [6, 7, 8, 9, 10];
const QUAN_SQUARES = [5, 11];

type GameState = 'menu' | 'idle' | 'moving' | 'capturing' | 'gameOver' | 'lobby' | 'setup';

interface BoardState {
  stones: number[];
  scores: [number, number];
  currentPlayer: 0 | 1;
  status: GameState;
  message: string;
  isVsMachine: boolean;
  isOnline?: boolean;
  player1Id?: string;
  player2Id?: string;
  player1Name?: string;
  player2Name?: string;
}

export default function App() {
  const [board, setBoard] = useState<BoardState>({
    stones: [5, 5, 5, 5, 5, 10, 5, 5, 5, 5, 5, 10],
    scores: [0, 0],
    currentPlayer: 0,
    status: 'menu',
    message: 'Welcome to Candy Quan!',
    isVsMachine: true,
  });

  const [playerName, setPlayerName] = useState('');
  const [guestId] = useState(() => {
    const saved = localStorage.getItem('candy_quan_guest_id');
    if (saved) return saved;
    const newId = 'guest_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('candy_quan_guest_id', newId);
    return newId;
  });
  const [gameId, setGameId] = useState<string | null>(null);
  const [shortId, setShortId] = useState<string | null>(null);
  const [playerRole, setPlayerRole] = useState<0 | 1 | null>(null);
  const [copied, setCopied] = useState(false);
  const [publicGames, setPublicGames] = useState<any[]>([]);
  const [selectedSquare, setSelectedSquare] = useState<number | null>(null);
  const [animatingIndex, setAnimatingIndex] = useState<number | null>(null);
  const [showRules, setShowRules] = useState(false);
  const isMovingRef = useRef(false);

  // --- Firebase Sync ---
  useEffect(() => {
    // Listen for public games (lobby status)
    const gamesRef = collection(db, 'games');
    const q = query(
      gamesRef, 
      where('status', '==', 'idle'), 
      where('player2Id', '==', null),
      orderBy('updatedAt', 'desc'),
      limit(10)
    );

    const unsubscribeLobby = onSnapshot(q, (snapshot) => {
      const games = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setPublicGames(games);
    });

    return () => unsubscribeLobby();
  }, []);

  useEffect(() => {
    if (!gameId || !board.isOnline) return;

    const unsubscribe = onSnapshot(doc(db, 'games', gameId), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        
        if (data.shortId && !shortId) {
          setShortId(data.shortId);
        }

        // If we are in lobby and player 2 joins, start the game
        if (board.status === 'lobby' && data.player2Id) {
          setBoard(prev => ({
            ...prev,
            status: 'idle',
            player2Id: data.player2Id,
            player2Name: data.player2Name,
            message: `${data.player2Name} joined! Game Start!`,
          }));
        }

        // Animation Sync: If the other player moved
        if (data.status === 'moving' && data.lastMove && data.lastMove.playerId !== guestId) {
          if (!isMovingRef.current) {
            handleMove(data.lastMove.startIndex, data.lastMove.direction, true);
          }
        }

        if (data.status === 'gameOver' || (data.status === 'idle' && !isMovingRef.current)) {
          setBoard(prev => ({
            ...prev,
            stones: data.stones,
            scores: data.scores as [number, number],
            currentPlayer: data.currentPlayer,
            status: data.status,
            message: data.message,
            player1Id: data.player1Id,
            player2Id: data.player2Id,
            player1Name: data.player1Name,
            player2Name: data.player2Name,
          }));
        }
      }
    });

    return () => unsubscribe();
  }, [gameId, board.isOnline, board.status]);

  const createOnlineGame = async () => {
    if (!playerName.trim()) {
      alert('Please enter your name first!');
      return;
    }
    const newGame = {
      stones: [5, 5, 5, 5, 5, 10, 5, 5, 5, 5, 5, 10],
      scores: [0, 0],
      currentPlayer: 0,
      status: 'idle',
      message: 'Waiting for Player 2...',
      player1Id: guestId,
      player1Name: playerName,
      player2Id: null,
      player2Name: null,
      updatedAt: serverTimestamp(),
    };
    const docRef = await addDoc(collection(db, 'games'), newGame);
    const sId = docRef.id.substring(0, 6).toUpperCase();
    await updateDoc(docRef, { shortId: sId });
    
    setGameId(docRef.id);
    setShortId(sId);
    setPlayerRole(0);
    setBoard({
      ...newGame,
      status: 'lobby',
      isVsMachine: false,
      isOnline: true,
    } as any);
  };

  const joinOnlineGame = async (inputRef: string) => {
    if (!playerName.trim()) {
      alert('Please enter your name first!');
      return;
    }
    if (!inputRef) return;

    // Try to find by full ID first, then by shortId
    let docRef = doc(db, 'games', inputRef);
    let snapshot = await getDoc(docRef);

    if (!snapshot.exists()) {
      // Search by shortId
      const gamesRef = collection(db, 'games');
      const q = query(gamesRef, where('shortId', '==', inputRef.toUpperCase()), limit(1));
      const querySnapshot = await getDocs(q);
      if (!querySnapshot.empty) {
        snapshot = querySnapshot.docs[0];
        docRef = doc(db, 'games', snapshot.id);
      }
    }

    if (snapshot.exists()) {
      const data = snapshot.data();
      if (!data.player2Id && data.player1Id !== guestId) {
        await updateDoc(docRef, {
          player2Id: guestId,
          player2Name: playerName,
          message: `${playerName} joined! Game Start!`,
          updatedAt: serverTimestamp(),
        });
        setPlayerRole(1);
      } else if (data.player1Id === guestId) {
        setPlayerRole(0);
      } else if (data.player2Id === guestId) {
        setPlayerRole(1);
      } else {
        alert('Game is full!');
        return;
      }
      setGameId(docRef.id);
      setBoard({
        ...data,
        status: 'idle',
        isVsMachine: false,
        isOnline: true,
      } as any);
    } else {
      alert('Game not found!');
    }
  };

  const syncBoardToFirebase = async (newBoard: BoardState) => {
    if (!gameId || !board.isOnline) return;
    await updateDoc(doc(db, 'games', gameId), {
      stones: newBoard.stones,
      scores: newBoard.scores,
      currentPlayer: newBoard.currentPlayer,
      status: newBoard.status,
      message: newBoard.message,
      updatedAt: serverTimestamp(),
    });
  };

  const simulateMove = (stones: number[], startIndex: number, direction: 'cw' | 'ccw', player: number) => {
    let currentStones = [...stones];
    let score = 0;
    let hand = currentStones[startIndex];
    currentStones[startIndex] = 0;
    
    let currentIndex = startIndex;
    const step = direction === 'cw' ? 1 : -1;

    while (hand > 0) {
      currentIndex = (currentIndex + step + BOARD_SIZE) % BOARD_SIZE;
      currentStones[currentIndex]++;
      hand--;

      if (hand === 0) {
        const nextIndex = (currentIndex + step + BOARD_SIZE) % BOARD_SIZE;
        if (currentStones[nextIndex] > 0 && !QUAN_SQUARES.includes(nextIndex)) {
          hand = currentStones[nextIndex];
          currentStones[nextIndex] = 0;
          currentIndex = nextIndex;
        } else if (currentStones[nextIndex] === 0) {
          let captureIndex = (nextIndex + step + BOARD_SIZE) % BOARD_SIZE;
          let currentNextIndex = nextIndex;
          while (currentStones[currentNextIndex] === 0 && currentStones[captureIndex] > 0) {
            score += currentStones[captureIndex];
            currentStones[captureIndex] = 0;
            const emptyAfterCapture = (captureIndex + step + BOARD_SIZE) % BOARD_SIZE;
            if (currentStones[emptyAfterCapture] === 0) {
              const nextPotential = (emptyAfterCapture + step + BOARD_SIZE) % BOARD_SIZE;
              if (currentStones[nextPotential] > 0) {
                currentNextIndex = emptyAfterCapture;
                captureIndex = nextPotential;
                continue;
              }
            }
            break;
          }
          break;
        } else {
          break;
        }
      }
    }
    return score;
  };

  const makeAIMove = useCallback(async () => {
    if (board.status !== 'idle' || board.currentPlayer !== 1 || !board.isVsMachine) return;

    await new Promise(resolve => setTimeout(resolve, 1000)); // AI thinking time

    let bestMove = { index: -1, direction: 'cw' as 'cw' | 'ccw', score: -1 };
    
    // Evaluate all possible moves
    for (const index of PLAYER_2_SQUARES) {
      if (board.stones[index] > 0) {
        for (const dir of ['cw', 'ccw'] as const) {
          const score = simulateMove(board.stones, index, dir, 1);
          if (score > bestMove.score) {
            bestMove = { index, direction: dir, score };
          }
        }
      }
    }

    // If no stones, the handleMove logic will handle refill
    if (bestMove.index !== -1) {
      handleMove(bestMove.index, bestMove.direction);
    }
  }, [board]);

  useEffect(() => {
    if (board.currentPlayer === 1 && board.isVsMachine && board.status === 'idle') {
      makeAIMove();
    }
  }, [board.currentPlayer, board.status, board.isVsMachine, makeAIMove]);

  // --- Game Logic ---

  const startGame = (vsMachine: boolean) => {
    setBoard({
      stones: [5, 5, 5, 5, 5, 10, 5, 5, 5, 5, 5, 10],
      scores: [0, 0],
      currentPlayer: 0,
      status: 'idle',
      message: 'Your turn! Pick a candy bowl.',
      isVsMachine: vsMachine,
    });
  };

  const resetToMenu = () => {
    setBoard(prev => ({ ...prev, status: 'menu' }));
  };

  const handleMove = async (startIndex: number, direction: 'cw' | 'ccw', isRemote = false) => {
    if (board.status !== 'idle' && !isRemote) return;
    if (isMovingRef.current) return;
    if (board.stones[startIndex] === 0) return;
    
    // Online check: only move if it's your turn (unless it's a remote update)
    if (board.isOnline && board.currentPlayer !== playerRole && !isRemote) return;

    isMovingRef.current = true;
    setSelectedSquare(null);

    // Sync move start to Firebase if we are the initiator
    if (board.isOnline && !isRemote) {
      await updateDoc(doc(db, 'games', gameId!), {
        status: 'moving',
        lastMove: {
          startIndex,
          direction,
          playerId: guestId
        },
        updatedAt: serverTimestamp()
      });
    }

    let currentStones = [...board.stones];
    let currentScores = [...board.scores] as [number, number];
    let hand = currentStones[startIndex];
    currentStones[startIndex] = 0;
    
    setBoard(prev => ({ ...prev, status: 'moving', stones: currentStones, message: 'Spreading the candies! 🍬' }));

    let currentIndex = startIndex;
    const step = direction === 'cw' ? 1 : -1;
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    while (hand > 0) {
      currentIndex = (currentIndex + step + BOARD_SIZE) % BOARD_SIZE;
      currentStones[currentIndex]++;
      hand--;
      setBoard(prev => ({ ...prev, stones: [...currentStones] }));
      setAnimatingIndex(currentIndex);
      await sleep(250); // Slower speed for better tracking

      if (hand === 0) {
        const nextIndex = (currentIndex + step + BOARD_SIZE) % BOARD_SIZE;
        if (currentStones[nextIndex] > 0 && !QUAN_SQUARES.includes(nextIndex)) {
          await sleep(400);
          hand = currentStones[nextIndex];
          currentStones[nextIndex] = 0;
          setBoard(prev => ({ ...prev, stones: [...currentStones], message: 'Keep going! 🍭' }));
        } else if (currentStones[nextIndex] === 0) {
          let captureIndex = (nextIndex + step + BOARD_SIZE) % BOARD_SIZE;
          let currentNextIndex = nextIndex;
          while (currentStones[currentNextIndex] === 0 && currentStones[captureIndex] > 0) {
            await sleep(500);
            const captured = currentStones[captureIndex];
            currentScores[board.currentPlayer] += captured;
            currentStones[captureIndex] = 0;
            setBoard(prev => ({ 
              ...prev, 
              stones: [...currentStones], 
              scores: currentScores,
              message: `Yum! Captured ${captured} candies! 😋`
            }));
            const emptyAfterCapture = (captureIndex + step + BOARD_SIZE) % BOARD_SIZE;
            if (currentStones[emptyAfterCapture] === 0) {
              const nextPotential = (emptyAfterCapture + step + BOARD_SIZE) % BOARD_SIZE;
              if (currentStones[nextPotential] > 0) {
                currentNextIndex = emptyAfterCapture;
                captureIndex = nextPotential;
                continue;
              }
            }
            break;
          }
          break;
        } else {
          break;
        }
      }
    }

    setAnimatingIndex(null);
    await sleep(500);

    // Check game over
    let finalBoard = { ...board, stones: currentStones, scores: currentScores };
    if (currentStones[5] === 0 && currentStones[11] === 0) {
      const p1Remaining = PLAYER_1_SQUARES.reduce((acc, idx) => acc + currentStones[idx], 0);
      const p2Remaining = PLAYER_2_SQUARES.reduce((acc, idx) => acc + currentStones[idx], 0);
      currentScores[0] += p1Remaining;
      currentScores[1] += p2Remaining;
      PLAYER_1_SQUARES.forEach(idx => currentStones[idx] = 0);
      PLAYER_2_SQUARES.forEach(idx => currentStones[idx] = 0);
      const winner = currentScores[0] > currentScores[1] ? 'Player 1 Wins! 🏆' : 
                     currentScores[1] > currentScores[0] ? (board.isVsMachine ? 'Machine Wins! 🤖' : 'Player 2 Wins! 🏆') : 'It\'s a Tie! 🤝';
      finalBoard = { ...finalBoard, stones: currentStones, scores: currentScores, status: 'gameOver', message: winner };
      setBoard(finalBoard);
      if (board.isOnline && !isRemote) syncBoardToFirebase(finalBoard);
      isMovingRef.current = false;
      return;
    }

    // Switch player
    const nextPlayer = board.currentPlayer === 0 ? 1 : 0;
    const nextPlayerSquares = nextPlayer === 0 ? PLAYER_1_SQUARES : PLAYER_2_SQUARES;
    const hasStones = nextPlayerSquares.some(idx => currentStones[idx] > 0);

    if (!hasStones) {
      if (currentScores[nextPlayer] >= 5) {
        currentScores[nextPlayer] -= 5;
        nextPlayerSquares.forEach(idx => currentStones[idx] = 1);
      } else {
        finalBoard = { ...finalBoard, stones: currentStones, scores: currentScores, status: 'gameOver', message: 'No more candies to refill!' };
        setBoard(finalBoard);
        if (board.isOnline && !isRemote) syncBoardToFirebase(finalBoard);
        isMovingRef.current = false;
        return;
      }
    }

    finalBoard = {
      ...finalBoard,
      stones: currentStones,
      scores: currentScores,
      currentPlayer: nextPlayer as 0 | 1,
      status: 'idle',
      message: nextPlayer === 0 ? 'Your turn! ✨' : (board.isVsMachine ? 'Machine is thinking... 🤔' : 'Player 2\'s turn! 🌈'),
    };
    setBoard(finalBoard);
    if (board.isOnline && !isRemote) syncBoardToFirebase(finalBoard);
    isMovingRef.current = false;
  };

  return (
    <div className="h-screen max-h-screen bg-sky-50 text-sky-900 font-sans p-2 flex flex-col items-center justify-center overflow-hidden relative">
      {/* Decorative Elements */}
      <div className="absolute top-4 left-4 text-pink-300 animate-bounce opacity-50"><Star size={30} fill="currentColor" /></div>
      <div className="absolute bottom-4 right-4 text-yellow-300 animate-pulse opacity-50"><Star size={20} fill="currentColor" /></div>
      <div className="absolute top-10 right-10 text-purple-300 animate-spin-slow opacity-50"><Sparkles size={25} /></div>

      {/* Header */}
      <div className="w-full max-w-4xl flex justify-between items-center mb-4 z-10 px-2">
        <div className="flex items-center gap-2">
          <motion.div 
            whileHover={{ scale: 1.1, rotate: 10 }}
            className="w-10 h-10 bg-gradient-to-br from-pink-400 to-rose-500 rounded-xl flex items-center justify-center text-white shadow-lg border-2 border-white"
          >
            <Candy size={20} />
          </motion.div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-purple-600">Candy Quan</h1>
          </div>
        </div>
        
        <div className="flex gap-2">
          <button onClick={() => setShowRules(true)} className="p-2 bg-white rounded-xl text-sky-400 shadow-md hover:bg-sky-100 transition-all"><Info size={18} /></button>
          <button onClick={resetToMenu} className="p-2 bg-white rounded-xl text-pink-400 shadow-md hover:bg-pink-50 transition-all"><RotateCcw size={18} /></button>
        </div>
      </div>

      {/* Main Content Area */}
      <AnimatePresence mode="wait">
        {board.status === 'setup' ? (
          <motion.div 
            key="setup"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="bg-white p-8 rounded-[40px] shadow-2xl border-8 border-sky-100 text-center max-w-2xl w-full z-10 flex flex-col md:flex-row gap-8"
          >
            <div className="flex-1 space-y-6">
              <h2 className="text-3xl font-black text-sky-600">Online Setup</h2>
              <div className="text-left">
                <label className="block text-xs font-black text-sky-400 uppercase tracking-widest mb-2 ml-2">Your Name</label>
                <input 
                  type="text" 
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="Enter your name" 
                  className="w-full px-6 py-4 rounded-2xl border-4 border-sky-50 focus:border-sky-400 outline-none text-lg font-bold transition-all"
                />
              </div>
              
              <button 
                onClick={createOnlineGame}
                className="w-full flex items-center justify-center gap-4 py-5 bg-gradient-to-r from-emerald-400 to-teal-500 text-white rounded-3xl font-black text-lg shadow-lg hover:scale-105 transition-all"
              >
                <Globe size={24} />
                <span>CREATE NEW GAME</span>
              </button>

              <div className="relative flex items-center py-2">
                <div className="flex-grow border-t border-sky-100"></div>
                <span className="flex-shrink mx-4 text-sky-300 text-xs font-black uppercase">OR JOIN BY ID</span>
                <div className="flex-grow border-t border-sky-100"></div>
              </div>

              <div className="flex gap-2">
                <input 
                  type="text" 
                  placeholder="Enter Game ID" 
                  className="flex-1 px-4 py-4 rounded-2xl border-4 border-sky-50 focus:border-sky-400 outline-none text-sm font-bold"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') joinOnlineGame((e.target as HTMLInputElement).value);
                  }}
                />
                <button 
                  onClick={() => {
                    const input = document.querySelector('input[placeholder="Enter Game ID"]') as HTMLInputElement;
                    if (input) joinOnlineGame(input.value);
                  }}
                  className="p-4 bg-sky-500 text-white rounded-2xl hover:bg-sky-600 transition-all"
                >
                  <ArrowRight size={24} />
                </button>
              </div>
              <button onClick={resetToMenu} className="block w-full text-pink-400 font-bold hover:underline">Back to Menu</button>
            </div>

            <div className="flex-1 bg-sky-50 rounded-[32px] p-6 flex flex-col">
              <h3 className="text-sm font-black text-sky-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Users size={16} /> Active Lobbies
              </h3>
              <div className="flex-1 overflow-y-auto space-y-3 max-h-[300px] pr-2 custom-scrollbar">
                {publicGames.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-sky-300 gap-2 opacity-60">
                    <Candy size={32} className="animate-bounce" />
                    <p className="text-xs font-bold">No active games yet...</p>
                  </div>
                ) : (
                  publicGames.map((game) => (
                    <motion.div 
                      key={game.id}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="bg-white p-4 rounded-2xl shadow-sm border-2 border-white hover:border-emerald-300 transition-all cursor-pointer flex items-center justify-between group"
                      onClick={() => joinOnlineGame(game.shortId || game.id)}
                    >
                      <div className="text-left">
                        <p className="text-[10px] font-black text-sky-300 uppercase leading-none mb-1">Host</p>
                        <p className="text-sm font-black text-sky-700">{game.player1Name}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-black text-emerald-400 uppercase leading-none mb-1">ID</p>
                        <p className="text-sm font-mono font-black text-emerald-600 group-hover:scale-110 transition-transform">{game.shortId || game.id.substring(0,6)}</p>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </div>
          </motion.div>
        ) : board.status === 'lobby' ? (
          <motion.div 
            key="lobby"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="bg-white p-10 rounded-[40px] shadow-2xl border-8 border-emerald-100 text-center max-w-md w-full z-10"
          >
            <h2 className="text-3xl font-black mb-4 text-emerald-600">Game Created!</h2>
            <p className="text-sky-600 font-bold mb-6">Share this ID with your friend:</p>
            <div className="bg-sky-50 p-4 rounded-2xl flex items-center justify-between gap-2 border-2 border-sky-100 mb-8">
              <code className="text-2xl font-black text-sky-800 tracking-widest">{shortId || '...'}</code>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(shortId || '');
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="p-2 hover:bg-sky-200 rounded-lg transition-colors"
              >
                {copied ? <Check className="text-emerald-500" /> : <Copy className="text-sky-500" />}
              </button>
            </div>
            <div className="flex items-center justify-center gap-3 text-sky-400 animate-pulse">
              <div className="w-2 h-2 bg-emerald-400 rounded-full" />
              <span className="font-bold text-sm">Waiting for Player 2 to join...</span>
            </div>
            <button onClick={resetToMenu} className="mt-8 text-pink-400 font-bold hover:underline">Cancel</button>
          </motion.div>
        ) : board.status === 'menu' ? (
          <motion.div 
            key="menu"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="bg-white p-10 rounded-[40px] shadow-2xl border-8 border-pink-100 text-center max-w-md w-full z-10"
          >
            <h2 className="text-4xl font-black mb-8 text-sky-600">Pick a Mode!</h2>
            <div className="space-y-4">
              <button 
                onClick={() => startGame(true)}
                className="w-full group relative flex items-center justify-center gap-4 py-6 bg-gradient-to-r from-sky-400 to-blue-500 text-white rounded-3xl font-black text-xl shadow-lg hover:scale-105 transition-all"
              >
                <Cpu size={32} />
                <span>VS MACHINE</span>
                <div className="absolute -top-2 -right-2 bg-yellow-400 text-white text-[10px] px-2 py-1 rounded-full animate-pulse">EASY</div>
              </button>
              <button 
                onClick={() => startGame(false)}
                className="w-full flex items-center justify-center gap-4 py-6 bg-gradient-to-r from-purple-400 to-pink-500 text-white rounded-3xl font-black text-xl shadow-lg hover:scale-105 transition-all"
              >
                <Users size={32} />
                <span>VS FRIEND (LOCAL)</span>
              </button>
              <button 
                onClick={() => setBoard(prev => ({ ...prev, status: 'setup' }))}
                className="w-full flex items-center justify-center gap-4 py-6 bg-gradient-to-r from-emerald-400 to-teal-500 text-white rounded-3xl font-black text-xl shadow-lg hover:scale-105 transition-all"
              >
                <Globe size={32} />
                <span>ONLINE MULTIPLAYER</span>
              </button>
            </div>
            <p className="mt-8 text-sky-300 text-sm font-medium">Traditional Vietnamese game with a sweet twist!</p>
          </motion.div>
        ) : (
          <motion.div 
            key="game"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center z-10 w-full"
          >
            {/* Game Board */}
            <div className="relative bg-white/80 backdrop-blur-md p-4 sm:p-8 rounded-[40px] sm:rounded-[60px] shadow-2xl border-4 sm:border-8 border-sky-200 mb-4 scale-[0.85] sm:scale-100 origin-center">
              <div className="flex items-center gap-0">
                <div className="mr-[-2px] sm:mr-[-4px]"><Square index={11} isQuan stones={board.stones[11]} currentPlayer={board.currentPlayer} status={board.status} animatingIndex={animatingIndex} onMove={handleMove} selectedSquare={selectedSquare} setSelectedSquare={setSelectedSquare} playerRole={playerRole} /></div>
                <div className="flex flex-col gap-0">
                  <div className="flex flex-row-reverse">
                    {PLAYER_2_SQUARES.map(idx => (
                      <Square key={idx} index={idx} stones={board.stones[idx]} currentPlayer={board.currentPlayer} status={board.status} animatingIndex={animatingIndex} onMove={handleMove} selectedSquare={selectedSquare} setSelectedSquare={setSelectedSquare} playerRole={playerRole} />
                    ))}
                  </div>
                  <div className="flex">
                    {PLAYER_1_SQUARES.map(idx => (
                      <Square key={idx} index={idx} stones={board.stones[idx]} currentPlayer={board.currentPlayer} status={board.status} animatingIndex={animatingIndex} onMove={handleMove} selectedSquare={selectedSquare} setSelectedSquare={setSelectedSquare} playerRole={playerRole} />
                    ))}
                  </div>
                </div>
                <div className="ml-[-2px] sm:ml-[-4px]"><Square index={5} isQuan stones={board.stones[5]} currentPlayer={board.currentPlayer} status={board.status} animatingIndex={animatingIndex} onMove={handleMove} selectedSquare={selectedSquare} setSelectedSquare={setSelectedSquare} playerRole={playerRole} /></div>
              </div>

              {/* Player Badges */}
              <div className={`absolute -top-8 left-1/2 -translate-x-1/2 px-6 py-2 rounded-full text-sm font-black transition-all shadow-lg flex items-center gap-2 ${
                board.currentPlayer === 1 ? 'bg-purple-500 text-white scale-110' : 'bg-white text-purple-300'
              }`}>
                {board.isVsMachine ? <Cpu size={16} /> : <User size={16} />}
                {board.isVsMachine ? 'MACHINE' : (board.player2Name || 'PLAYER 2')}
              </div>
              <div className={`absolute -bottom-8 left-1/2 -translate-x-1/2 px-6 py-2 rounded-full text-sm font-black transition-all shadow-lg flex items-center gap-2 ${
                board.currentPlayer === 0 ? 'bg-pink-500 text-white scale-110' : 'bg-white text-pink-300'
              }`}>
                <User size={16} />
                {board.player1Name || 'PLAYER 1'}
              </div>
            </div>

            {/* Scores */}
            <div className="w-full max-w-md grid grid-cols-2 gap-4 mb-4">
              <div className={`p-4 rounded-[24px] border-4 transition-all ${
                board.currentPlayer === 0 ? 'bg-white border-pink-400 shadow-xl scale-105' : 'bg-white/50 border-transparent opacity-70'
              }`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-black text-pink-400 uppercase">{board.player1Name || 'P1'} Score</span>
                  <Candy size={14} className="text-pink-300" />
                </div>
                <div className="text-2xl font-black text-sky-900">{board.scores[0]}</div>
              </div>
              <div className={`p-4 rounded-[24px] border-4 transition-all ${
                board.currentPlayer === 1 ? 'bg-white border-purple-400 shadow-xl scale-105' : 'bg-white/50 border-transparent opacity-70'
              }`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-black text-purple-400 uppercase">{board.isVsMachine ? 'AI' : (board.player2Name || 'P2')} Score</span>
                  <Candy size={14} className="text-purple-300" />
                </div>
                <div className="text-2xl font-black text-sky-900">{board.scores[1]}</div>
              </div>
            </div>

            {/* Message */}
            <div className="text-center h-12">
              <AnimatePresence mode="wait">
                <motion.p
                  key={board.message}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.1 }}
                  className="text-lg font-black text-sky-600 drop-shadow-sm"
                >
                  {board.message}
                </motion.p>
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals */}
      <AnimatePresence>
        {showRules && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-sky-900/40 backdrop-blur-md z-50 flex items-center justify-center p-4" onClick={() => setShowRules(false)}>
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }} className="bg-white rounded-[40px] p-10 max-w-lg w-full shadow-2xl overflow-y-auto max-h-[80vh] border-8 border-sky-100" onClick={e => e.stopPropagation()}>
              <h2 className="text-3xl font-black mb-6 text-sky-600 flex items-center gap-3"><Info /> How to Play</h2>
              <div className="space-y-4 text-sky-700 text-sm font-medium leading-relaxed">
                <p>Welcome to <strong>Candy Quan</strong>! The goal is to collect as many candies as you can.</p>
                <ul className="space-y-3">
                  <li className="flex gap-3"><div className="w-6 h-6 bg-pink-100 rounded-full flex-shrink-0 flex items-center justify-center text-pink-500 font-bold">1</div> Pick a bowl from your side and spread the candies one by one.</li>
                  <li className="flex gap-3"><div className="w-6 h-6 bg-pink-100 rounded-full flex-shrink-0 flex items-center justify-center text-pink-500 font-bold">2</div> If you land next to a bowl with candies, pick them up and keep going!</li>
                  <li className="flex gap-3"><div className="w-6 h-6 bg-pink-100 rounded-full flex-shrink-0 flex items-center justify-center text-pink-500 font-bold">3</div> If you land next to an <strong>empty</strong> bowl, you capture all candies in the bowl after that! 😋</li>
                  <li className="flex gap-3"><div className="w-6 h-6 bg-pink-100 rounded-full flex-shrink-0 flex items-center justify-center text-pink-500 font-bold">4</div> The game ends when the big "Quan" bowls are empty. Most candies win!</li>
                </ul>
              </div>
              <button onClick={() => setShowRules(false)} className="w-full mt-10 py-4 bg-sky-500 text-white rounded-2xl font-black text-lg hover:bg-sky-600 transition-all shadow-lg">SWEET!</button>
            </motion.div>
          </motion.div>
        )}

        {board.status === 'gameOver' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 bg-gradient-to-br from-pink-500/90 to-purple-600/90 backdrop-blur-xl z-50 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.5, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} className="text-center text-white">
              <Trophy size={100} className="mx-auto mb-8 text-yellow-300 drop-shadow-lg" />
              <h2 className="text-6xl font-black mb-4 drop-shadow-md">{board.message}</h2>
              <div className="flex justify-center gap-12 my-10">
                <div className="bg-white/20 p-6 rounded-3xl backdrop-blur-md">
                  <p className="text-pink-200 text-xs font-black uppercase tracking-widest mb-2">{board.player1Name || 'Player 1'}</p>
                  <p className="text-5xl font-black">{board.scores[0]}</p>
                </div>
                <div className="bg-white/20 p-6 rounded-3xl backdrop-blur-md">
                  <p className="text-purple-200 text-xs font-black uppercase tracking-widest mb-2">{board.isVsMachine ? 'Machine' : (board.player2Name || 'Player 2')}</p>
                  <p className="text-5xl font-black">{board.scores[1]}</p>
                </div>
              </div>
              <button onClick={resetToMenu} className="px-12 py-5 bg-white text-pink-600 rounded-3xl font-black text-2xl shadow-2xl hover:scale-110 transition-all">PLAY AGAIN! 🍭</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Sub-components ---

const Stone = ({ count, isQuan }: { count: number; isQuan?: boolean }) => {
  if (count === 0) return null;
  const displayCount = Math.min(count, isQuan ? 12 : 8);
  const colors = [
    'from-pink-400 to-pink-600', 
    'from-purple-400 to-purple-600', 
    'from-yellow-300 to-yellow-500', 
    'from-sky-400 to-sky-600', 
    'from-orange-400 to-orange-600', 
    'from-emerald-400 to-emerald-600'
  ];
  
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <div className="grid grid-cols-3 gap-1 p-1">
        {Array.from({ length: displayCount }).map((_, i) => (
          <motion.div
            key={i}
            initial={{ scale: 0, y: -10 }}
            animate={{ scale: 1, y: 0 }}
            className={`rounded-full shadow-[inset_-2px_-2px_4px_rgba(0,0,0,0.3),2px_2px_4px_rgba(0,0,0,0.2)] border border-white/40 bg-gradient-to-br ${
              isQuan ? 'w-4 h-4' : 'w-3 h-3'
            } ${colors[i % colors.length]}`}
            style={{ 
              transform: `translate(${Math.sin(i * 1.5) * 4}px, ${Math.cos(i * 1.5) * 4}px)`,
              position: 'relative'
            }}
          >
            {/* Highlight for 3D effect */}
            <div className="absolute top-0.5 left-0.5 w-1 h-1 bg-white/60 rounded-full blur-[0.5px]" />
          </motion.div>
        ))}
      </div>
      <div className="absolute -bottom-1 -right-1 bg-white/95 text-sky-600 text-[10px] font-black w-5 h-5 flex items-center justify-center rounded-full shadow-md border border-sky-100 z-10">
        {count}
      </div>
    </div>
  );
};

interface SquareProps {
  index: number;
  isQuan?: boolean;
  stones: number;
  currentPlayer: number;
  status: string;
  animatingIndex: number | null;
  onMove: (index: number, direction: 'cw' | 'ccw') => void;
  selectedSquare: number | null;
  setSelectedSquare: (index: number | null) => void;
  playerRole: 0 | 1 | null;
  key?: React.Key;
}

const Square = ({ index, isQuan, stones, currentPlayer, status, animatingIndex, onMove, selectedSquare, setSelectedSquare, playerRole }: SquareProps) => {
  const PLAYER_1_SQUARES = [0, 1, 2, 3, 4];
  const PLAYER_2_SQUARES = [6, 7, 8, 9, 10];
  const isCurrentPlayerSquare = (currentPlayer === 0 && PLAYER_1_SQUARES.includes(index)) ||
                                (currentPlayer === 1 && PLAYER_2_SQUARES.includes(index));
  
  // In online mode, only allow interaction if it's the player's role
  const isMyTurn = playerRole === null || currentPlayer === playerRole;
  const canInteract = status === 'idle' && isCurrentPlayerSquare && stones > 0 && isMyTurn;
  const isAnimating = animatingIndex === index;
  const isSelected = selectedSquare === index;

  return (
    <div 
      className={`relative flex items-center justify-center border-2 sm:border-4 border-sky-100 transition-all duration-300 ${
        isQuan ? 'w-16 h-32 sm:w-28 sm:h-56 rounded-t-full bg-gradient-to-b from-sky-100/50 to-white' : 'w-14 h-14 sm:w-24 sm:h-24 bg-white/60'
      } ${isAnimating ? 'bg-yellow-100 ring-2 sm:ring-4 ring-yellow-400 scale-105 z-20' : ''} ${
        canInteract ? 'cursor-pointer hover:bg-pink-50 z-10' : ''
      } ${isSelected ? 'bg-pink-100 ring-2 sm:ring-4 ring-pink-400 z-20' : ''}`}
      style={isQuan && index === 11 ? { transform: 'rotate(-90deg)' } : isQuan && index === 5 ? { transform: 'rotate(90deg)' } : {}}
      onClick={() => {
        if (canInteract) {
          setSelectedSquare(isSelected ? null : index);
        }
      }}
    >
      <Stone count={stones} isQuan={isQuan} />
      
      <AnimatePresence>
        {isSelected && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none"
          >
            <div className="flex gap-1 sm:gap-3 pointer-events-auto">
              <button 
                onClick={(e) => { e.stopPropagation(); onMove(index, 'ccw'); }} 
                className="p-1.5 sm:p-2 bg-white text-pink-500 rounded-full shadow-xl border-2 border-pink-200 hover:bg-pink-500 hover:text-white transition-all transform hover:scale-110"
              >
                <ChevronLeft size={16} className="sm:w-5 sm:h-5" />
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); onMove(index, 'cw'); }} 
                className="p-1.5 sm:p-2 bg-white text-pink-500 rounded-full shadow-xl border-2 border-pink-200 hover:bg-pink-500 hover:text-white transition-all transform hover:scale-110"
              >
                <ChevronRight size={16} className="sm:w-5 sm:h-5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
