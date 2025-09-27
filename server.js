const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { nanoid } = require('nanoid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Idealmente, la URL de tu Netlify
    methods: ["GET", "POST"]
  }
});

const rooms = {};
const gridSize = 20;

io.on('connection', (socket) => {
  // El host crea una sala y envía su nombre
  socket.on('createRoom', ({ playerName }) => {
    const roomId = nanoid(5); 
    rooms[roomId] = {
      players: {},
      apple: generateApple(),
      gameState: 'waiting',
      host: socket.id
    };
    socket.join(roomId);
    rooms[roomId].players[socket.id] = createPlayer(socket.id, playerName);
    socket.emit('roomCreated', { roomId, players: rooms[roomId].players, hostId: rooms[roomId].host });
  });

  // Un jugador se une con su nombre
  socket.on('joinRoom', ({ roomId, playerName }) => {
    if (rooms[roomId]) {
      if (rooms[roomId].gameState === 'playing') {
        socket.emit('error', 'La partida ya ha comenzado.');
        return;
      }
      socket.join(roomId);
      rooms[roomId].players[socket.id] = createPlayer(socket.id, playerName);
      io.to(roomId).emit('updatePlayers', { players: rooms[roomId].players, hostId: rooms[roomId].host });
    } else {
      socket.emit('error', 'La sala no existe.');
    }
  });
  
  // El resto del código del servidor (startGame, directionChange, disconnect) no necesita cambios...
  socket.on('startGame', (roomId) => {
      if (rooms[roomId] && rooms[roomId].host === socket.id) {
          rooms[roomId].gameState = 'playing';
          io.to(roomId).emit('gameStarted', rooms[roomId]);
          startGameInterval(roomId);
      }
  });

  socket.on('directionChange', (data) => {
    const { roomId, direction } = data;
    if (rooms[roomId] && rooms[roomId].players[socket.id]) {
        const player = rooms[roomId].players[socket.id];
        const { dx, dy } = player;

        if (direction === 'up' && dy === 0) { player.dx = 0; player.dy = -gridSize; }
        if (direction === 'down' && dy === 0) { player.dx = 0; player.dy = gridSize; }
        if (direction === 'left' && dx === 0) { player.dx = -gridSize; player.dy = 0; }
        if (direction === 'right' && dx === 0) { player.dx = gridSize; player.dy = 0; }
    }
  });

  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      if (rooms[roomId].players[socket.id]) {
        delete rooms[roomId].players[socket.id];
        if (rooms[roomId].host === socket.id) {
            io.to(roomId).emit('error', 'El host se ha desconectado. Fin de la partida.');
            delete rooms[roomId];
        } else {
            io.to(roomId).emit('updatePlayers', { players: rooms[roomId].players, hostId: rooms[roomId].host });
        }
        break;
      }
    }
  });
});

// Función createPlayer ahora acepta un nombre
function createPlayer(id, name) {
    const safeName = (name || 'Anónimo').trim().slice(0, 12);
    return {
        id: id,
        name: safeName, // Se guarda el nombre
        body: [{ x: Math.floor(Math.random() * 30) * gridSize, y: Math.floor(Math.random() * 30) * gridSize }],
        dx: gridSize,
        dy: 0,
        score: 0,
        color: `hsl(${Math.random() * 360}, 90%, 70%)`
    };
}

// El resto de las funciones (generateApple, startGameInterval, etc.) se mantienen igual
function generateApple() {
    return {
        x: Math.floor(Math.random() * 30) * gridSize,
        y: Math.floor(Math.random() * 30) * gridSize,
    };
}

function startGameInterval(roomId) {
    const intervalId = setInterval(() => {
        const room = rooms[roomId];
        if (!room || Object.keys(room.players).length === 0) {
            clearInterval(intervalId);
            delete rooms[roomId];
            return;
        }
        updateGameState(roomId);
        io.to(roomId).emit('gameStateUpdate', { players: room.players, apple: room.apple });
    }, 120);
}

function updateGameState(roomId) {
    const room = rooms[roomId];
    if (!room) return;
    const playersToDelete = [];
    for (const id in room.players) {
        const player = room.players[id];
        const head = { x: player.body[0].x + player.dx, y: player.body[0].y + player.dy };
        player.body.unshift(head);
        const dist = Math.sqrt(Math.pow(head.x - room.apple.x, 2) + Math.pow(head.y - room.apple.y, 2));
        if (dist < gridSize) {
            player.score++;
            room.apple = generateApple();
        } else {
            player.body.pop();
        }
        if (checkCollision(head, id, room.players)) {
            playersToDelete.push(id);
        }
    }
    playersToDelete.forEach(id => {
        delete room.players[id];
        io.to(roomId).emit('playerEliminated', { playerId: id, remainingPlayers: room.players });
    });
}

function checkCollision(head, playerId, players) {
    if (head.x < 0 || head.x >= 600 || head.y < 0 || head.y >= 600) return true;
    for (const id in players) {
        for (let i = 0; i < players[id].body.length; i++) {
            if (id === playerId && i === 0) continue;
            if (head.x === players[id].body[i].x && head.y === players[id].body[i].y) return true;
        }
    }
    return false;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor escuchando en el puerto ${PORT}`));