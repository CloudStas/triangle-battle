const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const io = require('socket.io')(server);

const players = {};

let redkills = 0;
let bluekills = 0;
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/game.html');
});

io.on('connection', (socket) => {
  let playerName = "null";
  console.log('a user connected');

 socket.on("newPlayer", (name, whatteam) => {
  playerName = name;

  if (players[playerName]) {
    delete players[playerName];
    io.emit("RemoveEnemy", playerName);
  }

  if (playerName !== "null" && playerName !== "") {
    players[playerName] = {
      id: socket.id,
      name: playerName,
      whatteam, 
      elims: 0,
      position: { x: 0, y: 0 },
      rotation: 0,
      isMoving: false,
      velocity: { x: 0, y: 0 }
    };

    // Send existing enemies to the new player, including whatteam
    socket.emit("ExistingEnemies",
		Object.values(players)
			.filter(p => p.name !== playerName)
			.map(p => ({
				name: p.name,
				position: p.position,
				whatteam: p.whatteam 
			}))
    );

	socket.broadcast.emit("CreateEnemy", {
		name: playerName,
		x: players[playerName].position.x,
			y: players[playerName].position.y,
			whatteam: players[playerName].whatteam
		});

		updateLeaderboard();
		} 	else {
			console.log("Invalid player name received");
		}

		console.log(`Player joined: ${playerName} Team: ${whatteam}`);
		updateLeaderboard();
	});

  socket.on("updatePosition", (data) => {
      if (!players[playerName]) return;

      players[playerName].position = data.position;
      players[playerName].rotation = data.rotation;
     
      io.emit("enemyPositionUpdate", {
            name: playerName,
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
	
     socket.on("damagePlayer", ({ target, from }) => {
	
    if (players[target]) {
        if (players[target].health === undefined) {
            players[target].health = 100;
        }

        players[target].health -= 10;

        io.to(players[target].id).emit("applyDamage", {
            amount: 10,
            killer: from
        });

        if (players[target].health <= 0) {
            if (players[from]) {
                players[from].elims += 1;

                
                if (players[from].whatteam === "red") {
                    redkills += 1;
					io.emit("RedKills: " + redkills);
                } else if (players[from].whatteam === "blue") {
                    bluekills += 1;
					io.emit("BlueKills: " + bluekills);
                }
            }

            io.emit("playerDied", { target, killer: from });
            delete players[target];
            io.emit("RemoveEnemy", target);
            updateLeaderboard();
        }
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

  socket.on("PlayerDis", (name) => {
    if (players[name]) {
      delete players[name];
      io.emit("RemoveEnemy", name);
      updateLeaderboard();
    }
  });
  
 socket.on("message", (msg) => {
    console.log(`Received message: ${msg}`);
    
    // Broadcast the message to all players
    io.emit("message", msg);
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
    leaderboard = Object.values(players).sort((a, b) => b.elims - a.elims);
    io.emit("updateLeaderboard", leaderboard);
  }
  


const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on port ${PORT}`);
});
