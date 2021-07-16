var config = require('./config.js');
var crypto = require('crypto');
var Logger = require('./logger.js');
var net = require('net');
var dapi = require('./dapi.js');
var master = require('./master.js');
var ProxyData = require('./proxydata.js');
var engine = require('engine.io');
var url = require('url');
var SmartBuffer = require('smart-buffer');
var http = null;
var server = null;

Customer.PACKET_AUTH                    = 0;
Customer.PACKET_FEEDBACK                = 1;
Customer.PACKET_USERINFO                = 2;
Customer.PACKET_NOTICE                  = 3;
Customer.PACKET_UPGRADE_VERION          = 4;
Customer.PACKET_SUBSCRIPTION_ENGAGED    = 7;
Customer.PACKET_SUBSCRIPTION_DISENGAGED = 8;
Customer.PACKET_SUBSCRIPTION_CONNECTED  = 9;
Customer.PACKET_SUBSCRIPTION_ACTIVATED  = 10;

Customer.customers = customers = {};
//Customer.subscriptions = subscriptions = {};

Customer.init = function(m) {
    var onRequest = function(request, response) {
        var body = 'Nothing to see here';
        response.writeHead(500, { 'Content-Length': body.length, 'Content-Type': 'text/plain' });
        response.end(body);
    };

    http = require('http').createServer(onRequest).listen(config.server.port, config.server.host);
    server = engine.attach(http, config.server.engine);

    server.on('connection', function (socket) {
        new Customer(socket);
    });
};

function Customer(socket) {
    socket.binaryType   = 'arraybuffer';
    this.id             = 'CUSTOMER/' + crypto.randomBytes(15).toString('base64');
    this.debug          = config.debug;
    this.socket         = socket;
    this.connected_time = (+new Date);
    this.buff           = '';
    this.log            = new Logger(this.id);
    this.killed         = false;
    this.proxydatas     = {};

    this.authorizing    = false;
    this.authorized     = false;
    this.uid            = 0;
    this.username       = null;
    this.subscriptions  = [];
    this.active_sub     = 0;

    if(this.debug >= 1)
        this.log.info('Connected from ' + socket.remoteAddress);

    socket.on('message', this.onData.bind(this));
    socket.on('error',   this.onError.bind(this));
    socket.on('close',   this.onClose.bind(this));
}

Customer.prototype.onData = function(data) {
    if(!data || data.constructor != Buffer) {
        if(this.debug >= 1)
            this.log.warn('RECV unknown data constructor: ' + (data ? data.constructor.toString() : '???'));
        return;
    }

    if(this.killed) {
        if(this.debug >= 2)
            this.log.warn('Customer is killed, ignoring packet');
        return;
    }

    var packet = new SmartBuffer(data);
    if(packet.length < 1) {
        if(this.debug >= 1)
            this.log.warn('Some smart guy from ' + this.socket.remoteAddress + ' trying to send packet ' + packet.length + 'bytes long');
        return;
    }

    if(this.debug >= 5)
        this.log.info('RECV data: ' + this.processors.stringify(packet));

    this.process(packet);
};

Customer.prototype.onError = function(e) {
    if(this.debug >= 1)
        this.log.info('Socket error: ' + e);
};

Customer.prototype.onClose = function() {
    if(this.debug >= 2)
        this.log.info('Disconnected');

    if(this.authorized) this.customer_leave();
};

Customer.prototype.send = function(packer_id) {
    var args = [];
    for(var i=1;i<arguments.length;i++) {
        args.push(arguments[i]);
    }

    if(this.debug >= 4)
        this.log.info('send(\'' + packer_id + '\', \'' + args.join('\', \'') + '\')');

    var packer = this.packers[packer_id];
    if(!packer) {
        return master.report('Unknown packer_id: ' + packer_id);
    }

    var packet = packer.apply(this, args);

    if(this.debug >= 4)
        this.log.info('SEND: ' + this.processors.stringify(packet));

    if(this.socket.readyState != 'open') {
        if(this.debug >= 1)
            this.log.info('Unable to send data, socket is "' + this.socket.readyState + '"');
        return;
    }

    this.socket.send(packet.toBuffer());
};

