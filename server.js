// ARCHIVO: server.js
const { WebSocketServer } = require('ws');

const wss = new WebSocketServer({ port: process.env.PORT || 8080 });

const rooms = {};
const TICK_RATE = 1000 / 30; // 30 actualizaciones por segundo
const SHIP_SIZE = 15, FRICTION = 0.99, ENEMY_SPEED = 1.5, POINTS_PER_ENEMY = 500;
const PLAYER_COLORS = ['#0f0', '#0af', '#f80', '#f0f'];

function createInitialGameState(mode) {
    const initialState = {
        players: {}, bullets: [], orbs: [], asteroids: [], enemies: [],
        gameMode: mode, inProgress: false, gameOver: false,
    };
    if (mode === 'pvp') {
        initialState.matchTime = 2.5 * 60 * 30; // en frames
        initialState.orbSpawnTimer = 150;
    } else { // coop
        initialState.score = 0;
        initialState.lives = 3;
    }
    return initialState;
}

function updateRoom(room) {
    const { gameState } = room;
    if (!gameState.inProgress || gameState.gameOver) return;

    // Lógica de movimiento de jugadores
    for (const id in gameState.players) {
        const p = gameState.players[id];
        if (p.invincible > 0) p.invincible--;
        if (p.powerUp.duration > 0) p.powerUp.duration--;
        if (p.keys.thrust) { p.vx += Math.cos(p.angle) * 0.15; p.vy += Math.sin(p.angle) * 0.15; }
        if (p.keys.reverse) { p.vx -= Math.cos(p.angle) * 0.08; p.vy -= Math.sin(p.angle) * 0.08; }

        const isBig = p.powerUp.type === 'green' && p.powerUp.duration > 0;
        p.size = isBig ? SHIP_SIZE * 1.5 : SHIP_SIZE;
        let bulletSize = isBig ? 8 : 4;
        if (p.keys.shoot && p.shootCooldown <= 0) {
            p.shootCooldown = 15;
            const fire = (angleOffset = 0) => gameState.bullets.push({ x: p.x + Math.cos(p.angle + angleOffset) * p.size, y: p.y + Math.sin(p.angle + angleOffset) * p.size, vx: p.vx + Math.cos(p.angle + angleOffset) * 8, vy: p.vy + Math.sin(p.angle + angleOffset) * 8, life: 60, owner: id, size: bulletSize});
            fire();
            if(p.powerUp.type === 'yellow' && p.powerUp.duration > 0) { fire(0.2); fire(-0.2); }
        }
        if (p.shootCooldown > 0) p.shootCooldown--;
        p.vx *= FRICTION; p.vy *= FRICTION;
        p.x = (p.x + p.vx < 0) ? p.x + p.vx + 1200 : (p.x + p.vx > 1200) ? p.x + p.vx - 1200 : p.x + p.vx;
        p.y = (p.y + p.vy < 0) ? p.y + p.vy + 800 : (p.y + p.vy > 800) ? p.y + p.vy - 800 : p.y + p.vy;
    }
    
    // Lógica específica de cada modo de juego
    if (gameState.gameMode === 'pvp') {
        gameState.matchTime--;
        gameState.orbSpawnTimer--;
        if (gameState.orbSpawnTimer <= 0) { spawnOrb(gameState); gameState.orbSpawnTimer = 240 + Math.random() * 120; }
        if (gameState.matchTime <= 0) gameState.gameOver = true;
        handlePvpCollisions(gameState);
    } else { // coop
        // Lógica de asteroides y enemigos (si se quisiera implementar)
    }

    gameState.bullets = gameState.bullets.filter(b => b.life-- > 0);
    const message = JSON.stringify({ type: 'state', payload: { state: gameState } });
    room.clients.forEach(c => c.ws.send(message));
}

function spawnOrb(gameState) {
    const ORB_TYPES = [
        { type: 'green', rarity: 0.1 }, { type: 'red', rarity: 0.2 }, { type: 'blue', rarity: 0.2 },
        { type: 'yellow', rarity: 0.2 }, { type: 'purple', rarity: 0.15 }, { type: 'orange', rarity: 0.2 },
        { type: 'rainbow', rarity: 0.05 },
    ];
    let rand = Math.random();
    const orbType = ORB_TYPES.find(o => (rand -= o.rarity) < 0) || ORB_TYPES[0];
    gameState.orbs.push({ x: Math.random()*(1200*.8)+(1200*.1), y: Math.random()*(800*.8)+(800*.1), r: 10, type: orbType.type, id: Date.now()+Math.random()});
}

