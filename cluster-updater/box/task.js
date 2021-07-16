var Logger  = require('./logger.js');
var config = require('./config.js');
var Servers = require('agario-client/servers');
var Proxy = require('./proxy.js');
var Bot = require('./bot.js');
var GPS = require('./gps.js');
var DataProxy = require('./dataproxy.js');

Task.tasks = {};

function Task(opt) {
    this.id             = opt.id;
    this.log            = new Logger(this.id);
    this.proxies        = [];
    this.type           = opt.type;
    this.nickname       = opt.nickname || 'TEST';
    this.count          = opt.count;
    this.remain         = opt.remain;
    this.region         = opt.region;
    this.leaders        = opt.leaders;
    this.key            = opt.key;
    this.server         = opt.server;
    this.dataproxy_port = opt.dataproxy_port;

    this.bots            = [];
    this.known_balls     = {}; //todo manage this, manage intervals
    this.connected_bots  = 0;
    this.target_type     = 'nickname'; //cords / ball / nickname / mouse
    this.target_nickname = 'TEST11112';
    this.target_ball_id  = 0;
    this.target_x        = 0;
    this.target_y        = 0;
    this.customer_offset_x = 0;
    this.customer_offset_y = 0;
    this.customer_ball_name= '';

    this.tick_interval     = null;
    this.spawn_interval    = null;
    this.engage_interval   = null;
    this.expire_timeout    = null;
    this.overjoin_interval = null;
    this.known_balls_check_interval = null;

    this.destroyed = false;

    this.gps = new GPS({
        task: this
    });

    this.dataproxy = new DataProxy({
        task: this
    });

    for(var i=0;i<opt.proxies.length;i++) {
        this.proxies.push(new Proxy(opt.proxies[i]));
    }

    if(config.debug >= 1)
        this.log.info('Task created!');

    if(config.debug >= 3)
        this.log.info('Task created: proxies=' + this.proxies + ', type=' + this.type + ', key=' + this.key + ', server=' + this.server + ', count=' + this.count + ', remain=' + this.remain + ', region=' + this.region + ', leaders=' + this.leaders);

    if(this.type == 'party') {
        this.checkPartyServer();
    }

    Task.tasks[this.id] = this;
}

Task.prototype.checkPartyServer = function() {
    var task = this;
    var approved = false;
    var checks = (config.remote.party_check_threads > this.proxies.length) ? this.proxies.length : config.remote.party_check_threads;

    if(config.debug >= 3)
        this.log.info('checkPartyServer: Checking party key using ' + checks + ' threads');

    for(var i=0;i<checks;i++) {
        var proxy = this.proxies[i];

        (function(proxy) {
            var agent = proxy.createAgent();

            Servers.getPartyServer({party_key: task.key, agent: agent}, function(srv) {
                if(approved) return;
                if(task.destroyed) return;
                checks--;
                if(!srv.server) {
                    if(config.debug >= 2)
                        task.log.info('checkPartyServer: Failed to request server (error=' + srv.error + ', error_source=' + srv.error_source + ')');
                }else{
                    if(srv.server == task.server && srv.key == task.key) {

                        if(task.gps.coordinators.length >= config.remote.coordinators_per_socks * config.remote.coordinator_socks_count) {
                            task.engageBots();
                            approved = true;
                        }

                        for(var i=0;i<config.remote.coordinators_per_socks;i++) {
                            task.engageCoordinator({
                                server: srv.server,
                                key: srv.key,
                                proxy: proxy
                            });
                        }

                        return;
                    }else{
                        if(config.debug >= 1)
                            task.log.error('checkPartyServer: Party key mismatch! Are we getting hacked? task.server=' + task.server + ', task.key=' + task.key + ', srv.server=' + srv.server + ', srv.key=' + srv.key);
                    }
                }

                if(!checks && !approved) {
                    task.send('notice_customer', 14);
                    task.destroy();
                }
            });
        })(proxy);
    }
};