Customer.prototype.process = function(packet) {
    var packet_id = packet.readUInt8();

    if(this.debug >= 3)
        this.log.info('Processing packet ID ' + packet_id);

    if(!this.authorized && packet_id != Customer.PACKET_AUTH && packet_id != Customer.PACKET_FEEDBACK) {
        if(this.debug >= 1)
            this.log.warn('Unauthorized user trying to send packet: ' + this.processors.stringify(packet));
            this.log.warn('REBREC INFO : Authorized :' + this.authorized);
            this.log.warn('REBREC INFO : Packet_ID:' + packet_id);
        return;
    }

    var processor = this.processors[packet_id];
    if(!processor) {
        if(this.debug >= 1)
            this.log.warn('Unknown packet ID ' + packet_id);
        return;
    }

    try {
        processor.call(this, packet);
    } catch(e) {
        if(this.debug >= 1)
            this.log.error('Processor error: Packet: ' + this.processors.stringify(packet) + '\n' + e.stack);
    }
};

Customer.prototype.notice = function(code, kill) {
    this.send('notice', code, kill);

    if(kill) {
        this.killed = true;
        this.socket.close();
    }
};

Customer.prototype.dapi_error = function(kill, error) {
    if(this.debug >= 2)
        this.log.error('Dapi error sending to user: ' + error + ', kill: ' + kill);

    master.warn('Dapi error: ' + error);

    this.notice(dapi.NOTICE_CODE_COMMUNICATION_ERROR, kill);
};

Customer.prototype.customer_join = function(customer_id, obj) {
    if(this.debug >= 2)
        this.log.info('Customer joined: ' + customer_id + '(' + obj.username + ')');

    if(!customers[customer_id]) customers[customer_id] = [];
    customers[customer_id].push(this);

    if(obj.subscriptions.length) {
        for(var i=0;i<obj.subscriptions.length;i++) {
            var sub = obj.subscriptions[i];
            if(!sub.id) return master.report('Got subscription without id: ' + JSON.stringify(obj));
            if(!sub.type) return master.report('Got subscription without type: ' + JSON.stringify(obj));
            if(!sub.remain) return master.report('Got subscription without remain: ' + JSON.stringify(obj));

            //subscriptions[sub.id] = sub;
            //subscriptions[sub.id].customer = this.uid;
            //subscriptions[sub.id].expire = (+new Date) + sub.remain*1000;
            //sub.expire = (+new Date) + sub.remain*1000;

            this.subscriptions.push(sub.id);
        }
    }

    master.send('customer_join', this.id, {uid: customer_id, subscriptions: obj.subscriptions});
};

Customer.prototype.customer_leave = function() {
    if(this.debug >= 2)
        this.log.info('Customer leaved: ' + this.uid);

    for(var key in this.proxydatas) {
        if(!this.proxydatas.hasOwnProperty(key)) continue;
        this.proxydatas[key].destroy();
    }

    for(var i=0;i<Customer.customers[this.uid].length;i++) {
        var customer = Customer.customers[this.uid][i];
        if(customer.id == this.id) {
            if(this.debug >= 5)
                this.log.info('Customer removed from array');
            Customer.customers[this.uid].splice(i, 1);
        }
    }

    if(!Customer.customers[this.uid].length) delete Customer.customers[this.uid];

    master.send('customer_leave', this.id, this.uid);
};

Customer.prototype.sendToProxyDatas = function(data) {
    for(var key in this.proxydatas) {
        if(!this.proxydatas.hasOwnProperty(key)) continue;
        this.proxydatas[key].proxyData(data.toBuffer());
    }
};


