var Logger  = require('./logger.js');
var config = require('./config.js');
var AgarioClient = require('agario-client');

function Coordinator(opt) {
    /*if(opt.id == 9) {
        opt.server = '37.139.22.85:9158';
    }*/

    this.log             = new Logger('COORDINATOR/' + opt.id + '/' + opt.task.id);
    this.id              = opt.id;
    this.task            = opt.task;
    this.server          = opt.server;
    this.key             = opt.key;
    this.proxy           = opt.proxy;
    this.gps             = opt.gps;
    this.target_type     = config.remote.coordinators_targets[this.id] ? config.remote.coordinators_targets[this.id].type : 'waypoints'; // waypoints / ball / biggest
    this.waypoints       = config.remote.coordinators_targets[this.id] ? config.remote.coordinators_targets[this.id].waypoints : [[7000,7000],[7000-100,7000-100],[7000+100,7000+100]];
    this.current_waypoint= 0;
    this.offset_x        = 0;
    this.offset_y        = 0;
    this.x               = 0;
    this.y               = 0;
    this.client          = null;
    this.connected       = false;
    this.proxy_approved  = false;

    this.move_interval   = null;
    this.fov_timeout     = null;

    this.connect();

    if(config.debug >= 2)
        this.log.info('Coordinator created!');
}

Coordinator.prototype.connect = function() {
    if(this.gps.task.destroyed) {
        if(config.debug >= 2)
            this.log.info('Task is destroyed, no more connection attempts will be made');
        return;
    }
    if(this.proxy.dead) {
        if(config.debug >= 2)
            this.log.error('Proxy is dead, no more connection attempts will be made');
        return false;
    }

    if(config.debug >= 3)
        this.log.info('Connecting to ' + this.server + ' with key ' + this.key + ' using proxy ' + this.proxy);

    this.client         = new AgarioClient('COORDINATOR/' + this.server + '/' + this.key);
    this.client.debug              = 0;
    this.client.inactive_destroy   = 1000;
    this.client.inactive_check     = 1000;
    var ws_address      = 'ws://' + this.server;

    this.client.agent = this.proxy.createAgent();

    this.client.connect(ws_address, this.key);

    this.attachEvents();
};


Coordinator.prototype.attachEvents = function() {
    var client = this.client;

    client.on('connected', this.onConnected.bind(this));
    client.on('connectionError', this.disconnect.bind(this));
    client.on('disconnect', this.disconnected.bind(this));
    client.on('mapSizeLoad', this.onMapSizeLoad.bind(this));
    client.on('spectateFieldUpdate', this.onSpectateFieldUpdate.bind(this));
    client.on('packetError', this.onPacketError.bind(this));
    //client.on('ballAppear', this.onBallAppear.bind(this));
    client.on('ballRename', this.onBallRename.bind(this));
    client.on('ballMove', this.onBallMove.bind(this));
};

Coordinator.prototype.onConnected = function() {
    var client = this.client;

    this.proxy.success();
    client.spectate();
    if(this.target_type != 'biggest') {
        client.spectateModeToggle();
        this.move_interval = setInterval(this.move.bind(this), config.remote.coordinator_move_interval);
    }
    this.restartFOVTimeout();

    if(config.debug >= 1)
        this.log.info('Coordinator connected!');
};

Coordinator.prototype.onPacketError = function(packet, err, preventCrash) {
    if(config.debug >= 1)
        this.log.info('Packet error: ' + packet.toString() + '\nerr: ' + err + '\n' + err.stack);
    this.disconnect();
    preventCrash();
};

Coordinator.prototype.disconnected = function(e) {
    if(config.debug >= 2)
        this.log.info('Coordinator disconnected!' + (e?' With error ' + e + e.stack:''));
    var coordinator = this;

    this.connected = false;
    this.proxy.fail();
    if(!this.proxy_approved) this.proxy.fail();
    this.reset();

    setTimeout(function(){
        coordinator.connect();
    }, config.remote.coordinators_reconnect);
};

Coordinator.prototype.onMapSizeLoad = function(x, y, x2, y2) {
    if(config.debug >= 4)
        this.log.info('Map size load: ' + x + ':' + y + ':' + x2 + ':' + y2);

    this.offset_x = x;
    this.offset_y = y;
};

Coordinator.prototype.onSpectateFieldUpdate = function(x, y) {
    var coordinator = this;
    this.x = x - this.offset_x;
    this.y = y - this.offset_y;

    if(config.debug >= 6)
        this.log.info('Spectate field update: ' + this.x + ' : ' + this.y);

    if(coordinator.target_type == 'waypoints') {
        this.checkWaypoint();
    }

    if(!this.proxy_approved) {
        this.proxy.success();
        this.proxy_approved = true;
    }

    this.restartFOVTimeout();
};

