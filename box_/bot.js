var Logger  = require('./logger.js');
var config = require('./config.js');
var Ball = require('./ball.js');
var crypto = require('crypto');
var WebSocket = require('ws');
var Packet = require('agario-client/packet');
var Servers = require('agario-client/servers');

function Bot(opt) {
    this.log            = new Logger('BOT/' + crypto.randomBytes(15).toString('base64'));
    this.task           = opt.task;
    this.proxy          = opt.proxy;
    this.server         = opt.server;
    this.key            = opt.key;
    this.last_tick      = 0;
    this.joined         = false;
    this.nodata_timeout = null;
    this.connect_retry  = null;
    this.offset_x       = null;
    this.offset_y       = null;
    this.x              = null;
    this.y              = null;
    this.ball_id        = 0;
    this.ball_nickname  = '';


    if(config.debug >= 6)
        this.log.info('Bot created!');

    if(this.task.type == 'party') {
        this.connect();
    }else{
        this.bruteServer();
    }

}

Bot.prototype.bruteServer = function() {
    var bot = this;
    var task = bot.task;
    if(task.destroyed) return;

    Servers.getFFAServer({region: task.region}, function(srv) {
        if(bot.proxy.dead) return;
        if(!srv.server) {
            if(config.debug >= 8)
                bot.log.info('Failed to request server (error=' + srv.error + ', error_source=' + srv.error_source + ')');
            bot.proxy.fail();
            return bot.bruteServer();
        }
        bot.proxy.success();
        if(task.server != srv.server) {
            if(config.debug >= 8)
                bot.log.info('Got server: ' + srv.server + ' but searching for: ' + task.server);
            return bot.bruteServer();
        }
        bot.server = srv.server;
        bot.key = srv.key;
        bot.connect();
    });
};

Bot.prototype.connect = function() {
    var bot = this;

    if(this.proxy.dead) {
        if(config.debug >= 6)
            this.log.error('Proxy is dead, no more connection attempts will be made');
        return false;
    }

    if(this.task.connected_bots >= this.task.count) {
        this.connect_retry = setTimeout(function() {
            if(bot.task.type == 'party') {
                bot.connect();
            }else{
                bot.bruteServer();
            }
        }, Math.ceil(Math.random()*config.remote.connect_retry_timeout));
        return;
    }

    var opt = {
        headers: {'Origin': 'http://agar.io'},
        agent: this.proxy.createAgent()
    };

    var ws_address     = 'ws://' + this.server;

    if(config.debug >= 6)
        this.log.info('Connecting to ' + ws_address + ' with key ' + this.key + ' from proxy ' + this.proxy.ip + ':' + this.proxy.port + ':' + this.proxy.type);

    this.ws            = new WebSocket(ws_address, null, opt);
    this.ws.binaryType = "arraybuffer";

    this.ws.addEventListener('open', this.onConnect.bind(this));
    this.ws.addEventListener('message', this.onMessage.bind(this));
    this.ws.addEventListener('close', this.onClose.bind(this));
    this.ws.addEventListener('error', this.onError.bind(this));
};

Bot.prototype.onConnect = function() {
    var bot = this;
    this.task.connected_bots++;
    this.connected = true;

    if(config.debug >= 6)
        this.log.info('Connected');

    if(this.ws.readyState !== WebSocket.OPEN) {
        if(config.debug >= 6)
            this.log.error('onConnect called with not opened ws, state=' + this.ws.readyState);
        this.disconnect();
        return;
    }

    if(this.task.destroyed) {
        if(config.debug >= 6)
            this.log.info('bot.onConnect: Task is destroyed, disconnecting bot');
        this.disconnect();
        return;
    }

    this.nodata_timeout = setTimeout(function() {
        bot.proxy.notick();
        bot.disconnect();
    }, config.remote.nodata_timeout);

    var buf = new Buffer(5);
    buf.writeUInt8(254, 0);
    buf.writeUInt32LE(5, 1);
    this.send(buf);

    buf = new Buffer(5);
    buf.writeUInt8(255, 0);
    buf.writeUInt32LE(2200049715, 1);
    this.send(buf);

    buf = new Buffer(1 + this.key.length);
    buf.writeUInt8(80, 0);
    for (var i=1;i<=this.key.length;++i) {
        buf.writeUInt8(this.key.charCodeAt(i-1), i);
    }
    this.send(buf);

    this.on_connected();
};