Customer.prototype.processors = {
    stringify: function(packet) {
        var ret = '';
        var pos = packet.length - packet.remaining();
        packet.skipTo(0);

        while(packet.remaining()) {
            if(ret) ret += ' ';
            ret += ('0' + packet.readUInt8().toString(16)).substr(-2);
        }

        packet.skipTo(pos);

        return ret;
    },

    //auth
    0: function(packet) {
        var customer = this;
	this.log.info('LOG REBREC : azeaze');
        if(this.authorizing) {
            this.log.warn('Customer requests auth when already authorizing');
            return;
        }

        var version      = packet.readUInt16LE();
        var customer_id  = packet.readUInt32LE();
        var customer_key = packet.readStringNT();
        this.log.info('LOG REBREC : a');
        this.log.info('LOG REBREC : Authorization, VERSION=' + version + ', config.version=' + config.version) + ' customer_id='+customer_id+' customer_key=' + customer_key;
        this.log.info('LOG REBREC : Authorization, customer.uid=' + this.uid );
        if(version != config.version) {
            this.send('upgrade_version', config.version);
            return this.notice(dapi.NOTICE_CODE_VERSION_MISMATCH, true);
        }

        if(this.debug >= 2)
            this.log.info('Requesting master to authorize customer ' + this.log.colorize(39, false, true, customer_id) + ' with key ' + this.log.colorize(39, false, true, customer_key));

        this.authorizing = true;
        this.uid = customer_id;

        dapi.request('authorize_customer', {id: customer_id, key: customer_key}, function(data, err) {
            if(err) return customer.dapi_error(true, err);
            if(!data) return customer.dapi_error(true, 'authorize_customer: Empty data');
            if(!data.status) return customer.dapi_error(true, 'authorize_customer: No data.status field');
            if(data.status == 'error') {
                if(data.code == 'INVALID_CUSTOMER') return customer.notice(dapi.NOTICE_CODE_AUTH_FAILED, true);
                return customer.dapi_error(true, 'authorize_customer: Unknown or empty error code: ' + JSON.stringify(data));
            }
            if(data.status != 'success') return customer.dapi_error(true, 'authorize_customer: Unknown status: ' + JSON.stringify(data));

            customer.authorizing = false;
            customer.authorized = true;

            customer.customer_join(customer.uid, data);
            customer.send('userinfo', data);
        });
        //master.send('authorize_customer', customer_id, customer_key);
    },

    //feedback
    1: function(packet) {
        var msg = packet.readStringNT();
        if(this.debug >= 1)
            this.log.warn('feedback received: ' + msg);
    },

    //engage_subscription
    5: function(packet) {
        var id          = packet.readUInt32LE();
        var region      = packet.readStringNT();
        var gamemode    = packet.readStringNT();
        var server      = packet.readStringNT();
        var key         = packet.readStringNT();
        var leaders_len = packet.readUInt8();
        var customer    = this;
        var leaders     = [];

        for(var i=0;i<leaders_len;i++) {
            leaders.push(packet.readUInt32LE());
        }

        if(this.debug >= 2)
            this.log.info('engage subscription: id=' + id + ', region=' + region + ', gamemode=' + gamemode + ', key=' + key + ', server=' + server + ', leaders=' + leaders);

        var parsed = url.parse(server);
        if(!parsed || !parsed.host || !parsed.port) return this.notice(13);

        if(this.subscriptions.indexOf(id) < 0) return this.notice(dapi.NOTICE_CODE_SUBSCRIPTION_NOT_FOUND);

        var opt = {
            id: id,
            region: region,
            gamemode: gamemode,
            server: parsed.hostname + ':' + parsed.port,
            key: key,
            leaders: leaders
        };

        this.master_request('engage_subscription', opt, function(data, err) {
            if(err) return customer.notice(err, false);

            if(customer.proxydatas[id]) return master.report('While attempted to start proxydata, found it already started. opt=' + JSON.stringify(opt) + ', data=' + JSON.stringify(data));
            customer.proxydatas[id] = new ProxyData({customer: customer, subscription: opt, dataproxy_ip: data.dataproxy_ip, dataproxy_port: data.dataproxy_port});
        });
    },

    //leaders update
    11: function(packet) {
        var arr = [];
        var count = packet.readUInt8();
        for(var i=0;i<count;i++) {
            arr.push(packet.readUInt32LE());
        }
        master.send('new_target', this.uid, this.id, 'leaders', arr);
    },

    //target cords update
    12: function(packet) {
        var x = packet.readInt32LE();
        var y = packet.readInt32LE();
        var ball_name = packet.readStringNT();
        var ball_x = packet.readInt32LE();
        var ball_y = packet.readInt32LE();

        master.send('new_target', this.uid, this.id, 'cords', x, y, ball_name, ball_x, ball_y);
    },

    //target ball_id update
    13: function(packet) {
        var ball_id =  packet.readUInt32LE();

        master.send('new_target', this.uid, this.id, 'ball', ball_id);
    },

    //target nickname update
    14: function(packet) {
        var nickname =  packet.readStringNT();

        master.send('new_target', this.uid, this.id, 'nickname', nickname);
    },

    //split
    15: function(packet) {
        master.send('new_target', this.uid, this.id, 'split'); //well, yes. Its target. This was bad idea
    },

    //eject
    16: function(packet) {
        master.send('new_target', this.uid, this.id, 'eject'); //well, yes. Its target. This was bad idea
    },

    //disengage
    17: function(packet) {
        var id = packet.readUInt32LE();

        if(this.subscriptions.indexOf(id) < 0) return this.notice(dapi.NOTICE_CODE_SUBSCRIPTION_NOT_FOUND);

        this.master_request('disengage_subscription', id, function(data, err) {
            //
        });
    },

    //memory_reset
    18: function(packet) {
        master.send('new_target', this.uid, this.id, 'memory_reset'); //well, yes. Its target. This was bad idea
    },

    //proxydata received from agario
    19: function(packet) {
        this.sendToProxyDatas(packet);
    },

    //proxydata sent to agario
    20: function(packet) {
        this.sendToProxyDatas(packet);
    },

    //set target to mouse
    21: function(packet) {
        var ball_name = packet.readStringNT();
        var ball_x = packet.readInt32LE();
        var ball_y = packet.readInt32LE();
        var ball_id = packet.readInt32LE();
        var ball_ids = JSON.parse(packet.readStringNT());

        master.send('new_target', this.uid, this.id, 'mouse', ball_x, ball_y, ball_name, ball_id, ball_ids);
    }
};


