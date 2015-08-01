sleep = Meteor.wrapAsync(function(time, cb) {
  return Meteor.setTimeout((function() {
    return cb();
  }), time);
});

const num = Meteor.settings.clients;
const batchId = Meteor.settings.batchId;
const url = Meteor.settings.url;

Meteor.startup(function() {
  const clients = [];

  for( let i = 0; i < num; i++ ) {
    const client = DDP.connect(url);

    // Set up collections for this client
    client.users = new Mongo.Collection("users", { connection: client });
    client.LobbyStatus = new Mongo.Collection("ts.lobby", { connection: client });

    // Partitioned game collections
    client.Actions = new Mongo.Collection('actions', { connection: client });
    client.Rounds = new Mongo.Collection('rounds', { connection: client });
    client.Games = new Mongo.Collection('games', { connection: client });

    // Wait till we're logged in to start doing stuff
    const loginHandle = client.users.find({}).observeChanges({
      added: function(userId) {
        client.userId = userId;
        console.log(`Logged in with ${userId}`);

        Meteor.defer(function() {
          loginHandle.stop();
          startActions(client);
        });
      }
    });

    client.call("login", {
      hitId: `${Random.id()}_HIT`,
      assignmentId: `${Random.id()}_Asst`,
      workerId: `${Random.id()}_Worker`,
      batchId,
      test: true
    });

    clients.push(client);
  }

});

function startActions(client) {
  // Watch the lobby. Whenever we appear in it and are not ready, toggle.
  client.LobbyStatus.find({
    _id: client.userId,
    status: {$ne: true}
  }).observeChanges({
    added: function() {
      client.call("toggleStatus");
    }
  });

  client.subscribe("lobby", batchId);

  // Set up subscriptions to game data
  client.users.find({
    _id: client.userId,
    group: { $exists: true }
  }, {
    fields: { group: 1 }
  }).observeChanges({
    added: function(userId, fields) {
      teardownSubscriptions(client);
      setupSubscriptions(client, fields.group);
    },
    removed: function() {
      teardownSubscriptions(client);
    }
  })
}

function setupSubscriptions(client, group) {
  // TODO subscribe to other things like ts.rounds for load purposes
  client.userSub = client.subscribe('users', group);
  client.roundsSub = client.subscribe('rounds', group);
  client.actionsSub = client.subscribe('actions', group);
  client.gameSub = client.subscribe('games', group);

  console.log("Subscribed to group");

  client.actionHandle = client.Rounds.find({}).observeChanges({
    added: function(id, fields) {
      const index = fields.index;

      console.log(`${client.userId} in group ${group} is taking action for round ${index} on document ${id} with fields `, fields);

      try {
        client.call("chooseAction", Math.round(Math.random() + 1), index);
      } catch (e) {
        console.log(`Couldn\'t take action for user ${client.userId} in group ${group} for round ${index} on document ${id} with fields`, fields, e);
      }

      if (index === 10) {
        sleep(500);
        client.call("goToLobby");
      }

    }
  });
}

function teardownSubscriptions(client) {
  for (let x in [ "userSub", "roundsSub", "actionsSub", "gameSub"]) {
    client[x] && client[x].stop();
    delete client[x];
  }

  client.actionHandle && client.actionHandle.stop();
}
