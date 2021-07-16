var Socks = require('socks');
var config = require('./config.js');

function Proxy(arr) {
    this.ip         = arr[0];
    this.port       = arr[1];
    this.type       = arr[2];
    this.fails      = 0;
    this.no_tick    = 0;
    this.dead       = false;
}

Proxy.prototype.createAgent = function() {
    return new Socks.Agent({
            proxy: {
                ipaddress: this.ip,
                port: parseInt(this.port),
                type: parseInt(this.type)
            }}
    );
};

Proxy.prototype.fail = function() {
    this.fails++;
    if(this.fails > config.remote.proxy_max_fails) {
        this.dead = true;
    }
};

Proxy.prototype.success = function() {
    this.fails = 0;
};

Proxy.prototype.notick = function() {
    this.no_tick++;
    if(this.no_tick > config.remote.proxy_max_notick) {
        this.dead = true;
    }
};

Proxy.prototype.tick = function() {
    this.no_tick = 0;
};

Proxy.prototype.toString = function() {
    return '[Socks ' + this.ip + ':' + this.port + ']';
};



module.exports = Proxy;