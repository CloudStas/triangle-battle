const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const io = require('socket.io')(server);
const fs = require('fs');
const csv = require('csv-parser');
const bcrypt = require('bcrypt');

const players = {};
let redkills = 0;
let bluekills = 0;

const MAP_SIZE = 40;
const SPAWN_DISTANCE = 5;
const saltRounds = 10;

app.use(express.static(__dirname + '/public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});
/*
app.get('/signup', (req, res) => {
    res.sendFile(__dirname + '/signup.html');
});

app.get('/login', (req, res) => {
    res.sendFile(__dirname + '/login.html');
});

app.get('/dashboard', (req, res) => {
    res.sendFile(__dirname + '/dashboard.html');
});

app.get('/game', (req, res) => {
    res.sendFile(__dirname + '/game.html');
});
*/

app.get('/notfound', (req, res) => {
    res.sendFile(__dirname + '/notfound.html');
});

async function findUserInCSV(username) {
    return new Promise((resolve, reject) => {
        const users = [];
        fs.createReadStream('userinfo.csv')
            .pipe(csv())
            .on('data', (row) => {
                // Log the raw row object that csv-parser gives you
                console.log("CSV Row (raw):", row);

                if (row.hashedPassword) {
                    row.hashedPassword = row.hashedPassword.trim();
                }
                if (row.username) {
                    row.username = row.username.trim();
                }
                // Log the row after trimming
                console.log("CSV Row (trimmed):", row);

                users.push(row);
            })
            .on('end', () => {
                console.log("All parsed users:", users); // Log all users found
                const user = users.find(u => u.username === username);
                console.log(`Searching for username: '${username}'`);
                console.log("Found user object:", user); // This will tell you if it found it or is undefined
                resolve(user);
            })
            .on('error', (err) => {
                console.error("Error reading CSV:", err); // Log CSV read errors
                reject(err);
            });
    });
}

async function appendUserToCSV(username, hashedPassword) {
    return new Promise((resolve, reject) => {
        const line = `${username},${hashedPassword}\n`;
        fs.appendFile('userinfo.csv', line, (err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

io.on('connection', (socket) => {
    let playerName = "null";
    console.log('a user connected');

    socket.on('loginAttempt', async (data) => {
    const { username, encodedPassword } = data;
    const decodedPassword = Buffer.from(encodedPassword, 'base64').toString('utf8');

    console.log(`Login attempt for username: ${username}`);
    console.log("Decoded password (login attempt):", decodedPassword);
    console.log("Decoded password length:", decodedPassword.length);

    try {
        const user = await findUserInCSV(username);

        // --- IMPORTANT: ADD THIS CHECK ---
        if (!user) {
            console.log(`Login failed: User '${username}' not found.`);
            socket.emit('loginResponse', { success: false, message: 'Incorrect username or password.' });
            return; // Stop execution here if user not found
        }
		
		// In your socket.on('loginAttempt') block, *after* the `if (!user) { ... }` check:

console.log("Stored hash (raw):", user.hashedPassword);
console.log("Stored hash length:", user.hashedPassword.length);
// console.log("Stored hash (trimmed):", user.hashedPassword.trim()); // (This one might be less useful now if .trim() is already in findUserInCSV)
console.log("Stored hash (JSON.stringify):", JSON.stringify(user.hashedPassword)); // <--- MOST IMPORTANT FOR HIDDEN CHARS

console.log("Decoded password (login attempt):", decodedPassword);
console.log("Decoded password length:", decodedPassword.length);
// console.log("Decoded password (JSON.stringify):", JSON.stringify(decodedPassword)); // (Good for checking input as well)
        // --- END OF IMPORTANT CHECK ---

        // These logs are now safe to run because 'user' is guaranteed to exist
        console.log("Stored hash (raw):", user.hashedPassword);
        console.log("Stored hash length:", user.hashedPassword.length);
        console.log("Stored hash (trimmed):", user.hashedPassword.trim());
        console.log("Stored hash (JSON.stringify):", JSON.stringify(user.hashedPassword));

        const passwordMatch = await bcrypt.compare(decodedPassword, user.hashedPassword);

        if (passwordMatch) {
            console.log(`Login successful for: ${username}`);
            socket.emit('loginResponse', { success: true, username: username });
        } else {
            console.log(`Login failed: Incorrect password for '${username}'.`);
            socket.emit('loginResponse', { success: false, message: 'Incorrect username or password.' });
        }
    } catch (error) {
        console.error('Error during login attempt:', error);
        socket.emit('loginResponse', { success: false, message: 'An internal server error occurred.' });
    }
});
    socket.on('signupAttempt', async (data) => {
        const { username, password } = data;
        console.log(`Signup attempt for username: ${username}`);

        try {
            const existingUser = await findUserInCSV(username);
            if (existingUser) {
                console.log(`Signup failed: Username '${username}' already exists.`);
                socket.emit('signupResponse', { success: false, message: 'Username already taken. Please choose another.' });
                return;
            }

            const hashedPassword = await bcrypt.hash(password, saltRounds);
            await appendUserToCSV(username, hashedPassword);

            console.log(`User '${username}' signed up successfully.`);
            socket.emit('signupResponse', { success: true, message: 'Account created successfully!' });
        } catch (error) {
            console.error('Error during signup attempt:', error);
            socket.emit('signupResponse', { success: false, message: 'An internal server error occurred during signup.' });
        }
    });

    socket.on("newPlayer", (name, whatteam) => {
        playerName = name;
        let msg = "Server: Player: " + name + " Has Joined On Team: " + whatteam;
        io.emit("globalmessage", msg);

        if (players[playerName]) {
            delete players[playerName];
            io.emit("RemoveEnemy", playerName);
        }

        if (playerName !== "null" && playerName !== "") {
            const spawnPos = generateSpawnPosition(players);
            players[playerName] = {
                id: socket.id,
                name: playerName,
                whatteam,
                elims: 0,
                position: spawnPos,
                rotation: 0,
                isMoving: false,
                velocity: { x: 0, y: 0 },
                health: 100
            };

            socket.emit("ExistingEnemies",
                Object.values(players)
                    .filter(p => p.name !== playerName)
                    .map(p => ({
                        name: p.name,
                        position: p.position,
                        whatteam: p.whatteam
                    }))
            );

            socket.emit("RedKills", redkills);
            socket.emit("BlueKills", bluekills);

            socket.broadcast.emit("CreateEnemy", {
                name: playerName,
                x: players[playerName].position.x,
                y: players[playerName].position.y,
                whatteam: players[playerName].whatteam
            });

            updateLeaderboard();
        } else {
            console.log("Invalid player name received");
        }

        console.log(`Player joined: ${playerName} Team: ${whatteam} at (${players[playerName].position.x}, ${players[playerName].position.y})`);
        updateLeaderboard();
    });

    socket.on("validateName", (name) => {
        const nameLower = name.toLowerCase();
        const nameTaken = Object.values(players).some(p => p.name.toLowerCase() === nameLower);
        if (nameTaken) {
            socket.emit("nameTaken");
        } else {
            socket.emit("nameValidated");
        }
    });
    
    socket.on("requestSpawnPosition", ({ name, whatteam }) => {
        const spawnPos = generateSpawnPosition(players);
        socket.emit("setSpawnPosition", spawnPos);
        console.log(`Sent spawn position for ${name}: (${spawnPos.x}, ${spawnPos.y})`);
    });

    socket.on("updatePosition", (data) => {
        if (!players[data.name]) return;

        players[data.name].position = data.position;
        players[data.name].rotation = data.rotation;

        socket.broadcast.emit("enemyPositionUpdate", {
            name: data.name,
            position: data.position,
            rotation: data.rotation
        });
    });

    socket.on("updateRotation", ({ name, rotation }) => {
        if (players[name]) {
            players[name].rotation = rotation;

            socket.broadcast.emit("enemyPositionUpdate", {
                name: name,
                position: players[name].position,
                rotation: rotation
            });
        }
    });

    socket.on("shoot", (data) => {
        socket.broadcast.emit("enemyShoot", {
            direction: data.direction,
            position: data.position,
            speed: data.speed,
            owner: data.owner,
            id: data.id
        });
    });

    const lastDamageTimes = new Map();
    const damageCooldown = 100;

    socket.on("damagePlayer", ({ target, amount, from }) => {
        console.log(`Received damagePlayer: target=${target}, amount=${amount}, from=${from}`);
        if (!players[target] || !players[from]) {
            console.log(`Invalid target or source: target=${target}, from=${from}`);
            return;
        }

        const now = Date.now();
        const lastDamage = lastDamageTimes.get(target) || 0;
        if (now - lastDamage < damageCooldown) {
            console.log(`Damage to ${target} ignored due to cooldown`);
            return;
        }
        lastDamageTimes.set(target, now);

        players[target].health = Math.max(0, players[target].health - amount);
        console.log(`Player ${target} health reduced to ${players[target].health}`);

        io.to(players[target].id).emit("applyDamage", {
            amount: amount,
            killer: from
        });

        if (players[target].health <= 0) {
            console.log(`Player ${target} died`);
            players[target].isDead = true;
            players[from].elims += 1;
            if (players[from].whatteam === "red") {
                redkills += 1;
                io.emit("RedKills", redkills);
            } else if (players[from].whatteam === "blue") {
                bluekills += 1;
                io.emit("BlueKills", bluekills);
            }

            io.to(players[target].id).emit("playerDied", {
                name: target,
                killer: from
            });
            io.emit("RemoveEnemy", target);
            updateLeaderboard();
        }
    });

    socket.on('respawnPlayer', ({ name }) => {
        if (players[name]) {
            players[name].health = 100;
            players[name].isDead = false;
            players[name].position = generateSpawnPosition(players);
            io.emit('playerRespawn', {
                name: name,
                position: players[name].position,
                whatteam: players[name].whatteam
            });
            console.log(`Player ${name} respawned at ${players[name].position.x}, ${players[name].position.y}`);
            updateLeaderboard();
        }
    });

    socket.on("dash", ({ direction, position, name }) => {
        io.emit("playDash", { direction, position, name });
    });

    socket.on("RemovePlayer", (playerName, killer) => {
        if (players[playerName]) {
            delete players[playerName];
            socket.broadcast.emit("RemoveEnemy", playerName);
            updateLeaderboard();
        }
    });

    socket.on("PlayerDis", (name, whatteam) => {
        let msg = "Server: Player: " + name + " From Team: " + whatteam + " Left the game";
        io.emit("globalmessage", msg);

        if (players[name]) {
            delete players[name];
            io.emit("RemoveEnemy", name);
            updateLeaderboard();
        }
    });

    socket.on("message", (msg) => {
        console.log("Message received:", msg);
        io.emit("globalmessage", msg);
    });

    socket.on("disconnect", () => {
        if (playerName && players[playerName]) {
            delete players[playerName];
            io.emit("RemoveEnemy", playerName);
            updateLeaderboard();
            console.log(`Player disconnected: ${playerName}`);
        }
    });
});

function updateLeaderboard() {
    const leaderboard = Object.values(players)
        .filter(p => !p.isDead)
        .sort((a, b) => b.elims - a.elims);
    io.emit("updateLeaderboard", leaderboard);
}

function generateSpawnPosition(existingPlayers) {
    if (Object.keys(existingPlayers).length === 0) {
        return { x: 0, y: 0 };
    }

    const playerArray = Object.values(existingPlayers);
    const randomPlayer = playerArray[Math.floor(Math.random() * playerArray.length)];

    let attempts = 0;
    const maxAttempts = 10;
    while (attempts < maxAttempts) {
        const angle = Math.random() * Math.PI * 2;
        const x = randomPlayer.position.x + Math.cos(angle) * SPAWN_DISTANCE;
        const y = randomPlayer.position.y + Math.sin(angle) * SPAWN_DISTANCE;

        if (x < -MAP_SIZE / 2 || x > MAP_SIZE / 2 || y < -MAP_SIZE / 2 || y > MAP_SIZE / 2) {
            attempts++;
            continue;
        }

        let valid = true;
        for (const player of Object.values(existingPlayers)) {
            if (player !== randomPlayer) {
                const dist = Math.sqrt((x - player.position.x) ** 2 + (y - player.position.y) ** 2);
                if (dist < SPAWN_DISTANCE / 2) {
                    valid = false;
                    break;
                }
            }
        }

        if (valid) {
            return { x, y };
        }
        attempts++;
    }

    return { x: 0, y: 0 };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on port ${PORT}`);
});
