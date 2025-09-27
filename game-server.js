// ARCHIVO: game-server.js
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ port: 8080 });

const rooms = {};
const TICK_RATE = 1000 / 30; // 30 actualizaciones por segundo

// Aquí va toda la lógica del juego que antes estaba en el cliente.
// Esta función es muy larga, pero es la misma que ya teníamos.
function updateGameState(room) {
    // ... (TODA la lógica de movimiento, colisiones, orbes y temporizador va aquí) ...
    // Este código es idéntico al que estaba en la función "update()" del Host.
    // Por brevedad, no se vuelve a pegar, pero funcionalmente es el mismo.
}

// El corazón del servidor: el bucle de juego
setInterval(() => {
    for (const roomCode in rooms) {
        const room = rooms[roomCode];
        if (room.gameState.inProgress) {
            // updateGameState(room); // Aquí se actualizaría la lógica
            // Y luego se enviaría el estado a todos los jugadores
            const message = JSON.stringify({ type: 'state', state: room.gameState });
            room.clients.forEach(client => client.ws.send(message));
        }
    }
}, TICK_RATE);


wss.on('connection', ws => {
    console.log('Cliente conectado.');
    // La lógica para manejar mensajes (crear sala, unirse, recibir inputs) iría aquí.
});

console.log('Servidor de Asteroids escuchando en el puerto 8080.');