Task.prototype.engageCoordinator = function(opt) {
    var id = this.gps.coordinators.length+1;
    //if(id > config.remote.coordinators_per_socks * config.remote.coordinator_socks_count) return;
    if(config.debug >= 1)
        this.log.info('Creating coordinator #' + id);

    var c_opt = {
        id: id,
        task: this,
        server: opt.server,
        key: opt.key,
        proxy: opt.proxy,
        gps: this.gps
    };

    this.gps.engage(c_opt);

    var proxy_id = this.proxies.indexOf(opt.proxy);
    if(proxy_id >= 0) this.proxies.splice(proxy_id,1);
};

Task.prototype.engageBots = function() {
    var task = this;

    if(config.debug >= 2)
        this.log.info('engageBots: creating ' + (this.proxies.length*config.remote.connections_per_socks) + ' clients');

    var queue = [];
    for(var i=0;i<this.proxies.length;i++) {
        var proxy = this.proxies[i];
        for(var j=0;j<config.remote.connections_per_socks;j++) {
            var opt = {
                server:     this.server,
                key:        this.key,
                task:       this,
                proxy:      proxy,
                type:       this.type
            };
            queue.push(opt);
        }
    }

    for(var u=0;u<this.count*config.remote.preload_amount;u++) {
        if(!queue.length) break;
        var bot_opt = queue.splice(0, 1)[0];

        this.bots.push( new Bot(bot_opt) );
    }

    this.engage_interval = setInterval(function() {
        if(!queue.length) return;
        if(task.connected_bots >= task.count) return;

        var bot_opt = queue.splice(0, 1)[0];
        task.bots.push( new Bot(bot_opt) );

        if(!queue.length) {
            clearInterval(task.engage_interval);
        }
    }, config.remote.engage_interval);

    this.postEngagement();
};

Task.prototype.postEngagement = function() {
    var task = this;

    this.spawn_interval = setInterval(function() {
        for(var i=0;i<task.bots.length;i++) {
            task.bots[i].spawn();
        }
    }, config.remote.spawn_interval);

    this.tick_interval = setInterval(function() {
        if(task.target_type != 'mouse' && task.target_type != 'cords' && task.target_type != 'nickname') return;
        var now = (+new Date);

        for(var i=0;i<task.bots.length;i++) {
            var bot = task.bots[i];
            if(bot.offset_x === null) continue;
            if(task.target_type == 'nickname' && now-bot.last_tick > config.remote.tick_interval) {
                bot.moveTo(task.target_x, task.target_y);
            }else if(task.target_type == 'ball' && now-bot.last_tick > config.remote.tick_interval) {
                bot.moveTo(task.target_x, task.target_y);
            }else if(task.target_type == 'cords') {
                bot.moveTo(task.target_x, task.target_y);
            }else if(task.target_type == 'mouse') {
                bot.moveTo(task.target_x, task.target_y);
            }
        }
    }, config.remote.tick_interval);

    var last_connected_sent = 0;
    this.status_interval = setInterval(function(){
        if(last_connected_sent == task.connected_bots) return;
        last_connected_sent = task.connected_bots;

        task.send('connected', + task.connected_bots);
    }, config.remote.status_interval);

    this.expire_timeout = setTimeout(function(){
        task.send('notice_customer', 15);
        task.destroy();
    }, this.remain * 1000);

    this.overjoin_interval = setInterval(function() {
        if(task.count*config.remote.bots_overjoin_max > task.connected_bots) return;
        if(config.debug >= 2)
            task.log.info('overjoin detected, removing overselled');

        for(var i=0;i<task.bots.length;i++) {
            var bot = task.bots[i];
            if(bot.connected) {
                bot.disconnect();
                return;
            }
        }
    }, config.remote.bots_overjoin_interval);

    this.known_balls_check_interval = setInterval(function() {
        var now = (+new Date);
        for(var ball_name in task.gps.known_balls) {
            if(!task.gps.known_balls.hasOwnProperty(ball_name)) continue;
            var ball = task.gps.known_balls[ball_name];
            if(now - ball.last_update > config.remote.gps_known_balls_life) delete task.gps.known_balls[ball_name];
        }
    }, config.remote.gps_known_balls_life);
};