Bot.prototype.onMessage = function(msg) {
    if(!msg.data || !msg.data.length || !msg.data.constructor || msg.data.constructor != Buffer) return;
    var packet = new Packet(msg);
    var packet_id = packet.readUInt8();
    var processor = this.processors[packet_id];

    if(config.debug >= 10)
        this.log.error('RECV: ' + packet.toString());

    if(!processor) return;
    try {
        processor.call(this, packet);
    }catch(e){
        if(config.debug >= 6)
            this.log.error('Processor ID ' + packet_id + ' crashed:\n' + e + '\n' + e.stack);
    }
};

Bot.prototype.onClose = function() {
    if(!this.joined) {
        this.proxy.notick();
    }
    this.reset();
};

Bot.prototype.onError = function(e) {
    if(config.debug >= 6)
        this.log.info('ws error: ' + e);

    this.disconnect();
};

Bot.prototype.on_connected = function() {
    this.proxy.success();

    this.spawn();
    //this.send(new Buffer([0x00, 0x39, 0x00, 0x32, 0x00, 0x39, 0x00, 0x31, 0x00, 0x32, 0x00, 0x54, 0x00, 0x45, 0x00, 0x53, 0x00, 0x54, 0x00, 0x35, 0x00, 0x32, 0x00, 0x35, 0x00, 0x30, 0x00, 0x39, 0x00]))
};

Bot.prototype.disconnect = function() {
    if(this.ws) this.ws.close();
    this.reset();
};

Bot.prototype.reset = function() {
    var bot = this;

    if(config.debug >= 9)
        this.log.info('RESET');

    if(this.ws) {
        this.ws.removeAllListeners('open');
        this.ws.removeAllListeners('message');
        this.ws.removeAllListeners('close');
        this.ws.removeAllListeners('error');
        this.ws.addEventListener('error',function(){/* without this it will crash */});
    }

    if(this.nodata_timeout) clearTimeout(this.nodata_timeout);
    if(this.connect_retry) clearTimeout(this.connect_retry);
    this.proxy.fail();

    if(this.ball_nickname && this.task.known_balls[this.ball_nickname]) {
        delete this.task.known_balls[this.ball_nickname];
    }

    this.ball_id = null;
    this.ball_nickname = null;
    this.offset_x = null;
    this.offset_y = null;

    this.joined = false;
    if(this.connected) {
        this.connected = false;
        this.task.connected_bots--;
    }

    if(this.task.destroyed) return;

    if(this.proxy.dead) {
        if(config.debug >= 7)
            this.log.info('Proxy is dead, removing bot');
        return this.remove();
    }

    if(bot.task.type == 'party') {
        bot.connect();
    }else{
        bot.bruteServer();
    }
};

Bot.prototype.generateNameSalt = function(len) {
    var ret = '';
    for(var i=0;i<len;i++) {
        ret += String.fromCharCode( config.remote.bots_name_salt_symbols[Math.floor(Math.random()*config.remote.bots_name_salt_symbols.length)] );
    }
    return ret;
};

Bot.prototype.send = function(buf) {
    if(!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
    }

    if(config.debug >= 9)
        this.log.info('SEND packet ID=' + buf.readUInt8(0) + ' LEN=' + buf.length);

    if(config.debug >= 10)
        this.log.info('dump: ' + (new Packet(buf).toString()));

    this.ws.send(buf);
};

Bot.prototype.spawn = function() {
    var salt1 = this.generateNameSalt(Math.ceil(config.remote.bots_name_salt_length/2));
    var salt2 = this.generateNameSalt(Math.floor(config.remote.bots_name_salt_length/2));
    var nickname = this.task.nickname.substr(0,15-config.remote.bots_name_salt_length);
    var name = (Math.random()>0.5) ? salt2+nickname+salt1 : salt1+nickname+salt2;
    var buf = new Buffer(1 + 2*name.length);

    if(config.debug >= 6)
        this.log.info('spawn(\'' + name + '\') called, len=' + name.length);

    buf.writeUInt8(0, 0);
    for (var i=0;i<name.length;i++) {
        buf.writeUInt16LE(name.charCodeAt(i), 1 + i*2);
    }
    this.send(buf);
    //this.moveTo(0, 0);



    return true;
};