Customer.prototype.packers = {
    'auth': function(version, customer_id, customer_key) {
        var packet = new SmartBuffer();
        packet.writeUInt8(Customer.PACKET_AUTH);
        packet.writeUInt16LE(version);
        packet.writeUInt32LE(customer_id);
        packet.writeStringNT(customer_key);

        return packet;
    },

    'userinfo': function(data) {
        var packet = new SmartBuffer();
        packet.writeUInt8(Customer.PACKET_USERINFO);
        packet.writeStringNT(data.username);
        packet.writeUInt8(data.subscriptions.length);

        for(var i=0;i<data.subscriptions.length;i++) {
            var sub = data.subscriptions[i];

            var OPT = 0x0;
            var FLAG_FFA       = 0x1; // 0001
            var FLAG_ACTIVATED = 0x2; // 0010

            if(sub.type == 'ffa') OPT = OPT | FLAG_FFA;
            if(sub.activated) OPT = OPT | FLAG_ACTIVATED;

            packet.writeUInt32LE(sub.id);
            packet.writeUInt8(OPT);
            packet.writeUInt16LE(sub.count);
            packet.writeUInt32LE(sub.remain);
        }

        return packet;
    },

    'notice': function(code, kill) {
        var packet = new SmartBuffer();
        packet.writeUInt8(Customer.PACKET_NOTICE);
        packet.writeUInt8(code);
        packet.writeUInt8(kill?1:0);

        return packet;
    },

    'upgrade_version': function(version) {
        var packet = new SmartBuffer();
        packet.writeUInt8(Customer.PACKET_UPGRADE_VERION);
        packet.writeUInt16LE(version);

        return packet;
    },

    'engaged': function(subscription_id, this_session) {
        var packet = new SmartBuffer();
        packet.writeUInt8(Customer.PACKET_SUBSCRIPTION_ENGAGED);
        packet.writeUInt32LE(subscription_id);
        packet.writeUInt8(this_session?1:0);

        return packet;
    },

    'disengaged': function(subscription_id) {
        var packet = new SmartBuffer();
        packet.writeUInt8(Customer.PACKET_SUBSCRIPTION_DISENGAGED);
        packet.writeUInt32LE(subscription_id);

        if(this.proxydatas[subscription_id]) this.proxydatas[subscription_id].destroy();

        return packet;
    },

    'connected': function(subscription_id, count) {
        var packet = new SmartBuffer();
        packet.writeUInt8(Customer.PACKET_SUBSCRIPTION_CONNECTED);
        packet.writeUInt32LE(subscription_id);
        packet.writeUInt16LE(count);

        return packet;
    },

    'activated': function(subscription_id) {
        var packet = new SmartBuffer();
        packet.writeUInt8(Customer.PACKET_SUBSCRIPTION_ACTIVATED);
        packet.writeUInt32LE(subscription_id);

        return packet;
    }
};

Customer.master_last_id = 1;
Customer.master_queue = {};

Customer.prototype.master_request = function(cmd, opt, cb) {
    var id = Customer.master_last_id++;
    Customer.master_queue[id] = cb;

    master.send('customer_request', id, this.id, this.uid, cmd, opt);
};

Customer.master_answer_received = function(seq, data, err) {
    if(!Customer.master_queue[seq]) return master.report('Received master_answer answer for unknown SEQ=' + seq + ', data=' + require('util').inspect(data) + ', err=' + err);
    Customer.master_queue[seq](data, err);
    delete Customer.master_queue[seq];
};

module.exports = Customer;
