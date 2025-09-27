// =================================================
// PASO MÁS IMPORTANTE: REEMPLAZA ESTA URL
// =================================================
const SERVER_URL = 'https://snake-game-backend-btux.onrender.com'; // <-- ¡Pega tu URL de Render aquí!

// --- Elementos del DOM ---
const mainMenu = document.getElementById('main-menu');
const lobby = document.getElementById('lobby');
const gameContainer = document.getElementById('game-container');
const nameInput = document.getElementById('nameInput');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const startBtn = document.getElementById('start-btn');
const roomInput = document.getElementById('roomInput');
const roomCodeDisplay = document.getElementById('room-code');
const playerList = document.getElementById('player-list');
const scoreList = document.getElementById('scoreList');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- Configuración del Juego ---
const gridSize = 20;
canvas.width = 600;
canvas.height = 600;

// --- Estado del Cliente ---
let state = {};
let currentRoomId = null;

console.log('Cliente de Snake inicializado. Conectando al servidor...');
const socket = io(SERVER_URL);

// --- Eventos de Conexión ---
socket.on('connect', () => {
    console.log('¡Conectado al servidor! ID de socket:', socket.id);
});

socket.on('disconnect', () => {
    console.warn('Desconectado del servidor.');
    alert('Se ha perdido la conexión con el servidor.');
});

socket.on('error', (message) => {
    console.error('Error del servidor:', message);
    alert(`Error: ${message}`);
});

// --- Lógica de Menús y Lobby ---
createBtn.addEventListener('click', () => {
    const playerName = nameInput.value.trim();
    if (playerName === "") {
        alert("Por favor, escribe un nombre.");
        return;
    }
    console.log('Enviando evento "createRoom" con nombre:', playerName);
    socket.emit('createRoom', { playerName: playerName });
});

joinBtn.addEventListener('click', () => {
    const roomId = roomInput.value.trim().toUpperCase();
    const playerName = nameInput.value.trim();
    if (playerName === "") {
        alert("Por favor, escribe un nombre.");
        return;
    }
    if (roomId) {
        console.log(`Enviando evento "joinRoom" a sala ${roomId} con nombre:`, playerName);
        socket.emit('joinRoom', { roomId: roomId, playerName: playerName });
    } else {
        alert("Por favor, introduce un código de sala.");
    }
});

startBtn.addEventListener('click', () => {
    console.log(`Enviando evento "startGame" para la sala ${currentRoomId}`);
    socket.emit('startGame', currentRoomId);
});

// --- Actualizaciones de Estado desde el Servidor ---
socket.on('roomCreated', (data) => {
    console.log('Evento "roomCreated" recibido:', data);
    currentRoomId = data.roomId;
    state = { players: data.players };
    showLobby(data.roomId, data.hostId);
});

socket.on('updatePlayers', (data) => {
    console.log('Evento "updatePlayers" recibido:', data);
    if (!currentRoomId) currentRoomId = roomInput.value.trim().toUpperCase();
    state.players = data.players;
    showLobby(currentRoomId, data.hostId);
});

socket.on('gameStarted', (roomState) => {
    console.log('Evento "gameStarted" recibido. ¡La partida comienza!', roomState);
    state = roomState;
    lobby.classList.add('hidden');
    gameContainer.classList.remove('hidden');
    draw();
});

socket.on('gameStateUpdate', (gameState) => {
    // console.log('Evento "gameStateUpdate" recibido:', gameState); // Descomentar para depuración intensa
    state = gameState;
    draw();
});

socket.on('playerEliminated', ({ playerId, remainingPlayers }) => {
    console.log(`Jugador ${playerId} eliminado. Quedan ${Object.keys(remainingPlayers).length} jugadores.`);
    state.players = remainingPlayers;
});


// --- Funciones de UI y Dibujo ---
function showLobby(roomId, hostId) {
    mainMenu.classList.add('hidden');
    lobby.classList.remove('hidden');
    roomCodeDisplay.innerText = roomId;
    startBtn.classList.toggle('hidden', socket.id !== hostId);
    playerList.innerHTML = '';
    for (const id in state.players) {
        const player = state.players[id];
        const li = document.createElement('li');
        li.style.color = player.color;
        li.textContent = `${player.name} ${id === hostId ? '👑' : ''}`;
        playerList.appendChild(li);
    }
}

function updateScoreboard() {
    if (!state.players) return;
    scoreList.innerHTML = '';
    const sortedPlayers = Object.values(state.players).sort((a, b) => b.score - a.score);
    sortedPlayers.forEach(player => {
        const li = document.createElement('li');
        li.textContent = `${player.name}: ${player.score}`;
        li.style.color = player.color;
        scoreList.appendChild(li);
    });
}

function draw() {
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!state.players || !state.apple) return;
    for (const id in state.players) {
        const player = state.players[id];
        ctx.fillStyle = player.color;
        player.body.forEach(segment => {
            ctx.fillRect(segment.x, segment.y, gridSize, gridSize);
        });
    }
    ctx.fillStyle = 'red';
    ctx.font = `${gridSize * 1.5}px Arial`;
    ctx.fillText('🍎', state.apple.x, state.apple.y + gridSize * 0.8);
    updateScoreboard();
}

// --- Controles ---
window.addEventListener('keydown', e => {
    let direction;
    switch (e.key) {
        case 'ArrowUp': case 'w': direction = 'up'; break;
        case 'ArrowDown': case 's': direction = 'down'; break;
        case 'ArrowLeft': case 'a': direction = 'left'; break;
        case 'ArrowRight': case 'd': direction = 'right'; break;
        default: return;
    }
    e.preventDefault();
    socket.emit('directionChange', { roomId: currentRoomId, direction });
});