/*Coordinator.prototype.onBallAppear = function(ball_id) {
    var ball = this.client.balls[ball_id];
    this.gps.ballAppeared(ball, this);
};*/

Coordinator.prototype.onBallRename = function(ball_id, old_name, new_name) {
    if(!this.gps.known_balls[new_name]) {
        var ball = this.client.balls[ball_id];
        if(!ball.visible) return;
        this.gps.known_balls[new_name] = ball;
        this.gps.known_balls[new_name].coordinator = this;
        this.gps.ballAppeared(this.client.balls[ball_id], this);
    }
};

Coordinator.prototype.onBallMove = function(ball_id) {
    var ball = this.client.balls[ball_id];
    if(!this.gps.known_balls[ball.name]) {
        this.gps.known_balls[ball.name] = ball;
        this.gps.known_balls[ball.name].coordinator = this;
        return;
    }
    if(ball.name && this.gps.known_balls[ball.name]) {
        this.gps.known_balls[ball.name] = ball;
        this.gps.known_balls[ball.name].coordinator = this;
    }
};

Coordinator.prototype.disconnect = function() {
    if(config.debug >= 3)
        this.log.info('disconnect() called');

    this.client.disconnect();
    this.disconnected();
};

Coordinator.prototype.restartFOVTimeout = function() {
    var coordinator = this;
    if(this.fov_timeout) clearTimeout(this.fov_timeout);
    this.fov_timeout = setTimeout(function() {
        if(config.debug >= 2)
            coordinator.log.error('Disconnecting due to FOV timeout');
        coordinator.disconnect();
    }, config.remote.coordinator_fov_timeout);

};

Coordinator.prototype.moveTo = function(x, y) {
    this.client.moveTo(x+this.offset_x, y+this.offset_y);
};

Coordinator.prototype.move = function() {
    var coordinator = this;
    if(coordinator.target_type == 'waypoints') {
        var waypoint = coordinator.waypoints[coordinator.current_waypoint];
        var waypoint_x = waypoint[0];
        var waypoint_y = waypoint[1];

        coordinator.moveTo(waypoint_x, waypoint_y);
    }else if(coordinator.target_type == 'ball') {

    }
};

Coordinator.prototype.getBallByName = function(name) {
    return;
    for(var ball_id in this.client.balls) {
        if(!this.client.balls.hasOwnProperty(ball_id)) continue;
        if(this.client.balls[ball_id].name === name) return this.client.balls[ball_id];
    }
};

Coordinator.prototype.reset = function() {
    if(this.fov_timeout) clearTimeout(this.fov_timeout);
    if(this.move_interval) clearInterval(this.move_interval);

    this.client.removeAllListeners();
    this.client.on('error', function(){});
};

Coordinator.prototype.visibilityInfo = function() {
    var min_x = null;
    var max_x = null;
    var min_y = null;
    var max_y = null;

    for(var ball_id in this.client.balls) {
        if(!this.client.balls.hasOwnProperty(ball_id)) continue;
        var ball = this.client.balls[ball_id];
        if(!ball.visible) continue;

        var ball_x = ball.x-this.offset_x;
        var ball_y = ball.y-this.offset_y;

        if(max_x === null || ball_x > max_x) max_x = ball_x;
        if(min_x === null || ball_x < min_x) min_x = ball_x;
        if(max_x === null || ball_y > max_y) max_y = ball_y;
        if(min_y === null || ball_y < min_y) min_y = ball_y;
    }

    return {
        min_x: min_x,
        max_x: max_x,
        min_y: min_y,
        max_y: max_y,
        width: Math.abs(min_x-max_x),
        height: Math.abs(min_y-max_y)
    };
};

Coordinator.prototype.checkWaypoint = function() {
    var coordinator = this;
    if(coordinator.waypoints.length <= 1) return;
    var waypoint = coordinator.waypoints[coordinator.current_waypoint];
    var waypoint_x = waypoint[0];
    var waypoint_y = waypoint[1];
    var distance = distanceBetweenPoints(this.x, this.y, waypoint_x, waypoint_y);
    if(distance > config.remote.coordinator_waypoint_switch) return;

    coordinator.current_waypoint++;
    if(coordinator.current_waypoint >= this.waypoints.length) {
        coordinator.current_waypoint = 0;
    }

    coordinator.moveTo(waypoint_x, waypoint_y);
};

module.exports = Coordinator;

function distanceBetweenPoints(x, y, x2, y2) {
    var xdiff = x2 - x;
    var ydiff = y2 - y;
    return Math.pow((xdiff * xdiff + ydiff * ydiff), 0.5);
}


/*var opt = {
    id: 1,
    server: '192.168.1.4:9158',
    key: '',
    task: null,
    proxy: new (require('./proxy.js'))(['23.252.106.118',3599,4])
};
var coordinator = new Coordinator(opt);*/