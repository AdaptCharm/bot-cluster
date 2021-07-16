var config = require('./config.js');
var Box = require('./box.js');
var reception = require('./reception.js');
var Logger  = require('./logger.js');
var http = require('http');
var crypto = require('crypto');
var url = require('url');
//var Buffer = require('buffer');
var wapi = {};

var server = http.createServer(function(request, response) {
    new Wapic(request, response);
});


wapi.init = function(cb) {
    server.listen(config.master.wapi.listen_port, config.master.wapi.listen_ip, function(){
        cb();
    });
};

module.exports = wapi;

function Wapic(request, response) {
    this.id       = 'WAPIC/' + crypto.randomBytes(15).toString('base64');
    this.debug    = config.master.debug;
    this.log      = new Logger(this.id);
    this.request  = request;
    this.response = response;
    this.query    = null;

    this.http_code = 200;
    this.http_content_type = 'application/json; charset=utf-8';

    if(this.debug >= 2)
        this.log.info('New request from ' + request.socket.remoteAddress + ':' + request.socket.remotePort);

    if(this.debug >= 4)
        this.log.info('Request URL: ' + request.url);

    this.process();
}

Wapic.prototype.process = function() {
    if(this.request.method != 'GET') return this.error('UNSUPPORTED_METHOD', 'Unknown method: ' + this.request.method);
    var parsed_url = url.parse(this.request.url, true);
    if(!parsed_url) return this.error('URL_PARSE_FAIL', 'Unable to parse URL: ' + this.request.url);
    if(!parsed_url.query) return this.error('EMPTY_QUERY', 'Unable to get query from URL: ' + this.request.url);
    this.query = parsed_url.query;
    if(!this.query['auth']) return this.error('AUTH_REQUIRED', 'Unable to get auth from URL: ' + this.request.url);
    if(this.query['auth'] != config.master.wapi.password) {
        this.log.warn('Somebody from "' + this.request.socket.remoteAddress + '" failed to auth with password "' + this.query['auth'] + '". Brute attempt?');
        return this.error('AUTH_FAILED', 'Invalid password');
    }
    if(!this.query['cmd']) return this.error('EMPTY_COMMAND', 'Unable to get cmd from URL: ' + this.request.url);
    var processor = this.processors[ this.query['cmd'] ];
    if(!processor) return this.error('UNKNOWN_COMMAND', 'There is no such processor: ' + this.query['cmd']);

    processor.call(this, this.query);
};

Wapic.prototype.end = function(obj) {
    /*var body = JSON.stringify(obj).replace(/[\u007f-\uffff]/g,
        function(c) {
            return '\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4);
        }
    );*/
    var body = JSON.stringify(obj);

    this.response.writeHead(this.http_code, { 'Content-Length': Buffer.byteLength(body, 'utf8'), 'Content-Type': this.http_content_type });
    this.response.end(body);

    if(this.debug >= 5)
        this.log.info('Sent answer: ' + body);
};

Wapic.prototype.error = function(code, reason) {
    if(this.debug >= 2) {
        this.log.warn('Wapi request error: ' + code + ', reason: ' + reason + ', url: ' + this.request.url);
    }

    this.end({
        status: 'error',
        code: code,
        reason: reason
    });
};

Wapic.prototype.success = function(obj) {
    var ret = {'status': 'success'};
    for(var key in obj) {
        if(!obj.hasOwnProperty(key)) continue;
        ret[key] = obj[key];
    }

    this.end(ret);
};

Wapic.prototype.processors = {
    count_boxes: function() {
        var count = Object.keys(Box.stock).length;
        this.success({count: count});
    },

    list_boxes: function() {
        var list = Object.keys(Box.stock);
        this.success({list: list});
    },

    ping_box: function(param) {
        if(!param) return this.error('BOX_NOT_FOUND', 'Empty options');
        if(!param['box_id']) return this.error('BOX_NOT_FOUND', 'Empty box_id');
        if(!Box.stock[ param['box_id'] ]) return this.error('BOX_NOT_FOUND', 'Box does not exists');

        var box = Box.stock[ param['box_id'] ];
        var summ = box.ping_history.reduce(function(previousValue, currentValue) {
            return previousValue + currentValue;
        }, 0);
        var average = Math.round(summ / box.ping_history.length);

        this.success({average: average, history: box.ping_history})
    },

    state: function() {
        var generate_start = (+new Date);

        var ret = {
            bots_online: 0,
            boxes: []
        };

        for(var box_id in Box.stock) {
            if(!Box.stock.hasOwnProperty(box_id)) continue;
            var box = Box.stock[box_id];
            var tasks = [];
            var load_bots = 0;

            var ret_box = {
                id: box.id,
                capacity: box.capacity,
                load: 0,
                address: {
                    ip: box.socket.remoteAddress,
                    family: box.socket.remoteFamily,
                    port: box.socket.remotePort
                },
                connected: box.connected_time,
                ping_history: box.ping_history,
                delay_history: box.delay_history,
                tasks: tasks
            };

            for(var task_id in box.tasks) {
                if(!box.tasks.hasOwnProperty(task_id)) continue;
                var task = box.tasks[task_id];
                var customer = task.customer;
                var subscription = task.subscription;
                tasks.push({
                    id: task.id,
                    connected_bots: task.connected,
                    region: task.region,
                    server: task.server,
                    key: task.key,
                    subscription: {
                        id: subscription.id,
                        type: subscription.type,
                        bots_count: subscription.count,
                        nickname: subscription.nickname,
                        expire: subscription.expire,
                        remain: subscription.expire-(+new Date),
                        customer: {
                            id: customer.id,
                            uid: customer.uid
                        }
                    }
                });
                ret.bots_online += task.connected;
                load_bots += subscription.count;
            }
            ret_box.load = Math.round(load_bots/ret_box.capacity*100);

            ret.boxes.push(ret_box);
        }

        ret.generated = (+new Date)-generate_start;

        this.success(ret);
    },

    box_hardware: function(param) {
        if(!param) return this.error('BOX_NOT_FOUND', 'Empty options');
        if(!param['box_id']) return this.error('BOX_NOT_FOUND', 'Empty box_id');
        if(!Box.stock[ param['box_id'] ]) return this.error('BOX_NOT_FOUND', 'Box does not exists');

        var box = Box.stock[ param['box_id'] ];

        this.success(box.report.os)
    }
};

