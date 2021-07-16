var http = require('http');
var config = require('./config.js');
var Logger = require('./logger.js');
var querystring = require('querystring');

function Dapi(seq) {
    this.seq = seq;
    this.id = 'DAPI/' + seq;
    this.log = new Logger(this.id);
    this.cb = null;
    this.debug = config.dapi.debug;
}

Dapi.prototype.process = function(cmd, opt, cb) {
    var dapi_request = this;
    if(this.debug >= 2)
        this.log.info('Processing ' + this.log.colorize(39, false, true, cmd) + '(' + JSON.stringify(opt) + ')');
    this.http_request(cmd, opt, function(data, err) {
        cb(data, err);
        if(err) return;
        if(!data) return dapi_request.log.warn('Potential bug, requested ' + cmd + '(' + JSON.stringify(opt) + ') but got empty data');
        if(!data.status) return dapi_request.log.warn('Potential bug, requested ' + cmd + '(' + JSON.stringify(opt) + ') but did\'t found status: ' + JSON.stringify(data));
    });
};

Dapi.prototype.http_request = function(cmd, opt, cb) {
    var stringed_query = querystring.stringify(opt);
    var general_string = querystring.stringify({auth: config.dapi.password, cmd: cmd});
    var dapi = this;

    var options = {
        host: config.dapi.host,
        path: config.dapi.path + '?' + general_string + '&' + stringed_query
    };
    var json = '';

    if(this.debug >= 3)
        this.log.info('Requesting ' + options.path);

    var req = http.request(options, function(res) {
        res.setEncoding('utf8');
        res.on('data', function (chunk) {
            json += chunk;
        });
        res.on('end', function() {
            if(res.statusCode != 200) {
                dapi.log.error('Requested "' + options.path + '" but got HTTP code: ' + res.statusCode);
                return cb(null, 'Wrong HTTP code: ' + res.statusCode);
            }

            if(dapi.debug >= 4)
                dapi.log.info('Got answer: ' + json);

            var obj;
            try {
                obj = JSON.parse(json);
            }catch(e){
                dapi.log.error('Requested "' + options.path + '" but got invalid JSON format: "' + json + '"');
                return cb(null, 'Invalid JSON format: ' + json);
            }
            cb(obj, null);
        });
    });

    req.on('error', function(e) {
        dapi.log.error('Requested "' + options.path + '" but got connection error: ' + e);
        return cb(null, 'Connection error');
    });

    //req.write(opt.data);
    req.end();
};


module.exports = Dapi;