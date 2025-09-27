const { WebSocketServer } = require('ws');
const http = require('http');

// Configuración del servidor para ser compatible con Render
const server = http.createServer();
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 8080;

const rooms = {};
const TICK_RATE = 1000 / 20; // 20 actualizaciones por segundo para reducir lag
const SHIP_SIZE = 15, FRICTION = 0.99;
const PLAYER_COLORS = ['#0f0', '#0af', '#f80', '#f0f'];
const ORB_TYPES = [
    { type: 'green', duration: 300, rarity: 0.1 }, { type: 'red', duration: 420, rarity: 0.2 },
    { type: 'blue', duration: 300, rarity: 0.2 }, { type: 'yellow', duration: 300, rarity: 0.2 },
    { type: 'purple', duration: 300, rarity: 0.15 }, { type: 'orange', duration: 300, rarity: 0.2 },
    { type: 'rainbow', duration: 0, rarity: 0.05 },
];

function createInitialGameState(mode) {
    const initialState = {
        players: {}, bullets: [], orbs: [], asteroids: [],
        gameMode: mode, inProgress: false, gameOver: false,
    };
    if (mode === 'pvp') {
        initialState.matchTime = 2.5 * 60 * 20; // Ajustado a 20 ticks/seg
        initialState.orbSpawnTimer = 100;
    } else { // coop
        initialState.score = 0;
        initialState.lives = 3;
        initialState.level = 1;
    }
    return initialState;
}

function updateRoom(room) {
    const { gameState } = room;
    if (!gameState.inProgress || gameState.gameOver) return;
    const wrap = (val, max) => (val < 0) ? val + max : (val > max) ? val - max : val;

    // Movimiento de Balas
    gameState.bullets.forEach(b => {
        b.x += b.vx; b.y += b.vy;
        b.x = wrap(b.x, 1200); b.y = wrap(b.y, 800);
    });

    // Movimiento de Jugadores
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
        p.x = wrap(p.x + p.vx, 1200);
        p.y = wrap(p.y + p.vy, 800);
    }
    
    // Lógica específica del modo de juego
    if (gameState.gameMode === 'pvp') {
        if (gameState.matchTime-- <= 0) gameState.gameOver = true;
        if (gameState.orbSpawnTimer-- <= 0) { spawnOrb(gameState); gameState.orbSpawnTimer = 120 + Math.random() * 60; }
        handlePvpCollisions(gameState);
    } else { // coop
        handleCoopLogic(gameState);
    }

    gameState.bullets = gameState.bullets.filter(b => --b.life > 0);
    const message = JSON.stringify({ type: 'state', payload: { state: gameState } });
    room.clients.forEach(c => c.ws.send(message));
}

function spawnOrb(gameState) {
    let rand = Math.random();
    const orbType = ORB_TYPES.find(o => (rand -= o.rarity) < 0) || ORB_TYPES[0];
    gameState.orbs.push({ x: Math.random()*1100+50, y: Math.random()*700+50, r: 10, type: orbType.type, id: Date.now()+Math.random()});
}

function spawnAsteroid(gameState, x, y, radius) {
    const level = radius ? (radius < 25 ? 2 : 1) : 0;
    const r = radius || 30 + Math.random() * 20;
    const shape = []; const segments = 12;
    for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        const radiusOffset = 0.8 + Math.random() * 0.4;
        shape.push({ x: Math.cos(angle) * r * radiusOffset, y: Math.sin(angle) * r * radiusOffset });
    }
    gameState.asteroids.push({
        x: x || (Math.random() > 0.5 ? 0 : 1200), y: y || (Math.random() > 0.5 ? 0 : 800),
        vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2,
        r: r, level: level, shape: shape, rotation: 0, rotationSpeed: (Math.random() - 0.5) * 0.02
    });
}