function handlePvpCollisions(gameState) {
    // Orbes
    for (const id in gameState.players) {
        const p = gameState.players[id];
        for (let i = gameState.orbs.length - 1; i >= 0; i--) {
            const orb = gameState.orbs[i];
            if (Math.hypot(p.x - orb.x, p.y - orb.y) < p.size + orb.r) {
                let typeToApply = orb.type;
                if (typeToApply === 'rainbow') typeToApply = ORB_TYPES[Math.floor(Math.random() * (ORB_TYPES.length - 1))].type;
                const powerUpDurations = { green: 300, red: 420, blue: 300, yellow: 300, purple: 300, orange: 300};
                p.powerUp = { type: typeToApply, duration: powerUpDurations[typeToApply] };
                gameState.orbs.splice(i, 1);
                break;
            }
        }
    }
    // Balas vs Jugadores
    for (let i = gameState.bullets.length - 1; i >= 0; i--) {
        const b = gameState.bullets[i];
        let bulletRemoved = false;
        for (const id in gameState.players) {
            const p = gameState.players[id];
            if (b.owner === id || p.invincible > 0) continue;
            const isImmune = (p.powerUp.type === 'blue' || p.powerUp.type === 'purple') && p.powerUp.duration > 0;
            const hasFrontShield = p.powerUp.type === 'orange' && p.powerUp.duration > 0;
            let hit = false;
            if (Math.hypot(b.x - p.x, b.y - p.y) < p.size + b.size/2) {
                if (hasFrontShield) {
                    const angleToBullet = Math.atan2(b.y - p.y, b.x - p.x);
                    let angleDiff = Math.abs(p.angle - angleToBullet);
                    if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
                    if (angleDiff > Math.PI / 2.5) hit = !isImmune;
                } else hit = !isImmune;
            }
            if (hit) {
                gameState.bullets.splice(i, 1); bulletRemoved = true;
                p.x = Math.random() * 1200; p.y = Math.random() * 800; p.vx = 0; p.vy = 0; p.invincible = 180;
                if(gameState.players[b.owner]) gameState.players[b.owner].kills++;
                break;
            }
        }
        if(bulletRemoved) continue;
    }
    // Auras de Poder
    const players = Object.values(gameState.players);
    for(let i = 0; i < players.length; i++) {
        const p1 = players[i];
        const p1AuraType = p1.powerUp.duration > 0 ? p1.powerUp.type : null;
        if (p1AuraType !== 'red' && p1AuraType !== 'purple') continue;
        for(let j = 0; j < players.length; j++) {
            if(i === j) continue;
            const p2 = players[j];
            if (p2.invincible > 0 || ((p2.powerUp.type === 'blue' || p2.powerUp.type === 'purple') && p2.powerUp.duration > 0)) continue;
            const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
            const auraRadius = p1AuraType === 'red' ? 100 : p1.size + 10;
            if (dist < auraRadius + p2.size) {
                p2.x = Math.random() * 1200; p2.y = Math.random() * 800; p2.vx = 0; p2.vy = 0; p2.invincible = 180;
                p1.kills++;
            }
        }
    }
}


wss.on('connection', ws => {
    ws.id = Math.random().toString(36).substr(2, 9);

    ws.on('message', message => {
        const { type, payload } = JSON.parse(message);

        if (type === 'create') {
            let roomCode;
            do { roomCode = Math.random().toString(36).substring(2, 7).toUpperCase(); } while (rooms[roomCode]);
            const client = { ws, id: ws.id };
            rooms[roomCode] = { clients: [client], gameState: createInitialGameState(payload.gameMode), gameLoopInterval: null };
            ws.roomCode = roomCode;
            ws.send(JSON.stringify({ type: 'roomCreated', payload: { roomCode, playerId: ws.id } }));
        } 
        else if (type === 'join') {
            const { roomCode } = payload;
            const room = rooms[roomCode];
            const maxPlayers = room?.gameState.gameMode === 'pvp' ? 4 : 2;
            if (room && room.clients.length < maxPlayers) {
                const client = { ws, id: ws.id };
                room.clients.push(client);
                ws.roomCode = roomCode;
                ws.send(JSON.stringify({ type: 'joinedRoom', payload: { roomCode, playerId: ws.id } }));
                const currentPlayers = room.clients.map(c => ({id: c.id, isHost: c.id === room.clients[0].id }));
                const message = JSON.stringify({ type: 'updatePlayers', payload: { players: currentPlayers } });
                room.clients.forEach(c => c.ws.send(message));
            } else {
                ws.send(JSON.stringify({ type: 'error', payload: 'La sala no existe o está llena.' }));
            }
        }
        else if (type === 'start') {
            const room = rooms[ws.roomCode];
            if (room && room.clients[0].id === ws.id) {
                room.gameState.inProgress = true;
                const playerColors = ['#0f0', '#0af', '#f80', '#f0f'];
                room.clients.forEach((c, index) => {
                    room.gameState.players[c.id] = { id: c.id, x: Math.random()*1200, y: Math.random()*800, vx:0,vy:0, angle:0, keys: {}, shootCooldown:0, invincible:180, color: playerColors[index], kills: 0, powerUp: {}, size: SHIP_SIZE };
                });
                room.gameLoopInterval = setInterval(() => updateRoom(room), TICK_RATE);
                const message = JSON.stringify({ type: 'startGame', payload: { state: room.gameState } });
                room.clients.forEach(c => c.ws.send(message));
            }
        }
        else if (type === 'input') {
            const room = rooms[ws.roomCode];
            if(room && room.gameState.players[ws.id]) {
                room.gameState.players[ws.id].keys = payload.keys;
                room.gameState.players[ws.id].angle = payload.angle;
            }
        }
    });

    ws.on('close', () => {
        const room = rooms[ws.roomCode];
        if (room) {
            room.clients = room.clients.filter(c => c.id !== ws.id);
            if (room.clients.length === 0) {
                clearInterval(room.gameLoopInterval);
                delete rooms[ws.roomCode];
            } else {
                delete room.gameState.players[ws.id];
                const currentPlayers = room.clients.map(c => ({id: c.id, isHost: c.id === room.clients[0].id }));
                const message = JSON.stringify({ type: 'updatePlayers', payload: { players: currentPlayers } });
                room.clients.forEach(c => c.ws.send(message));
            }
        }
    });
});

console.log('Servidor de Asteroids iniciado.');