Bot.prototype.moveTo = function(x,y) {
    //if(this.offset_x === null) return;
    var buf = new Buffer(13);
    buf.writeUInt8(16, 0);
    buf.writeInt32LE(Math.round(x + (this.offset_x || 0)), 1);
    buf.writeInt32LE(Math.round(y + (this.offset_y || 0)), 5);
    buf.writeUInt32LE(0, 9);
    this.send(buf);
};

Bot.prototype.split = function() {
    var buf = new Buffer(1);
    buf.writeUInt8(17, 0);
    this.send(buf);
};

Bot.prototype.eject = function() {
    var buf = new Buffer(1);
    buf.writeUInt8(21, 0);
    this.send(buf);
};


Bot.prototype.processors = {
    //tick
    '16': function(packet) {
        var bot = this;
        var now = (+new Date);

        var eaters_count = packet.readUInt16LE();

        //bot.tick_counter++;

        packet.offset += eaters_count*8;
        //reading eat events
        /*for(var i=0;i<eaters_count;i++) {
            var eater_id = packet.readUInt32LE();
            var eaten_id = packet.readUInt32LE();

            if(config.debug >= 9)
                bot.log.info(eater_id + ' ate ' + eaten_id + ' (' + bot.task.balls[eater_id] + '>' + bot.task.balls[eaten_id] + ')');

            if(bot.task.balls[eater_id]) bot.task.balls[eater_id].update();
            if(bot.task.balls[eaten_id]) bot.task.balls[eaten_id].destroy(this.task, eaten_id);
        }*/


        //reading actions of balls
        while(1) {
            var is_virus = false;
            var ball_id;
            var coordinate_x;
            var coordinate_y;
            //var size;
            //var color;
            //var nick = null;

            ball_id = packet.readUInt32LE();
            if(ball_id == 0) break;
            coordinate_x = packet.readSInt32LE();
            coordinate_y = packet.readSInt32LE();
            //size = packet.readSInt16LE();

            packet.offset += 5;
            /*var color_R = packet.readUInt8();
            var color_G = packet.readUInt8();
            var color_B = packet.readUInt8();

            color = (color_R << 16 | color_G << 8 | color_B).toString(16);
            color = '#' + ('000000' + color).substr(-6);*/

            var opt = packet.readUInt8();
            is_virus = !!(opt & 1);
            //var something_1 = !!(opt & 16); //what is this?

            //reserved for future use?
            if (opt & 2) {
                packet.offset += packet.readUInt32LE();
            }
            if (opt & 4) {
                //var something_2 = ''; //something related to premium skins
                while(1) {
                    var char = packet.readUInt8();
                    if(char == 0) break;
                    /*if(!something_2) something_2 = '';
                    something_2 += String.fromCharCode(char);*/
                }
            }

            var nick = '';
            while(1) {
                char = packet.readUInt16LE();
                if(char == 0) break;
                if(!nick) nick = '';
                nick += String.fromCharCode(char);
            }

            if(bot.task.target_type == 'nickname' && nick === bot.task.target_nickname && ball_id > bot.task.target_ball_id) {
                bot.task.target_ball_id = ball_id;
            }

            if(ball_id == bot.task.target_ball_id) {
                /*bot.task.target_x = coordinate_x;
                 bot.task.target_y = coordinate_y;*/

                if(this.offset_x !== null && now-bot.last_tick > config.remote.tick_interval) {
                    bot.moveTo(coordinate_x, coordinate_y);
                    bot.last_tick = now;
                }
            }else if(ball_id == bot.ball_id) {
                bot.x = coordinate_x;
                bot.y = coordinate_y;
                if(nick && !bot.ball_nickname) {
                    bot.ball_nickname = nick;
                    this.task.known_balls[this.ball_nickname] = this;
                }
                bot.task.gps.locate(bot);
            }

            if(!bot.joined) {
                bot.joined = true;
                bot.proxy.tick();
                if(this.nodata_timeout) clearTimeout(this.nodata_timeout);
            }
            if(config.debug >= 9)
                bot.log.info('action: ball_id=' + ball_id + ' nick="' + nick + '" coordinate_x=' + coordinate_x + ' coordinate_y=' + coordinate_y + ' size=' + /*size +*/ ' is_virus=' + is_virus);

            /*if(bot.my_balls.indexOf(ball_id) >= 0) {
                bot.x = coordinate_x;
                bot.y = coordinate_y;
            }*/

            /*if(!bot.task.balls[ball_id] && (is_virus || size < config.remote.ignore_balls_smaller)) {
                if(config.debug >= 9)
                    bot.log.info('Ignoring ball ' + ball_id + ' with size ' + size);
                continue;
            }

            var ball;
            if(!bot.task.balls[ball_id]) {
                ball = new Ball(bot.task, ball_id);
                ball.size = size*2;
                ball.x = coordinate_x;
                ball.y = coordinate_y;
            }else{
                ball = bot.task.balls[ball_id];
                ball.size = size*2;
                ball.x = coordinate_x;
                ball.y = coordinate_y;
                ball.update();
            }*/

            /*var ball = bot.balls[ball_id] || new Ball(bot, ball_id);
            ball.color = color;
            ball.virus = is_virus;
            ball.setCords(coordinate_x, coordinate_y);
            ball.setSize(size);
            if(nick) ball.setName(nick);
            ball.update_tick = bot.tick_counter;
            ball.appear();
            ball.update();*/


        }

        /*var balls_on_screen_count = packet.readUInt32LE();

        //disappear events
        for(i=0;i<balls_on_screen_count;i++) {
            ball_id = packet.readUInt32LE();

            ball = bot.balls[ball_id] || new Ball(bot, ball_id);
            ball.update_tick = bot.tick_counter;
            ball.update();
            if(ball.mine) {
                ball.destroy({reason: 'merge'});
                bot.emit('merge', ball.id);
            }else{
                ball.disappear();
            }
        }*/
    },

    //new ID of your ball (when you join or press space)
    '32': function(packet) {
        var ball_id = packet.readUInt32LE();

        if(this.ball_nickname && this.task.known_balls[this.ball_nickname]) {
            delete this.task.known_balls[this.ball_nickname];
        }

        this.ball_id = ball_id;
        this.ball_nickname = null;
        this.offset_x = null;
        this.offset_y = null;
        this.x = null;
        this.y = null;
        this.moveTo(0, 0);
    }

    /*//leaderboard update in FFA mode
    '49': function(client, packet) {
        var users = [];
        var count = packet.readUInt32LE();

        for(var i=0;i<count;i++) {
            var id = packet.readUInt32LE();

            var name = '';
            while(1) {
                var char = packet.readUInt16LE();
                if(char == 0) break;
                name += String.fromCharCode(char);
            }

            users.push(id);
            var ball = client.balls[id] || new Ball(client, id);
            if(name) ball.setName(name);
            ball.update();
        }

        if(JSON.stringify(client.leaders) == JSON.stringify(users)) return;
        var old_leaders = client.leaders;
        client.leaders  = users;

        if(client.debug >= 3)
            client.log('leaders update: ' + JSON.stringify(users));

        client.emit('leaderBoardUpdate', old_leaders, users);
    },*/

    //map size load
    /*'64': function(packet) {
        var min_x = packet.readFloat64LE();
        var min_y = packet.readFloat64LE();
        var max_x = packet.readFloat64LE();
        var max_y = packet.readFloat64LE();

        if(config.debug >= 7)
            this.log.info('Map size: ' + [min_x, min_y, max_x, max_y].join(','));

        console.log('------------------------------Map size: ' + [min_x-min_x, min_y-min_y, max_x-min_x, max_y-min_y].join(','));
    }*/

    /*
    '240': function(client, packet) {
        packet.offset += 4;
        var packet_id = packet.readUInt8();
        var processor = client.processors[packet_id];
        if(!processor) return client.log('[warning] unknown packet ID(240->' + packet_id + '): ' + packet.toString());
        processor(client, packet);
    }*/
};

Bot.prototype.remove = function() {
    var index = this.task.bots.indexOf(this);
    if(index < 0) throw new Error('Failed to remove bot!');
    this.task.bots.splice(index, 1);
};

/*Bot.prototype.botBall = function(ball_id) {

};*/

module.exports = Bot;