function handlePvpCollisions(gameState) {
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

function handleCoopLogic(gameState) {
    if (gameState.asteroids.length === 0) {
        gameState.level++;
        for(let i = 0; i < 3 + gameState.level; i++) spawnAsteroid(gameState);
    }
    const wrap = (val, max) => (val < 0) ? val + max : (val > max) ? val - max : val;
    gameState.asteroids.forEach(a => { a.x += a.vx; a.y += a.vy; a.rotation += a.rotationSpeed; a.x = wrap(a.x, 1200); a.y = wrap(a.y, 800); });
    
    for (let i = gameState.bullets.length - 1; i >= 0; i--) {
        const b = gameState.bullets[i];
        let bulletRemoved = false;
        for (let j = gameState.asteroids.length - 1; j >= 0; j--) {
            const a = gameState.asteroids[j];
            if (Math.hypot(b.x - a.x, b.y - a.y) < a.r) {
                gameState.bullets.splice(i, 1); bulletRemoved = true;
                gameState.score += a.level === 0 ? 20 : (a.level === 1 ? 50 : 100);
                if (a.level < 2) { spawnAsteroid(gameState, a.x, a.y, a.r / 2); spawnAsteroid(gameState, a.x, a.y, a.r / 2); }
                gameState.asteroids.splice(j, 1); break;
            }
        }
        if(bulletRemoved) continue;
    }

    for (const id in gameState.players) {
        const p = gameState.players[id];
        if (p.invincible > 0) continue;
        let playerHit = false;
        for (const a of gameState.asteroids) {
            if (Math.hypot(p.x - a.x, p.y - a.y) < a.r + p.size / 2) {
                playerHit = true; break;
            }
        }
        if (playerHit) {
            p.x = 1200 / 2; p.y = 800 / 2; p.vx = 0; p.vy = 0; p.invincible = 180;
            gameState.lives--;
            if (gameState.lives <= 0) gameState.gameOver = true;
        }
    }
}

wss.on('connection', ws => {
    ws.id = Math.random().toString(36).substr(2, 9);
    ws.on('message', message => {
        try {
            const { type, payload } = JSON.parse(message);
            if (type === 'create') {
                let roomCode;
                do { roomCode = Math.random().toString(36).substring(2, 7).toUpperCase(); } while (rooms[roomCode]);
                const client = { ws, id: ws.id };
                rooms[roomCode] = { clients: [client], gameState: createInitialGameState(payload.gameMode), gameLoopInterval: null };
                ws.roomCode = roomCode;
                ws.send(JSON.stringify({ type: 'roomCreated', payload: { roomCode, playerId: ws.id, players: [{id: ws.id, isHost: true}] } }));
            } 
            else if (type === 'join') {
                const { roomCode } = payload;
                const room = rooms[roomCode];
                if (!room) { ws.send(JSON.stringify({ type: 'error', payload: 'La sala no existe.' })); return; }
                const maxPlayers = room.gameState.gameMode === 'pvp' ? 4 : 2;
                if (room.clients.length < maxPlayers) {
                    const client = { ws, id: ws.id };
                    room.clients.push(client);
                    ws.roomCode = roomCode;
                    ws.send(JSON.stringify({ type: 'joinedRoom', payload: { roomCode, playerId: ws.id } }));
                    const currentPlayers = room.clients.map((c, i) => ({id: c.id, isHost: i === 0 }));
                    const message = JSON.stringify({ type: 'updatePlayers', payload: { players: currentPlayers } });
                    room.clients.forEach(c => c.ws.send(message));
                } else { ws.send(JSON.stringify({ type: 'error', payload: 'La sala está llena.' })); }
            }
            else if (type === 'start') {
                const room = rooms[ws.roomCode];
                if (room && room.clients[0].id === ws.id) {
                    room.gameState.inProgress = true;
                    room.clients.forEach((c, index) => {
                        room.gameState.players[c.id] = { id: c.id, x: Math.random()*1200, y: Math.random()*800, vx:0,vy:0, angle:0, keys: {}, shootCooldown:0, invincible:180, color: PLAYER_COLORS[index], kills: 0, powerUp: {}, size: SHIP_SIZE };
                    });
                    if (room.gameState.gameMode === 'coop') { for(let i=0; i<5; i++) spawnAsteroid(room.gameState); }
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
        } catch (error) { console.error("Mensaje inválido:", error); }
    });
    ws.on('close', () => {
        const room = rooms[ws.roomCode];
        if (room) {
            room.clients = room.clients.filter(c => c.id !== ws.id);
            if (room.clients.length === 0) {
                clearInterval(room.gameLoopInterval);
                delete rooms[roomCode];
            } else {
                delete room.gameState.players[ws.id];
                const currentPlayers = room.clients.map((c, i) => ({id: c.id, isHost: i === 0 }));
                const message = JSON.stringify({ type: 'updatePlayers', payload: { players: currentPlayers } });
                room.clients.forEach(c => c.ws.send(message));
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Servidor de Asteroids Definitivo iniciado en el puerto ${PORT}`);
});