Task.prototype.destroy = function() {
    var task = this;
    this.destroyed = true;

    if(config.debug >= 1)
        task.log.info('destroying');

    clearInterval(this.spawn_interval);
    clearInterval(this.tick_interval);
    clearInterval(this.engage_interval);
    clearInterval(this.status_interval);
    clearTimeout(this.expire_timeout);
    clearInterval(this.overjoin_interval);
    clearInterval(this.known_balls_check_interval);

    for(var i=0;i<this.bots.length;i++) {
        var bot = this.bots[i];
        bot.disconnect();
    }

    for(i=0;i<this.gps.coordinators.length;i++) {
        var coordinator = this.gps.coordinators[i];
        coordinator.disconnect();
    }

    this.dataproxy.destroy();

    delete Task.tasks[this.id];

    this.send('disengaged');
};

Task.prototype.send = function() {
    var args = ['task', this.id];
    for(var i=0;i<arguments.length;i++) {
        args.push(arguments[i])
    }
    Task.box.send.apply(Task.box, args);
};

Task.prototype.setTarget = function(target, a, b, ball_name, ball_x, ball_y) {
    this.target_type = target;
    if(target == 'cords') {
        this.target_x = a;
        this.target_y = b;
        this.target_ball_id = 0;

        if(this.customer_ball_name != ball_name) {
            var candidate = this.gps.bestCandidate(ball_name);
            if(candidate) {
                var ball = candidate.ball;
                var coordinator = candidate.coordinator;
                var real_ball_x = (ball.x-coordinator.offset_x);
                var real_ball_y = (ball.y-coordinator.offset_y);
                this.customer_offset_x = (ball_x-real_ball_x) || 1;
                this.customer_offset_y = (ball_y-real_ball_y) || 1;
                this.customer_ball_name = ball_name;
            }
        }

        if(!this.customer_offset_x) return;

        this.target_x = a-this.customer_offset_x;
        this.target_y = b-this.customer_offset_y;
    }else if(target == 'nickname') {
        this.target_nickname = a;
        this.target_ball_id = 0;
    }else if(target == 'ball') {
        this.target_ball_id = a;
    }else if(target == 'mouse') {
        //ball_x, ball_y, ball_name, ball_id, ball_ids
        this.target_x = 0;
        this.target_y = 0;
        this.target_ball_id = 0;
        this.customer_offset_x = 0;
        this.customer_offset_y = 0;
    }
};

Task.prototype.memoryReset = function() {
    for(var i=0;i<this.gps.coordinators;i++) {
        var coordinator = this.gps.coordinators[i];
        for(var j=0;j<coordinator.client.balls.length;j++) {
            var ball = coordinator.client.balls[j];
            if(!this.known_balls[ball.name]) ball.destroy({reason: 'memory_reset'});
        }
    }

    if(this.gps.known_balls[this.customer_ball_name]) {
        this.gps.known_balls[this.customer_ball_name].name = '-';
        delete this.gps.known_balls[this.customer_ball_name];
    }

    this.target_ball_id  = 0;
    this.target_x        = 0;
    this.target_y        = 0;
    this.customer_offset_x = 0;
    this.customer_offset_y = 0;
    this.customer_ball_name= '';

    if(config.debug >= 1)
        this.log.info('memoryReset() completed');
};

Task.prototype.split = function() {
    for(var i=0;i<this.bots.length;i++) {
        var bot = this.bots[i];
        bot.split();
    }
};

Task.prototype.eject = function() {
    for(var i=0;i<this.bots.length;i++) {
        var bot = this.bots[i];
        bot.eject();
    }
};

module.exports = Task;